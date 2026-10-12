import request from 'supertest';
import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { UsageModel } from '../models/Usage.js';
import { AiCallModel, type AiCallDocument } from '../models/AiCall.js';
import { RefreshSessionModel } from '../models/RefreshSession.js';
import { assertProdConfig } from '../config/assertProdConfig.js';
import { parseAiPrices } from '../config/aiPrices.js';
import { getAdminMetrics, resetAdminMetricsCache } from '../modules/admin/metrics.js';
import { PLAN_PRICE_USD, type AdminMetrics } from '@mockia/shared';

/**
 * Task P1: GET /api/admin/metrics. Known seeded data, a fixed clock for the exact figures (the function takes `now`)
 * and the real app for the guard, the validation and the cache. Review Focus 4: not an administrator -> 403.
 *
 * Fixed clock: 2026-10-12T10:00Z. A window of 7 days is 2026-10-06 .. 2026-10-12 (UTC days, today included).
 */

const PASSWORD = 'metrics-test-password-1';
const OWNER = 'owner@example.com';
const NOW = new Date('2026-10-12T10:00:00Z');
const at = (iso: string) => new Date(iso);
const DAYS_7 = [
  '2026-10-06',
  '2026-10-07',
  '2026-10-08',
  '2026-10-09',
  '2026-10-10',
  '2026-10-11',
  '2026-10-12',
];

const PRICES = JSON.stringify({
  'openrouter/modelA': { inputPerMTok: 2, outputPerMTok: 10 },
  // a BYOK call is paid by the user, not by the owner: even priced, it never counts as the owner's cost
  'byok-openai/gpt-x': { inputPerMTok: 1000, outputPerMTok: 1000 },
});

interface SeedUser {
  key: string;
  plan?: 'free' | 'starter' | 'pro' | 'team';
  billingStatus?: 'active' | 'past_due' | 'canceled';
  billingInterval?: 'month' | 'year' | null;
  pastDueSince?: Date | null;
  verified: boolean;
  createdAt: Date;
  project?: boolean;
  /** aiGenerations of one monthly Usage document */
  aiGenerations?: number;
}

const SEED: SeedUser[] = [
  { key: 'u1', verified: true, createdAt: at('2026-10-05T09:00:00Z') },
  {
    key: 'u2',
    plan: 'starter',
    billingInterval: 'month',
    verified: true,
    createdAt: at('2026-10-07T09:00:00Z'),
    project: true,
    aiGenerations: 3,
  },
  {
    key: 'u3',
    plan: 'pro',
    billingInterval: 'year',
    verified: true,
    createdAt: at('2026-10-07T18:00:00Z'),
    project: true,
    aiGenerations: 0,
  },
  {
    key: 'u4',
    plan: 'team',
    billingStatus: 'past_due',
    pastDueSince: at('2026-10-10T00:00:00Z'),
    verified: true,
    createdAt: at('2026-10-09T09:00:00Z'),
  },
  {
    key: 'u5',
    plan: 'pro',
    billingStatus: 'canceled',
    verified: true,
    createdAt: at('2026-10-09T10:00:00Z'),
    project: true,
  },
  // unverified, interval unknown (billingInterval unset): counted as monthly. Has a project and AI usage but is not verified
  {
    key: 'u6',
    plan: 'starter',
    billingInterval: null,
    verified: false,
    createdAt: at('2026-10-12T08:00:00Z'),
    project: true,
    aiGenerations: 2,
  },
  { key: 'u7', verified: false, createdAt: at('2026-09-01T09:00:00Z') },
];

type Call = Pick<AiCallDocument, 'at' | 'scope' | 'plan' | 'provider' | 'model' | 'outcome'> &
  Partial<Pick<AiCallDocument, 'inputTokens' | 'outputTokens'>>;

const call = (over: Partial<Call> & Pick<Call, 'at'>, times = 1): Call[] =>
  Array.from({ length: times }, () => ({
    scope: 'users' as const,
    plan: 'starter' as const,
    provider: 'openrouter',
    model: 'modelA',
    outcome: 'ok' as const,
    ...over,
  }));

