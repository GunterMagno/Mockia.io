import crypto from 'crypto';
import { connectDB, disconnectDB } from '../config/connection.js';
import { assertProdConfig } from '../config/assertProdConfig.js';
import { getDemoConfig } from '../modules/demo/config.js';
import { pseudonymizeIp, pseudonymizeNet } from '../modules/demo/ipHash.js';
import { checkProof, isChallengeSpent, issueChallenge, spendChallenge, verifyProof } from '../modules/demo/pow.js';
import { tryConsumeDemoBudget, acquireGenerationSlot, refundDemoBudget, peekDemoBudget } from '../modules/demo/budget.js';
import { DemoBudgetModel } from '../models/DemoBudget.js';
import { DemoSpentChallengeModel } from '../models/DemoSpentChallenge.js';

/**
 * Task B1: anti-abuse primitives of the public demo. Real Mongo (atomicity is the point of several tests);
 * the clock is injected so day changes and expiry need no waiting.
 */

const SECRET = 'demo-test-secret-with-more-than-32-chars!!';
const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-10-09T10:00:00Z');

const ENV_KEYS = [
  'DEMO_ENABLED',
  'DEMO_DAILY_GENERATIONS',
  'DEMO_PER_IP_GENERATIONS',
  'DEMO_PER_NET_GENERATIONS',
  'DEMO_MAX_CONCURRENT',
  'DEMO_POW_BITS',
  'DEMO_MOCK_TTL_MINUTES',
  'DEMO_HMAC_SECRET',
] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  await connectDB();
  await DemoBudgetModel.init();
  await DemoSpentChallengeModel.init();
});
afterAll(async () => {
  await disconnectDB();
});
beforeEach(async () => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.DEMO_HMAC_SECRET = SECRET;
  await Promise.all([DemoBudgetModel.deleteMany({}), DemoSpentChallengeModel.deleteMany({})]);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Leading zero bits of SHA-256(challenge:nonce). */
const zerosOf = (challenge: string, nonce: string): number => {
  const hash = crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest();
  let zeros = 0;
  for (const byte of hash) {
    if (byte === 0) {
      zeros += 8;
      continue;
    }
    zeros += Math.clz32(byte) - 24;
    break;
  }
  return zeros;
};
const bitsOf = (challenge: string): number => JSON.parse(Buffer.from(challenge.split('.')[0], 'base64url').toString('utf8')).bits as number;

/** Brute-force a nonce for a challenge (tiny `bits` so the test is instant). */
const solve = (challenge: string): string => {
  const bits = bitsOf(challenge);
  for (let i = 0; ; i++) if (zerosOf(challenge, i.toString(36)) >= bits) return i.toString(36);
};

/** A nonce that certainly does NOT meet the difficulty. */
const unsolved = (challenge: string): string => {
  const bits = bitsOf(challenge);
  for (let i = 0; ; i++) if (zerosOf(challenge, `n${i}`) < bits) return `n${i}`;
};

describe('getDemoConfig', () => {
  it('ships disabled and with the decided defaults', () => {
    expect(getDemoConfig({})).toEqual({
      enabled: false,
      dailyGenerations: 150,
      perIpGenerationsPerDay: 2,
      perNetGenerationsPerDay: 20,
      maxConcurrent: 4,
      maxConcurrentPerIp: 1,
      powBits: 18,
      mockTtlMinutes: 30,
      mockMaxRequests: 150,
      ipMockRequestsPerDay: 300,
      maxEndpoints: 5,
    });
  });

  it('reads the DEMO_* variables and ignores garbage', () => {
    const cfg = getDemoConfig({
      DEMO_ENABLED: 'true',
      DEMO_DAILY_GENERATIONS: '40',
      DEMO_PER_IP_GENERATIONS: '1',
      DEMO_PER_NET_GENERATIONS: '7',
      DEMO_MAX_CONCURRENT: '2',
      DEMO_POW_BITS: '20',
      DEMO_MOCK_TTL_MINUTES: '10',
    });
    expect(cfg).toMatchObject({ enabled: true, dailyGenerations: 40, perIpGenerationsPerDay: 1, perNetGenerationsPerDay: 7, maxConcurrent: 2, powBits: 20, mockTtlMinutes: 10 });
    const bad = getDemoConfig({ DEMO_ENABLED: 'maybe', DEMO_DAILY_GENERATIONS: 'abc', DEMO_POW_BITS: '-3', DEMO_MAX_CONCURRENT: '1e9' });
    expect(bad.enabled).toBe(false);
    expect(bad.dailyGenerations).toBe(150);
    expect(bad.powBits).toBe(18);
    expect(bad.maxConcurrent).toBe(4);
  });

  it('caps the proof-of-work difficulty so a typo cannot make the demo unsolvable', () => {
    expect(getDemoConfig({ DEMO_POW_BITS: '60' }).powBits).toBe(18);
  });
});

describe('pseudonymizeIp', () => {
  it('is stable for the same address on the same UTC day and changes the next day', () => {
    const a = pseudonymizeIp('203.0.113.7', T0);
    expect(pseudonymizeIp('203.0.113.7', new Date(T0.getTime() + 3600_000))).toBe(a);
    expect(pseudonymizeIp('203.0.113.7', new Date(T0.getTime() + DAY))).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs between addresses', () => {
    expect(pseudonymizeIp('203.0.113.7', T0)).not.toBe(pseudonymizeIp('203.0.113.8', T0));
  });

  it('groups IPv6 by /64 so changing the interface id does not evade a limit', () => {
    const a = pseudonymizeIp('2001:db8:abcd:12:1111:2222:3333:4444', T0);
    expect(pseudonymizeIp('2001:db8:abcd:12:aaaa:bbbb:cccc:dddd', T0)).toBe(a);
    expect(pseudonymizeIp('2001:0DB8:abcd:0012::1', T0)).toBe(a);
    expect(pseudonymizeIp('2001:db8:abcd:13:1111:2222:3333:4444', T0)).not.toBe(a);
  });

  it('treats an IPv4-mapped IPv6 address as the IPv4 one', () => {
    expect(pseudonymizeIp('::ffff:1.2.3.4', T0)).toBe(pseudonymizeIp('1.2.3.4', T0));
    expect(pseudonymizeIp('::ffff:0102:0304', T0)).toBe(pseudonymizeIp('1.2.3.4', T0));
  });

  it('never contains the address in clear', () => {
    for (const ip of ['203.0.113.7', '2001:db8:abcd:12::1', 'not-an-ip']) {
      const out = pseudonymizeIp(ip, T0);
      expect(out).not.toContain(ip);
      expect(out).not.toContain('203.0.113');
      expect(out).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('depends on the secret', () => {
    const a = pseudonymizeIp('203.0.113.7', T0);
    process.env.DEMO_HMAC_SECRET = 'another-secret-with-more-than-32-characters!!';
    expect(pseudonymizeIp('203.0.113.7', T0)).not.toBe(a);
  });
});

describe('pseudonymizeNet (the /48 of an IPv6 address)', () => {
  it('is the same for every /64 inside one /48 and different for another /48', () => {
    const a = pseudonymizeNet('2001:db8:abcd:0001::1', T0);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(pseudonymizeNet('2001:db8:abcd:ffff:1111:2222:3333:4444', T0)).toBe(a);
    expect(pseudonymizeNet('2001:0DB8:abcd::9', T0)).toBe(a);
    expect(pseudonymizeNet('2001:db8:abce:0001::1', T0)).not.toBe(a);
  });

  it('has none for IPv4, an IPv4-mapped IPv6 address or something that is not an address (IPv4 is untouched)', () => {
    expect(pseudonymizeNet('203.0.113.7', T0)).toBeNull();
    expect(pseudonymizeNet('::ffff:1.2.3.4', T0)).toBeNull();
    expect(pseudonymizeNet('not-an-ip', T0)).toBeNull();
  });

  it('changes every UTC day, depends on the secret, never contains the address and is not the /64 pseudonym', () => {
    const ip = '2001:db8:abcd:12::1';
    const a = pseudonymizeNet(ip, T0);
    expect(pseudonymizeNet(ip, new Date(T0.getTime() + DAY))).not.toBe(a);
    expect(a).not.toBe(pseudonymizeIp(ip, T0));
    expect(a).not.toContain('2001');
    expect(a).not.toContain('abcd');
    process.env.DEMO_HMAC_SECRET = 'another-secret-with-more-than-32-characters!!';
    expect(pseudonymizeNet(ip, T0)).not.toBe(a);
  });
});

describe('proof of work', () => {
  beforeEach(() => {
    process.env.DEMO_POW_BITS = '8';
  });

  it('issues a signed challenge with the configured difficulty and an expiry', () => {
    const c = issueChallenge(T0);
    expect(c.bits).toBe(8);
    expect(new Date(c.expiresAt).getTime()).toBeGreaterThan(T0.getTime());
    expect(c.challenge.split('.')).toHaveLength(2);
  });

  it('accepts a nonce found by brute force', async () => {
    const { challenge } = issueChallenge(T0);
    await expect(verifyProof(challenge, solve(challenge), T0)).resolves.toEqual({ ok: true });
  });

  it('rejects a nonce without enough work', async () => {
    process.env.DEMO_POW_BITS = '24';
    const { challenge } = issueChallenge(T0);
    const result = await verifyProof(challenge, 'a', T0);
    expect(result).toEqual({ ok: false, reason: 'insufficient_work' });
  });

  it('rejects a challenge whose difficulty was lowered (the signature covers the bits)', async () => {
    process.env.DEMO_POW_BITS = '24';
    const { challenge } = issueChallenge(T0);
    const [payload, sig] = challenge.split('.');
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    data.bits = 1;
    const forged = `${Buffer.from(JSON.stringify(data)).toString('base64url')}.${sig}`;
    await expect(verifyProof(forged, solve(forged), T0)).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects an altered signature and a challenge signed with another secret', async () => {
    const { challenge } = issueChallenge(T0);
    const [payload, sig] = challenge.split('.');
    const flipped = `${payload}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
    await expect(verifyProof(flipped, 'x', T0)).resolves.toEqual({ ok: false, reason: 'bad_signature' });
    process.env.DEMO_HMAC_SECRET = 'a-completely-different-secret-of-enough-length!';
    await expect(verifyProof(challenge, solve(challenge), T0)).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects an expired challenge', async () => {
    const { challenge, expiresAt } = issueChallenge(T0);
    const later = new Date(new Date(expiresAt).getTime() + 1000);
    await expect(verifyProof(challenge, solve(challenge), later)).resolves.toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects the reuse of a solved challenge', async () => {
    const { challenge } = issueChallenge(T0);
    const nonce = solve(challenge);
    await expect(verifyProof(challenge, nonce, T0)).resolves.toEqual({ ok: true });
    await expect(verifyProof(challenge, nonce, T0)).resolves.toEqual({ ok: false, reason: 'replayed' });
  });

  it('lets exactly one of several simultaneous verifications of the same challenge through', async () => {
    const { challenge } = issueChallenge(T0);
    const nonce = solve(challenge);
    const results = await Promise.all(Array.from({ length: 20 }, () => verifyProof(challenge, nonce, T0)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === 'replayed')).toHaveLength(19);
  });

  it('does not burn the challenge when the work was insufficient', async () => {
    const { challenge } = issueChallenge(T0);
    await expect(verifyProof(challenge, unsolved(challenge), T0)).resolves.toEqual({ ok: false, reason: 'insufficient_work' });
    await expect(verifyProof(challenge, solve(challenge), T0)).resolves.toEqual({ ok: true });
  });

  it.each([
    ['', ''],
    ['garbage', 'x'],
    ['a.b.c', 'x'],
    ['.', 'x'],
    ['!!!.???', 'x'],
    [`${Buffer.from('{"id":1}').toString('base64url')}.${Buffer.from('x').toString('base64url')}`, 'x'],
    ['a'.repeat(5000), 'x'],
    [undefined as unknown as string, undefined as unknown as string],
    [{} as unknown as string, 5 as unknown as string],
  ])('answers malformed/bad_signature without throwing for %j', async (challenge, nonce) => {
    const result = await verifyProof(challenge, nonce, T0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(['malformed', 'bad_signature']).toContain(result.reason);
  });

  it('rejects an oversized or odd nonce as malformed', async () => {
    const { challenge } = issueChallenge(T0);
    await expect(verifyProof(challenge, 'x'.repeat(200), T0)).resolves.toEqual({ ok: false, reason: 'malformed' });
    await expect(verifyProof(challenge, 'a b\n', T0)).resolves.toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('proof of work split in a pure check and a spend (B7)', () => {
  beforeEach(() => {
    process.env.DEMO_POW_BITS = '8';
  });

  it('checkProof validates shape, signature, expiry and work and writes nothing', async () => {
    const { challenge } = issueChallenge(T0);
    const nonce = solve(challenge);
    const checked = checkProof(challenge, nonce, T0);
    expect(checked.ok).toBe(true);
    // The same solution passes the pure check as many times as you like: only spendChallenge uses it up
    expect(checkProof(challenge, nonce, T0)).toEqual(checked);
    expect(await DemoSpentChallengeModel.countDocuments({})).toBe(0);
    expect(checkProof(challenge, unsolved(challenge), T0)).toEqual({ ok: false, reason: 'insufficient_work' });
    expect(checkProof(challenge, nonce, new Date(T0.getTime() + 10 * 60_000))).toEqual({ ok: false, reason: 'expired' });
    expect(checkProof('nope', 'a', T0)).toEqual({ ok: false, reason: 'malformed' });
    const [payload, sig] = challenge.split('.');
    expect(checkProof(`${payload}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`, 'a', T0)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(await DemoSpentChallengeModel.countDocuments({})).toBe(0);
  });

  it('isChallengeSpent is a read: false until spendChallenge, true afterwards', async () => {
    const { challenge } = issueChallenge(T0);
    const checked = checkProof(challenge, solve(challenge), T0);
    if (!checked.ok) throw new Error('expected a valid proof');
    await expect(isChallengeSpent(checked.id)).resolves.toBe(false);
    await expect(spendChallenge(checked.id, T0)).resolves.toBe(true);
    await expect(isChallengeSpent(checked.id)).resolves.toBe(true);
  });

  it('with 20 simultaneous spends exactly one wins', async () => {
    const { challenge } = issueChallenge(T0);
    const checked = checkProof(challenge, solve(challenge), T0);
    if (!checked.ok) throw new Error('expected a valid proof');
    const results = await Promise.all(Array.from({ length: 20 }, () => spendChallenge(checked.id, T0)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('verifyProof is exactly the two steps: a second verification of the same solution is replayed', async () => {
    const { challenge } = issueChallenge(T0);
    const nonce = solve(challenge);
    await expect(verifyProof(challenge, nonce, T0)).resolves.toEqual({ ok: true });
    await expect(verifyProof(challenge, nonce, T0)).resolves.toEqual({ ok: false, reason: 'replayed' });
  });
});

describe('tryConsumeDemoBudget', () => {
  it('allows two generations per IP and day and refuses the third by IP', async () => {
    process.env.DEMO_DAILY_GENERATIONS = '100';
    const ip = pseudonymizeIp('203.0.113.7', T0);
    await expect(tryConsumeDemoBudget(ip, 'generation', T0)).resolves.toEqual({ ok: true });
    await expect(tryConsumeDemoBudget(ip, 'generation', T0)).resolves.toEqual({ ok: true });
    await expect(tryConsumeDemoBudget(ip, 'generation', T0)).resolves.toEqual({ ok: false, scope: 'ip' });
  });

  it('refuses everyone once the global daily budget is spent, and gives the IP unit back', async () => {
    process.env.DEMO_DAILY_GENERATIONS = '3';
    process.env.DEMO_PER_IP_GENERATIONS = '10';
    const ips = ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4'].map((i) => pseudonymizeIp(i, T0));
    for (const ip of ips.slice(0, 3)) await expect(tryConsumeDemoBudget(ip, 'generation', T0)).resolves.toEqual({ ok: true });
    await expect(tryConsumeDemoBudget(ips[3], 'generation', T0)).resolves.toEqual({ ok: false, scope: 'global' });
    const row = await DemoBudgetModel.findOne({ scope: 'ip', key: ips[3], kind: 'generation' }).lean();
    expect(row?.count ?? 0).toBe(0);
  });

  it('once the global budget is spent a refused visitor creates no row at all, and one already over their limit is still told so (B7)', async () => {
    process.env.DEMO_DAILY_GENERATIONS = '2';
    process.env.DEMO_PER_IP_GENERATIONS = '1';
    const a = pseudonymizeIp('1.1.1.1', T0);
    const b = pseudonymizeIp('2.2.2.2', T0);
    await tryConsumeDemoBudget(a, 'generation', T0);
    await tryConsumeDemoBudget(b, 'generation', T0);
    const rows = await DemoBudgetModel.countDocuments({});
    const fresh = await Promise.all(Array.from({ length: 25 }, (_, i) => tryConsumeDemoBudget(pseudonymizeIp(`9.9.9.${i}`, T0), 'generation', T0)));
    expect(fresh.every((r) => !r.ok && r.scope === 'global')).toBe(true);
    expect(await DemoBudgetModel.countDocuments({})).toBe(rows);
    await expect(tryConsumeDemoBudget(a, 'generation', T0)).resolves.toEqual({ ok: false, scope: 'ip' });
    process.env.DEMO_PER_IP_GENERATIONS = '0';
    await expect(tryConsumeDemoBudget(pseudonymizeIp('8.8.8.8', T0), 'generation', T0)).resolves.toEqual({ ok: false, scope: 'ip' });
  });

  it('with 30 simultaneous calls and a cap of 2 lets exactly 2 through', async () => {
    process.env.DEMO_DAILY_GENERATIONS = '1000';
    const ip = pseudonymizeIp('203.0.113.9', T0);
    const results = await Promise.all(Array.from({ length: 30 }, () => tryConsumeDemoBudget(ip, 'generation', T0)));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok && r.scope === 'ip')).toHaveLength(28);
  });

  it('with many IPs at once never lets the global total pass the cap', async () => {
    process.env.DEMO_DAILY_GENERATIONS = '7';
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => tryConsumeDemoBudget(pseudonymizeIp(`198.51.100.${i}`, T0), 'generation', T0)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(7);
    expect(results.every((r) => r.ok || r.scope === 'global')).toBe(true);
  });

  it('starts again on the next UTC day', async () => {
    const ip = pseudonymizeIp('203.0.113.7', T0);
    await tryConsumeDemoBudget(ip, 'generation', T0);
    await tryConsumeDemoBudget(ip, 'generation', T0);
    const next = new Date(Date.UTC(2026, 9, 10, 0, 0, 1));
    await expect(tryConsumeDemoBudget(pseudonymizeIp('203.0.113.7', next), 'generation', next)).resolves.toEqual({ ok: true });
  });

  it('counts mock requests separately from generations', async () => {
    const ip = pseudonymizeIp('203.0.113.7', T0);
    await tryConsumeDemoBudget(ip, 'generation', T0);
    await tryConsumeDemoBudget(ip, 'generation', T0);
    await expect(tryConsumeDemoBudget(ip, 'mockRequest', T0)).resolves.toEqual({ ok: true });
  });

  it('refuses mock requests past the per-IP daily cap', async () => {
    const ip = pseudonymizeIp('203.0.113.7', T0);
    const results = await Promise.all(Array.from({ length: 320 }, () => tryConsumeDemoBudget(ip, 'mockRequest', T0)));
    expect(results.filter((r) => r.ok)).toHaveLength(300);
  });

  it('stores only the pseudonym and an expiry date for the TTL index', async () => {
    const ip = pseudonymizeIp('203.0.113.7', T0);
    await tryConsumeDemoBudget(ip, 'generation', T0);
    const rows = await DemoBudgetModel.find({}).lean();
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain('203.0.113.7');
    for (const row of rows) expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(T0.getTime() + 47 * 3600_000);
  });
});

describe('the per-network (/48) daily counter (final review I2)', () => {
  const v6 = (net: number, sub: number) => `2001:db8:${net.toString(16)}:${sub.toString(16)}::1`;
  const consume = (ip: string, now = T0) => tryConsumeDemoBudget(pseudonymizeIp(ip, now), 'generation', now, pseudonymizeNet(ip, now));
  const netRows = () => DemoBudgetModel.find({ scope: 'net' }).lean();

  beforeEach(() => {
    process.env.DEMO_DAILY_GENERATIONS = '1000';
  });

  it('200 different /64 inside one /48 get at most DEMO_PER_NET_GENERATIONS generations in all', async () => {
    process.env.DEMO_PER_NET_GENERATIONS = '20';
    const results = [];
    for (let sub = 0; sub < 200; sub++) results.push(await consume(v6(1, sub)));
    expect(results.filter((r) => r.ok)).toHaveLength(20);
    expect(results.filter((r) => !r.ok && r.scope === 'net')).toHaveLength(180);
    expect((await netRows())[0].count).toBe(20);
  });

  it('the refused /64 gets its own unit back (a later counter that refuses releases the earlier ones)', async () => {
    process.env.DEMO_PER_NET_GENERATIONS = '2';
    expect((await consume(v6(1, 1))).ok).toBe(true);
    expect((await consume(v6(1, 2))).ok).toBe(true);
    const refused = await consume(v6(1, 3));
    expect(refused).toEqual({ ok: false, scope: 'net' });
    const row = await DemoBudgetModel.findOne({ scope: 'ip', key: pseudonymizeIp(v6(1, 3), T0), kind: 'generation' }).lean();
    expect(row?.count ?? 0).toBe(0);
    expect((await netRows())[0].count).toBe(2);
  });

  it('two different /48 do not affect each other', async () => {
    process.env.DEMO_PER_NET_GENERATIONS = '3';
    for (let sub = 0; sub < 3; sub++) expect((await consume(v6(1, sub))).ok).toBe(true);
    expect(await consume(v6(1, 9))).toEqual({ ok: false, scope: 'net' });
    for (let sub = 0; sub < 3; sub++) expect((await consume(v6(2, sub))).ok).toBe(true);
  });

  it('IPv4 does not use the counter at all', async () => {
    process.env.DEMO_PER_NET_GENERATIONS = '1';
    for (let host = 1; host <= 10; host++) expect((await consume(`203.0.113.${host}`)).ok).toBe(true);
    expect(await netRows()).toHaveLength(0);
  });

  it('a /64 over its own limit is still told so (the order is /64 -> /48 -> global)', async () => {
    process.env.DEMO_PER_IP_GENERATIONS = '1';
    process.env.DEMO_PER_NET_GENERATIONS = '5';
    expect((await consume(v6(1, 1))).ok).toBe(true);
    expect(await consume(v6(1, 1))).toEqual({ ok: false, scope: 'ip' });
    // a different /64 of the same network is not over ITS limit: it is the network's turn to answer
    expect((await consume(v6(1, 2))).ok).toBe(true);
    expect((await netRows())[0].count).toBe(2);
  });

  it('when the global budget refuses, the /64 and the /48 units both go back', async () => {
    process.env.DEMO_DAILY_GENERATIONS = '1';
    process.env.DEMO_PER_NET_GENERATIONS = '10';
    expect((await consume(v6(1, 1))).ok).toBe(true);
    // The global budget is now spent: a plain read refuses, writing nothing
    expect(await consume(v6(1, 2))).toEqual({ ok: false, scope: 'global' });
    expect((await netRows())[0].count).toBe(1);
    expect(await DemoBudgetModel.countDocuments({ scope: 'ip' })).toBe(1);
  });

  it('with the global slot taken in between, the later refusal gives both counters back', async () => {
    // Race: the pre-check passes (budget left), the atomic global increment loses to someone else
    process.env.DEMO_DAILY_GENERATIONS = '5';
    process.env.DEMO_PER_NET_GENERATIONS = '1000';
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => consume(v6(3, i))));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.every((r) => r.ok || r.scope === 'global')).toBe(true);
    expect((await netRows())[0].count).toBe(5);
    const ipSum = (await DemoBudgetModel.find({ scope: 'ip' }).lean()).reduce((n, r) => n + r.count, 0);
    expect(ipSum).toBe(5);
  });

  it('refundDemoBudget gives the /48 unit back too, and peekDemoBudget shows the tighter of the two', async () => {
    process.env.DEMO_PER_IP_GENERATIONS = '5';
    process.env.DEMO_PER_NET_GENERATIONS = '3';
    const ip = v6(1, 1);
    const ipHash = pseudonymizeIp(ip, T0);
    const netHash = pseudonymizeNet(ip, T0);
    await tryConsumeDemoBudget(ipHash, 'generation', T0, netHash);
    await tryConsumeDemoBudget(ipHash, 'generation', T0, netHash);
    await expect(peekDemoBudget(ipHash, T0, netHash)).resolves.toEqual({ ipLeft: 1, globalLeft: 1000 - 2 });
    await refundDemoBudget(ipHash, 'generation', T0, netHash);
    await expect(peekDemoBudget(ipHash, T0, netHash)).resolves.toEqual({ ipLeft: 2, globalLeft: 1000 - 1 });
    expect((await netRows())[0].count).toBe(1);
    // another /64 of the same /48 has used the rest of the network's allowance: the visitor sees what is really left
    const other = v6(1, 2);
    await tryConsumeDemoBudget(pseudonymizeIp(other, T0), 'generation', T0, netHash);
    await tryConsumeDemoBudget(pseudonymizeIp(other, T0), 'generation', T0, netHash);
    await expect(peekDemoBudget(ipHash, T0, netHash)).resolves.toMatchObject({ ipLeft: 0 });
  });

  it('starts again on the next UTC day', async () => {
    process.env.DEMO_PER_NET_GENERATIONS = '1';
    expect((await consume(v6(1, 1))).ok).toBe(true);
    expect((await consume(v6(1, 2))).ok).toBe(false);
    const next = new Date(T0.getTime() + DAY);
    expect((await consume(v6(1, 2), next)).ok).toBe(true);
  });

  it('stores only a pseudonym, with the same 48 h expiry as the other counters', async () => {
    await consume(v6(1, 1));
    const [row] = await netRows();
    expect(JSON.stringify(row)).not.toContain('2001');
    expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(T0.getTime() + 47 * 3600_000);
  });

  it('a limit of 0 refuses every IPv6 generation by network and leaves IPv4 alone', async () => {
    process.env.DEMO_PER_NET_GENERATIONS = '0';
    expect(await consume(v6(1, 1))).toEqual({ ok: false, scope: 'net' });
    expect((await consume('203.0.113.9')).ok).toBe(true);
  });
});

describe('refundDemoBudget and peekDemoBudget (B3)', () => {
  const count = async (scope: 'ip' | 'global', key: string, kind: 'generation' | 'mockRequest' = 'generation') =>
    (await DemoBudgetModel.findOne({ scope, key, kind }).lean())?.count ?? 0;

  it('gives back one generation unit to the visitor and to the global budget, atomically', async () => {
    const ip = pseudonymizeIp('203.0.113.7', T0);
    await tryConsumeDemoBudget(ip, 'generation', T0);
    await tryConsumeDemoBudget(ip, 'generation', T0);
    expect(await count('ip', ip)).toBe(2);
    expect(await count('global', 'global')).toBe(2);

    await refundDemoBudget(ip, 'generation', T0);
    expect(await count('ip', ip)).toBe(1);
    expect(await count('global', 'global')).toBe(1);
    await expect(tryConsumeDemoBudget(ip, 'generation', T0)).resolves.toEqual({ ok: true });
  });

  it('never takes a counter below zero, however many refunds arrive', async () => {
    const ip = pseudonymizeIp('203.0.113.7', T0);
    await tryConsumeDemoBudget(ip, 'generation', T0);
    await Promise.all(Array.from({ length: 10 }, () => refundDemoBudget(ip, 'generation', T0)));
    expect(await count('ip', ip)).toBe(0);
    expect(await count('global', 'global')).toBe(0);
    await refundDemoBudget(pseudonymizeIp('198.51.100.1', T0), 'generation', T0); // nothing to refund: no row, no error
    expect(await DemoBudgetModel.countDocuments({ key: pseudonymizeIp('198.51.100.1', T0) })).toBe(0);
  });

  it('refunds the UTC day it is told (a refund after midnight does not touch the new day)', async () => {
    const ip = pseudonymizeIp('203.0.113.7', T0);
    await tryConsumeDemoBudget(ip, 'generation', T0);
    const nextDay = new Date(Date.UTC(2026, 9, 10, 0, 5, 0));
    await tryConsumeDemoBudget(pseudonymizeIp('203.0.113.7', nextDay), 'generation', nextDay);
    await refundDemoBudget(ip, 'generation', T0);
    expect(await DemoBudgetModel.countDocuments({ day: '2026-10-09', scope: 'ip', count: 0 })).toBe(1);
    expect(await DemoBudgetModel.countDocuments({ day: '2026-10-10', scope: 'ip', count: 1 })).toBe(1);
  });

  it('refunds a mock request only to the visitor (the global budget is for generations)', async () => {
    const ip = pseudonymizeIp('203.0.113.7', T0);
    await tryConsumeDemoBudget(ip, 'generation', T0);
    await tryConsumeDemoBudget(ip, 'mockRequest', T0);
    await refundDemoBudget(ip, 'mockRequest', T0);
    expect(await count('ip', ip, 'mockRequest')).toBe(0);
    expect(await count('global', 'global')).toBe(1);
  });

  it('peekDemoBudget reads what is left today without consuming anything', async () => {
    process.env.DEMO_DAILY_GENERATIONS = '3';
    const ip = pseudonymizeIp('203.0.113.7', T0);
    await expect(peekDemoBudget(ip, T0)).resolves.toEqual({ ipLeft: 2, globalLeft: 3 });
    await tryConsumeDemoBudget(ip, 'generation', T0);
    await expect(peekDemoBudget(ip, T0)).resolves.toEqual({ ipLeft: 1, globalLeft: 2 });
    await tryConsumeDemoBudget(ip, 'generation', T0);
    await expect(peekDemoBudget(ip, T0)).resolves.toEqual({ ipLeft: 0, globalLeft: 1 });
    expect(await count('ip', ip)).toBe(2);
  });
});

describe('acquireGenerationSlot', () => {
  it('lets one generation per IP at a time until it is released', () => {
    const release = acquireGenerationSlot('ip-a');
    expect(release).not.toBeNull();
    expect(acquireGenerationSlot('ip-a')).toBeNull();
    release!();
    const again = acquireGenerationSlot('ip-a');
    expect(again).not.toBeNull();
    again!();
  });

  it('release is idempotent and cannot free a slot twice', () => {
    process.env.DEMO_MAX_CONCURRENT = '2';
    const first = acquireGenerationSlot('ip-a')!;
    first();
    first();
    const a = acquireGenerationSlot('ip-b');
    const b = acquireGenerationSlot('ip-c');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(acquireGenerationSlot('ip-d')).toBeNull();
    a!();
    b!();
  });

  it('caps the total number of simultaneous generations', () => {
    process.env.DEMO_MAX_CONCURRENT = '3';
    const held = ['a', 'b', 'c'].map((ip) => acquireGenerationSlot(ip));
    expect(held.every(Boolean)).toBe(true);
    expect(acquireGenerationSlot('d')).toBeNull();
    held[0]!();
    const d = acquireGenerationSlot('d');
    expect(d).not.toBeNull();
    d!();
    held[1]!();
    held[2]!();
  });
});

describe('assertProdConfig and the demo', () => {
  const prod = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
    NODE_ENV: 'production',
    CORS_ORIGIN: 'https://app.mockia.io',
    MONGODB_URI: 'mongodb://mockia:s3cr3t-Pr0d-pass@mongo:27017/mockia?authSource=admin',
    APP_URL: 'https://app.mockia.io',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    ...extra,
  });

  it('does not ask for anything when the demo is off', () => {
    expect(() => assertProdConfig(prod())).not.toThrow();
    expect(() => assertProdConfig(prod({ DEMO_ENABLED: 'false' }))).not.toThrow();
  });

  it.each([undefined, '', 'short-secret'])('rejects an enabled demo with DEMO_HMAC_SECRET %p, without echoing it', (secret) => {
    let message = '';
    try {
      assertProdConfig(prod({ DEMO_ENABLED: 'true', DEMO_HMAC_SECRET: secret }));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/DEMO_HMAC_SECRET/);
    if (secret) expect(message).not.toContain(secret);
  });

  it('accepts an enabled demo with a long enough secret', () => {
    expect(() => assertProdConfig(prod({ DEMO_ENABLED: 'true', DEMO_HMAC_SECRET: 'z'.repeat(40) }))).not.toThrow();
  });
});
