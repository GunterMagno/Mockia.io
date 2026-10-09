import crypto from 'crypto';
import { connectDB, disconnectDB } from '../config/connection.js';
import { assertProdConfig } from '../config/assertProdConfig.js';
import { getDemoConfig } from '../modules/demo/config.js';
import { pseudonymizeIp } from '../modules/demo/ipHash.js';
import { issueChallenge, verifyProof } from '../modules/demo/pow.js';
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
      DEMO_MAX_CONCURRENT: '2',
      DEMO_POW_BITS: '20',
      DEMO_MOCK_TTL_MINUTES: '10',
    });
    expect(cfg).toMatchObject({ enabled: true, dailyGenerations: 40, perIpGenerationsPerDay: 1, maxConcurrent: 2, powBits: 20, mockTtlMinutes: 10 });
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