const AI_CALLS: Call[] = [
  // 10-11: 4 ok with tokens + 2 failures (model unknown, no tokens)
  ...call({ at: at('2026-10-11T10:00:00Z'), inputTokens: 1000, outputTokens: 500 }, 4),
  ...call({ at: at('2026-10-11T11:00:00Z'), model: 'unknown', outcome: 'error' }, 2),
  // 10-12: 6 demo ok (unpriced model) + 1 demo timeout
  ...call(
    {
      at: at('2026-10-12T07:00:00Z'),
      scope: 'demo',
      plan: 'anonymous',
      provider: 'local',
      model: 'modelB',
      inputTokens: 200,
      outputTokens: 100,
    },
    6
  ),
  ...call(
    {
      at: at('2026-10-12T08:00:00Z'),
      scope: 'demo',
      plan: 'anonymous',
      model: 'unknown',
      outcome: 'timeout',
    },
    1
  ),
  // 10-10: 3 BYOK
  ...call(
    {
      at: at('2026-10-10T12:00:00Z'),
      scope: 'byok',
      provider: 'byok-openai',
      model: 'gpt-x',
      inputTokens: 100,
      outputTokens: 50,
    },
    3
  ),
  // 10-01: inside 30 days, outside 7
  ...call({ at: at('2026-10-01T12:00:00Z'), inputTokens: 1000, outputTokens: 500 }, 4),
];

async function seed() {
  const ids: Record<string, Types.ObjectId> = {};
  for (const u of SEED) {
    const doc = await UserModel.create({
      email: `${u.key}@seed.example.com`,
      username: u.key,
      passwordHash: 'x',
      plan: u.plan ?? 'free',
      billingStatus: u.billingStatus ?? 'active',
      billingInterval: u.billingInterval ?? null,
      pastDueSince: u.pastDueSince ?? null,
      emailVerifiedAt: u.verified ? u.createdAt : null,
    });
    await UserModel.collection.updateOne({ _id: doc._id }, { $set: { createdAt: u.createdAt } });
    ids[u.key] = doc._id as Types.ObjectId;
    if (u.project) {
      await ProjectModel.create({
        title: `p-${u.key}`,
        slug: `p-${u.key}`,
        ownerId: doc._id,
        members: [{ userId: doc._id, role: 'owner' }],
      });
    }
    if (u.aiGenerations !== undefined) {
      await UsageModel.create({
        ownerId: doc._id,
        period: '2026-10',
        requests: 5,
        aiGenerations: u.aiGenerations,
      });
    }
  }
  await AiCallModel.insertMany(
    AI_CALLS.map((c) => ({ ...c, latencyMs: 100 })),
    { ordered: true }
  );
  return ids;
}

async function adminAuth() {
  await UserModel.create({
    email: OWNER,
    username: 'owner',
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    emailVerifiedAt: new Date(),
  });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: OWNER, password: PASSWORD });
  expect(login.status).toBe(200);
  return { Authorization: `Bearer ${login.body.data.tokens.accessToken as string}` };
}

async function plainAuth() {
  await UserModel.create({
    email: 'plain@example.com',
    username: 'plain',
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    emailVerifiedAt: new Date(),
  });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'plain@example.com', password: PASSWORD });
  expect(login.status).toBe(200);
  return { Authorization: `Bearer ${login.body.data.tokens.accessToken as string}` };
}

describe('GET /api/admin/metrics', () => {
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    await connectDB();
  });

  beforeEach(async () => {
    process.env = { ...savedEnv, ADMIN_EMAILS: OWNER };
    delete process.env.AI_PRICES_JSON;
    resetAdminMetricsCache();
    await Promise.all([
      UserModel.deleteMany({}),
      ProjectModel.deleteMany({}),
      UsageModel.deleteMany({}),
      AiCallModel.deleteMany({}),
      RefreshSessionModel.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    process.env = savedEnv;
    jest.restoreAllMocks();
    await Promise.all([
      UserModel.deleteMany({}),
      ProjectModel.deleteMany({}),
      UsageModel.deleteMany({}),
      AiCallModel.deleteMany({}),
      RefreshSessionModel.deleteMany({}),
    ]);
    await disconnectDB();
  });

  describe('(a) users, funnel, billing', () => {
    let m: AdminMetrics;
    beforeEach(async () => {
      await seed();
      m = await getAdminMetrics(7, NOW);
    });

    it('counts the accounts by the plan that applies today (past_due out of grace and canceled are free)', () => {
      expect(m.users.total).toBe(7);
      expect(m.users.verified).toBe(5);
      // u1,u5 (canceled pro),u7 free; u2,u6 starter; u3 pro; u4 team (past_due but inside the 7 days of grace)
      expect(m.users.byPlan).toEqual({ free: 3, starter: 2, pro: 1, team: 1 });
    });

    it('lists every UTC day of the window with its registrations (empty days are 0)', () => {
      expect(m.days).toBe(7);
      expect(m.generatedAt).toBe(NOW.toISOString());
      expect(m.users.newPerDay.map((d) => d.day)).toEqual(DAYS_7);
      expect(m.users.newPerDay.map((d) => d.count)).toEqual([0, 2, 0, 2, 0, 0, 1]);
    });

    it('builds the funnel of the cohort registered in the window; each step needs the previous one', () => {
      // cohort: u2,u3,u4,u5,u6. verified: u2..u5. with project (and verified): u2,u3,u5. with AI usage (and the rest): u2
      // (u3 has a Usage document with 0 AI generations; u6 has project and AI usage but never verified)
      expect(m.funnel).toEqual({ registered: 5, verified: 4, withProject: 3, withAiGeneration: 1 });
    });

    it('widens the cohort with the window', async () => {
      resetAdminMetricsCache();
      const m30 = await getAdminMetrics(30, NOW);
      expect(m30.funnel.registered).toBe(6); // + u1 (10-05); u7 (09-01) is older than 30 days
      expect(m30.users.newPerDay).toHaveLength(30);
      expect(m30.users.total).toBe(7);
    });

    it('counts paying accounts only while billingStatus is active, and estimates the MRR from the catalogue', () => {
      // u2 starter month, u6 starter (interval unknown -> monthly), u3 pro year; u4 past_due and u5 canceled do not count
      expect(m.billing.paying).toEqual({ starter: 2, pro: 1, team: 0 });
      const expected = PLAN_PRICE_USD.starter.monthly * 2 + PLAN_PRICE_USD.pro.annual / 12; // 5 + 5 + 290/12
      expect(m.billing.mrrUsdEstimate).toBeCloseTo(expected, 2);
      expect(m.billing.mrrUsdEstimate).toBe(34.17);
    });
  });

  describe('(b) AI per day, tokens and error ratio', () => {
    it('groups the calls by UTC day and scope, with the window total of tokens and errors', async () => {
      await seed();
      const m = await getAdminMetrics(7, NOW);
      expect(m.ai.perDay.map((d) => d.day)).toEqual(DAYS_7);
      const byDay = Object.fromEntries(m.ai.perDay.map((d) => [d.day, d]));
      expect(byDay['2026-10-06']).toEqual({
        day: '2026-10-06',
        calls: 0,
        errors: 0,
        byScope: { users: 0, demo: 0, byok: 0 },
      });
      expect(byDay['2026-10-10']).toEqual({
        day: '2026-10-10',
        calls: 3,
        errors: 0,
        byScope: { users: 0, demo: 0, byok: 3 },
      });
      expect(byDay['2026-10-11']).toEqual({
        day: '2026-10-11',
        calls: 6,
        errors: 2,
        byScope: { users: 6, demo: 0, byok: 0 },
      });
      expect(byDay['2026-10-12']).toEqual({
        day: '2026-10-12',
        calls: 7,
        errors: 1,
        byScope: { users: 0, demo: 7, byok: 0 },
      });
      // 4*1000 + 6*200 + 3*100 in, 4*500 + 6*100 + 3*50 out; the call of 10-01 is outside the window
      expect(m.ai.tokens).toEqual({ input: 5500, output: 2750 });
      expect(m.ai.errorRatio).toBeCloseTo(3 / 16, 6);
    });

    it('a wider window includes older calls', async () => {
      await seed();
      const m = await getAdminMetrics(30, NOW);
      expect(m.ai.perDay.reduce((n, d) => n + d.calls, 0)).toBe(20);
      expect(m.ai.tokens).toEqual({ input: 9500, output: 4750 });
    });

    it('with no calls the ratio is 0 and every day is listed', async () => {
      const m = await getAdminMetrics(7, NOW);
      expect(m.ai.errorRatio).toBe(0);
      expect(m.ai.perDay).toHaveLength(7);
      expect(m.ai.tokens).toEqual({ input: 0, output: 0 });
    });

    it('counts the demo generations per day from the demo scope', async () => {
      await seed();
      const m = await getAdminMetrics(7, NOW);
      expect(m.demo.generationsPerDay.map((d) => d.day)).toEqual(DAYS_7);
      expect(m.demo.generationsPerDay.map((d) => d.count)).toEqual([0, 0, 0, 0, 0, 0, 7]);
    });
  });

  describe('(c) estimated cost from AI_PRICES_JSON', () => {
    it('prices the platform calls that have a price, lists the rest as unpriced and ignores BYOK', async () => {
      process.env.AI_PRICES_JSON = PRICES;
      await seed();
      const m = await getAdminMetrics(7, NOW);
      // modelA: 4000 in * 2 / 1e6 + 2000 out * 10 / 1e6 = 0.028. modelB and the 'unknown' failures have no price.
      expect(m.ai.estimatedCostUsd).toBeCloseTo(0.028, 6);
      expect(m.ai.unpriced).toEqual(['local/modelB', 'openrouter/unknown']);
      // tokens of the unpriced models still add up
      expect(m.ai.tokens.input).toBe(5500);
    });

    it('is null without a table, and nothing is listed as unpriced', async () => {
      await seed();
      const m = await getAdminMetrics(7, NOW);
      expect(m.ai.estimatedCostUsd).toBeNull();
      expect(m.ai.unpriced).toEqual([]);
      expect(m.ai.tokens.input).toBe(5500);
    });

    it('an invalid table is ignored with a warning that does not echo it, and the cost is null', async () => {
      process.env.AI_PRICES_JSON = '{"openrouter/modelA": {"inputPerMTok": 2, SECRET-PRICE-TEXT';
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      await seed();
      const m = await getAdminMetrics(7, NOW);
      expect(m.ai.estimatedCostUsd).toBeNull();
      expect(m.ai.unpriced).toEqual([]);
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).toMatch(/AI_PRICES_JSON/);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET-PRICE-TEXT');
      warn.mockRestore();
    });

    it('prices a longer window cumulatively', async () => {
      process.env.AI_PRICES_JSON = PRICES;
      await seed();
      const m = await getAdminMetrics(30, NOW);
      expect(m.ai.estimatedCostUsd).toBeCloseTo(0.056, 6);
    });
  });

  describe('parseAiPrices', () => {
    it('accepts the documented shape', () => {
      const r = parseAiPrices({ AI_PRICES_JSON: PRICES });
      expect(r.status).toBe('ok');
      if (r.status === 'ok') {
        expect(r.prices.get('openrouter/modelA')).toEqual({ inputPerMTok: 2, outputPerMTok: 10 });
      }
    });

    it.each([undefined, '', '   ', '{}'])('%p means no table', (value) => {
      expect(parseAiPrices({ AI_PRICES_JSON: value }).status).toBe('none');
    });

    it.each([
      '{not json',
      '[]',
      '"text"',
      '42',
      'null',
      '{"a/b": {"inputPerMTok": -1, "outputPerMTok": 1}}',
      '{"a/b": {"inputPerMTok": "1", "outputPerMTok": 1}}',
      '{"a/b": {"inputPerMTok": 1}}',
      '{"a/b": 5}',
      '{"nosep": {"inputPerMTok": 1, "outputPerMTok": 1}}',
    ])('%p is invalid', (value) => {
      expect(parseAiPrices({ AI_PRICES_JSON: value }).status).toBe('invalid');
    });
  });

  describe('(d) nothing personal in the answer', () => {
    it('carries no email, user id or IP address', async () => {
      process.env.AI_PRICES_JSON = PRICES;
      const ids = await seed();
      const auth = await adminAuth();
      const res = await request(app)
        .get('/api/admin/metrics?days=30')
        .set(auth)
        .set('X-Forwarded-For', '203.0.113.9');
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/@/);
      expect(text).not.toContain('seed.example');
      expect(text).not.toContain(OWNER);
      for (const id of Object.values(ids)) expect(text).not.toContain(id.toString());
      expect(text).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
      expect(text).not.toMatch(/[0-9a-f]{24}/);
      expect(text).not.toContain('203.0.113.9');
      expect(res.body.data.users.total).toBe(8); // seed + the administrator
    });

    it('answers { success, data } and is not cacheable by anyone', async () => {
      const auth = await adminAuth();
      const res = await request(app).get('/api/admin/metrics').set(auth);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.headers['cache-control']).toMatch(/no-store/);
      expect(Object.keys(res.body.data).sort()).toEqual(
        ['ai', 'billing', 'days', 'demo', 'funnel', 'generatedAt', 'users'].sort()
      );
    });

    it('uses 30 days when none is given, and accepts 7, 30 and 90', async () => {
      const auth = await adminAuth();
      const dflt = await request(app).get('/api/admin/metrics').set(auth);
      expect(dflt.body.data.days).toBe(30);
      expect(dflt.body.data.users.newPerDay).toHaveLength(30);
      for (const days of [7, 30, 90]) {
        const res = await request(app).get(`/api/admin/metrics?days=${days}`).set(auth);
        expect(res.status).toBe(200);
        expect(res.body.data.days).toBe(days);
      }
    });
  });

  describe('(e) days is validated', () => {
    it.each(['0', '1', '15', '365', '-7', '7.5', 'abc', '', '7;8', '007', '1e1', '30%20'])(
      'days=%p is a 400',
      async (value) => {
        const auth = await adminAuth();
        const res = await request(app).get(`/api/admin/metrics?days=${value}`).set(auth);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    );

    it('a repeated parameter is a 400', async () => {
      const auth = await adminAuth();
      const res = await request(app).get('/api/admin/metrics?days=7&days=30').set(auth);
      expect(res.status).toBe(400);
    });
  });

  describe('(f) only the administrator', () => {
    it('a normal user gets 403 and learns nothing', async () => {
      await seed();
      const auth = await plainAuth();
      const res = await request(app).get('/api/admin/metrics').set(auth);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(JSON.stringify(res.body)).not.toContain('users');
    });

    it('a listed but unverified address gets 403, and no session gets 401', async () => {
      await UserModel.create({
        email: OWNER,
        username: 'owner',
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        emailVerifiedAt: null,
      });
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: OWNER, password: PASSWORD });
      expect(login.status).toBe(200);
      const auth = { Authorization: `Bearer ${login.body.data.tokens.accessToken as string}` };
      expect((await request(app).get('/api/admin/metrics').set(auth)).status).toBe(403);
      expect((await request(app).get('/api/admin/metrics')).status).toBe(401);
    });

    it('a refused request does not compute anything', async () => {
      const auth = await plainAuth();
      const users = jest.spyOn(UserModel, 'aggregate');
      const calls = jest.spyOn(AiCallModel, 'aggregate');
      await request(app).get('/api/admin/metrics').set(auth);
      await request(app).get('/api/admin/metrics?days=bad').set(auth);
      expect(users).not.toHaveBeenCalled();
      expect(calls).not.toHaveBeenCalled();
      users.mockRestore();
      calls.mockRestore();
    });

    it('the guard probe /ping is gone: not even the administrator finds it', async () => {
      const auth = await adminAuth();
      const res = await request(app).get('/api/admin/ping').set(auth);
      expect(res.status).toBe(404);
    });
  });

  describe('(g) cache of 60 seconds per window', () => {
    afterEach(() => jest.restoreAllMocks());

    it('a second call within 60 s does not repeat the aggregations', async () => {
      const auth = await adminAuth();
      const users = jest.spyOn(UserModel, 'aggregate');
      const calls = jest.spyOn(AiCallModel, 'aggregate');
      const first = await request(app).get('/api/admin/metrics?days=7').set(auth);
      expect(first.status).toBe(200);
      const userCalls = users.mock.calls.length;
      const aiCalls = calls.mock.calls.length;
      expect(userCalls).toBeGreaterThan(0);
      expect(aiCalls).toBeGreaterThan(0);
      const second = await request(app).get('/api/admin/metrics?days=7').set(auth);
      expect(second.status).toBe(200);
      expect(users.mock.calls.length).toBe(userCalls);
      expect(calls.mock.calls.length).toBe(aiCalls);
      expect(second.body.data).toEqual(first.body.data);
    });

    it('another window is computed on its own', async () => {
      const auth = await adminAuth();
      const users = jest.spyOn(UserModel, 'aggregate');
      await request(app).get('/api/admin/metrics?days=7').set(auth);
      const afterFirst = users.mock.calls.length;
      await request(app).get('/api/admin/metrics?days=30').set(auth);
      expect(users.mock.calls.length).toBeGreaterThan(afterFirst);
    });

    it('expires after 60 s and the cache holds at most one entry per window', async () => {
      const users = jest.spyOn(UserModel, 'aggregate');
      await getAdminMetrics(7, NOW);
      const n = users.mock.calls.length;
      await getAdminMetrics(7, new Date(NOW.getTime() + 59_000));
      expect(users.mock.calls.length).toBe(n);
      await getAdminMetrics(7, new Date(NOW.getTime() + 61_000));
      expect(users.mock.calls.length).toBeGreaterThan(n);
    });
  });

  describe('indexes the aggregations rely on', () => {
    const keysOf = (model: { schema: { indexes: () => unknown[][] } }) =>
      model.schema.indexes().map(([fields]) => JSON.stringify(fields));

    it('the window of registrations reads User.createdAt through an index', () => {
      expect(keysOf(UserModel)).toContain(JSON.stringify({ createdAt: 1 }));
    });

    it('the funnel lookups hit Project.ownerId and Usage.ownerId, and the AI window AiCall.at', () => {
      expect(keysOf(ProjectModel)).toContain(JSON.stringify({ ownerId: 1 }));
      expect(keysOf(UsageModel).some((k) => k.startsWith('{"ownerId":1'))).toBe(true);
      expect(keysOf(AiCallModel)).toContain(JSON.stringify({ at: 1 }));
    });
  });

  describe('AI_PRICES_JSON in production', () => {
    const validProd = (): NodeJS.ProcessEnv => ({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://app.mockia.io',
      MONGODB_URI: 'mongodb://mockia:s3cr3t-Pr0d-pass@mongo:27017/mockia?authSource=admin',
      APP_URL: 'https://app.mockia.io',
      JWT_ACCESS_SECRET: 'a'.repeat(48),
      JWT_REFRESH_SECRET: 'b'.repeat(48),
    });

    it('accepts it unset, empty or valid', () => {
      expect(() => assertProdConfig(validProd())).not.toThrow();
      expect(() => assertProdConfig({ ...validProd(), AI_PRICES_JSON: '' })).not.toThrow();
      expect(() => assertProdConfig({ ...validProd(), AI_PRICES_JSON: PRICES })).not.toThrow();
    });

    it('rejects an invalid one by name, without echoing any of it', () => {
      const value = '{"openrouter/x": {"inputPerMTok": "SECRET-PRICE-TEXT"}}';
      let message = '';
      try {
        assertProdConfig({ ...validProd(), AI_PRICES_JSON: value });
      } catch (err) {
        message = String(err);
      }
      expect(message).toMatch(/AI_PRICES_JSON/);
      expect(message).not.toContain('SECRET-PRICE-TEXT');
      expect(message).not.toContain('openrouter/x');
    });

    it('never throws outside production', () => {
      expect(() =>
        assertProdConfig({ NODE_ENV: 'development', AI_PRICES_JSON: '{broken' })
      ).not.toThrow();
    });
  });
});
