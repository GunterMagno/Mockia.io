import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { AiCallModel, type AiCallOutcome } from '../models/AiCall.js';
import { DemoBudgetModel } from '../models/DemoBudget.js';
import { UserModel } from '../models/User.js';
import { createOpsRouter } from '../modules/ops/routes.js';
import { getLlm, getLlmStatus, resetLlm } from '../modules/ai/providers/index.js';
import { openRouterConfig } from '../config/ai.js';
import { assertProdConfig } from '../config/assertProdConfig.js';
import { errorHandler, notFoundHandler } from '../middlewares/errorHandler.js';
import { utcDay } from '../modules/demo/ipHash.js';

/**
 * Task O3 (Review Focus: nothing personal leaves, and the endpoint does not exist unless the owner turns it on).
 * GET /api/ops/summary is what the monitor (A3) and the post-deploy check (A4) read. It answers only to a long bearer
 * token from the environment, and says nothing that identifies a person.
 */

const TOKEN = 'ops-test-token-0123456789-abcdefghijklmnop'; // 43 chars
const HMAC = 'ops-test-hmac-secret-0123456789-abcdefghijklmnop';
const auth = { Authorization: `Bearer ${TOKEN}` };

const HOUR = 60 * 60 * 1000;

const call = (
  outcome: AiCallOutcome,
  ageMs: number,
  scope: 'users' | 'demo' | 'byok' = 'users'
) => ({
  at: new Date(Date.now() - ageMs),
  scope,
  plan: scope === 'demo' ? ('anonymous' as const) : ('free' as const),
  provider: 'local',
  model: outcome === 'ok' ? 'm' : 'unknown',
  outcome,
  latencyMs: 12,
});

const ENV_KEYS = [
  'OPS_TOKEN',
  'DEMO_ENABLED',
  'DEMO_HMAC_SECRET',
  'DEMO_DAILY_GENERATIONS',
  'RENDER_GIT_COMMIT',
  'GIT_COMMIT',
  'AI_PROVIDERS',
  'AI_LOCAL_BASE_URL',
  'AI_LOCAL_MODEL',
  'AI_LOCAL_TIMEOUT_MS',
];

describe('/api/ops/summary', () => {
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    await connectDB();
    await AiCallModel.init();
    await DemoBudgetModel.init();
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });

  beforeEach(async () => {
    process.env.OPS_TOKEN = TOKEN;
    process.env.DEMO_HMAC_SECRET = HMAC;
    process.env.DEMO_ENABLED = 'true';
    process.env.DEMO_DAILY_GENERATIONS = '100';
    delete process.env.RENDER_GIT_COMMIT;
    delete process.env.GIT_COMMIT;
    await AiCallModel.deleteMany({});
    await DemoBudgetModel.deleteMany({});
    resetLlm();
  });

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetLlm();
    await AiCallModel.deleteMany({});
    await DemoBudgetModel.deleteMany({});
    await disconnectDB();
  });

  describe('(a) access', () => {
    it('does not exist (404, like any unknown route) when OPS_TOKEN is not set, whatever token is sent', async () => {
      delete process.env.OPS_TOKEN;
      const res = await request(app).get('/api/ops/summary').set(auth);
      expect(res.status).toBe(404);
      const unknown = await request(app).get('/api/ops/nothing-here');
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe(res.body.error.code);
    });

    it('an empty or too short OPS_TOKEN (< 32 chars) counts as not set: 404, even with the matching token', async () => {
      process.env.OPS_TOKEN = '   ';
      expect((await request(app).get('/api/ops/summary')).status).toBe(404);
      process.env.OPS_TOKEN = 'short-token';
      const res = await request(app)
        .get('/api/ops/summary')
        .set({ Authorization: 'Bearer short-token' });
      expect(res.status).toBe(404);
    });

    it('401 without a hint when the token is missing, wrong, or not a bearer token', async () => {
      const wrong = [
        undefined,
        'Bearer ',
        'Bearer nope',
        `Bearer ${TOKEN}x`,
        `Bearer ${TOKEN.slice(0, -1)}`,
        `Basic ${TOKEN}`,
        TOKEN,
      ];
      const bodies = new Set<string>();
      for (const header of wrong) {
        const req = request(app).get('/api/ops/summary');
        const res = header === undefined ? await req : await req.set('Authorization', header);
        expect(res.status).toBe(401);
        bodies.add(JSON.stringify({ ...res.body, timestamp: undefined }));
        expect(JSON.stringify(res.body)).not.toContain(TOKEN);
      }
      expect(bodies.size).toBe(1);
    });

    it('200 with the exact shape for the right token, and it is never cached', async () => {
      const res = await request(app).get('/api/ops/summary').set(auth);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toMatch(/no-store/);
      const data = res.body;
      expect(Object.keys(data).sort()).toEqual(['ai', 'caller', 'db', 'demo', 'generatedAt']);
      expect(typeof data.generatedAt).toBe('string');
      expect(Number.isNaN(Date.parse(data.generatedAt))).toBe(false);
      expect(data.db).toEqual({ ok: true });
      expect(Object.keys(data.demo).sort()).toEqual(
        ['dailyLimit', 'enabled', 'generationsToday', 'usedRatio'].sort()
      );
      expect(data.demo).toEqual({
        enabled: true,
        generationsToday: 0,
        dailyLimit: 100,
        usedRatio: 0,
      });
      expect(Object.keys(data.ai).sort()).toEqual(['breakers', 'last60m']);
      expect(data.ai.last60m).toEqual({ calls: 0, errors: 0, errorRatio: 0, byScope: {} });
      expect(data.ai.breakers).toEqual(expect.any(Object));
      expect(Object.keys(data.caller)).toEqual(['pseudonym']);
    });

    it('a user session token is not the ops token (401)', async () => {
      const res = await request(app)
        .get('/api/ops/summary')
        .set({ Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.x' });
      expect(res.status).toBe(401);
    });

    it('only GET: other methods with the right token do not read or change anything (404)', async () => {
      const res = await request(app).post('/api/ops/summary').set(auth).send({});
      expect(res.status).toBe(404);
    });
  });

  describe('(b) AI calls of the last hour', () => {
    it('10 calls, 4 failed: errorRatio 0.4; calls from 2 h ago do not count', async () => {
      await AiCallModel.insertMany([
        ...Array.from({ length: 6 }, () => call('ok', 5 * 60 * 1000)),
        ...Array.from({ length: 4 }, () => call('error', 10 * 60 * 1000)),
        call('error', 2 * HOUR),
        call('ok', 2 * HOUR),
        call('refused', 61 * 60 * 1000),
      ]);
      const res = await request(app).get('/api/ops/summary').set(auth);
      expect(res.body.ai.last60m.calls).toBe(10);
      expect(res.body.ai.last60m.errors).toBe(4);
      expect(res.body.ai.last60m.errorRatio).toBe(0.4);
    });

    it('every outcome other than ok is an error (invalid, truncated, timeout, refused, error)', async () => {
      await AiCallModel.insertMany([
        call('ok', 1000),
        call('invalid', 1000),
        call('truncated', 1000),
        call('timeout', 1000),
        call('refused', 1000),
        call('error', 1000),
      ]);
      const { ai } = (await request(app).get('/api/ops/summary').set(auth)).body;
      expect(ai.last60m.calls).toBe(6);
      expect(ai.last60m.errors).toBe(5);
      expect(ai.last60m.errorRatio).toBeCloseTo(5 / 6, 3);
    });

    it('byScope splits calls and errors by who made them', async () => {
      await AiCallModel.insertMany([
        call('ok', 1000, 'users'),
        call('error', 1000, 'users'),
        call('ok', 1000, 'demo'),
        call('timeout', 1000, 'demo'),
        call('timeout', 1000, 'demo'),
      ]);
      const { ai } = (await request(app).get('/api/ops/summary').set(auth)).body;
      expect(ai.last60m.byScope).toEqual({
        users: { calls: 2, errors: 1 },
        demo: { calls: 3, errors: 2 },
      });
    });

    it('no calls: errorRatio is 0, not NaN', async () => {
      const { ai } = (await request(app).get('/api/ops/summary').set(auth)).body;
      expect(ai.last60m).toEqual({ calls: 0, errors: 0, errorRatio: 0, byScope: {} });
    });
  });

  describe('(c) demo budget', () => {
    it('80 of 100 generations spent today: usedRatio 0.8; yesterday does not count', async () => {
      const expiresAt = new Date(Date.now() + 48 * HOUR);
      await DemoBudgetModel.create([
        {
          day: utcDay(new Date()),
          scope: 'global',
          key: 'global',
          kind: 'generation',
          count: 80,
          expiresAt,
        },
        {
          day: utcDay(new Date(Date.now() - 24 * HOUR)),
          scope: 'global',
          key: 'global',
          kind: 'generation',
          count: 99,
          expiresAt,
        },
        // a visitor's own counter is not the demo total
        {
          day: utcDay(new Date()),
          scope: 'ip',
          key: 'abc',
          kind: 'generation',
          count: 2,
          expiresAt,
        },
      ]);
      const { demo } = (await request(app).get('/api/ops/summary').set(auth)).body;
      expect(demo).toEqual({
        enabled: true,
        generationsToday: 80,
        dailyLimit: 100,
        usedRatio: 0.8,
      });
    });

    it('demo off or limit 0: usedRatio 0, never NaN or Infinity', async () => {
      process.env.DEMO_ENABLED = 'false';
      process.env.DEMO_DAILY_GENERATIONS = '0';
      const { demo } = (await request(app).get('/api/ops/summary').set(auth)).body;
      expect(demo).toEqual({ enabled: false, generationsToday: 0, dailyLimit: 0, usedRatio: 0 });
    });
  });

  describe('(d) circuit breakers', () => {
    let dead: string;

    beforeEach(async () => {
      // a port nothing listens on: every call is refused at once
      const probe = http.createServer();
      await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
      dead = `http://127.0.0.1:${(probe.address() as AddressInfo).port}`;
      await new Promise<void>((r) => probe.close(() => r()));
      process.env.AI_PROVIDERS = 'local';
      process.env.AI_LOCAL_BASE_URL = dead;
      process.env.AI_LOCAL_MODEL = 'm';
      process.env.AI_LOCAL_TIMEOUT_MS = '300';
      resetLlm();
    });

    const messages = [{ role: 'user' as const, content: 'x' }];

    it('getLlmStatus: closed while healthy, open after 3 failures, keyed by scope and provider, no URL or key', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        getLlm(process.env, 'users');
        expect(getLlmStatus()).toEqual({
          'users:local': { scope: 'users', provider: 'local', breaker: 'closed' },
        });
        for (let i = 0; i < 3; i++)
          await getLlm()
            .complete({ messages })
            .catch(() => undefined);
        const status = getLlmStatus();
        expect(status['users:local']).toEqual({
          scope: 'users',
          provider: 'local',
          breaker: 'open',
        });
        expect(JSON.stringify(status)).not.toContain(dead);
        expect(JSON.stringify(status)).not.toMatch(/https?:|127\.0\.0\.1|key/i);
      } finally {
        warn.mockRestore();
      }
    });

    it('a provider without breaker (the reserve) is listed as closed; the demo chain is its own entry', async () => {
      process.env.AI_PROVIDERS = 'local,openrouter';
      resetLlm();
      getLlm(process.env, 'users');
      getLlm(process.env, 'demo');
      const status = getLlmStatus();
      expect(Object.keys(status).sort()).toEqual([
        'demo:local',
        'demo:openrouter',
        'users:local',
        'users:openrouter',
      ]);
      expect(Object.values(status).every((s) => s.breaker === 'closed')).toBe(true);
    });

    it('the summary shows the open breaker', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const savedKey = openRouterConfig.apiKey;
      try {
        for (let i = 0; i < 3; i++)
          await getLlm()
            .complete({ messages })
            .catch(() => undefined);
        const res = await request(app).get('/api/ops/summary').set(auth);
        expect(res.body.ai.breakers['users:local']).toEqual({
          scope: 'users',
          provider: 'local',
          breaker: 'open',
        });
      } finally {
        openRouterConfig.apiKey = savedKey;
        warn.mockRestore();
      }
    });

    it('resetLlm forgets the chains: nothing to report', () => {
      getLlm();
      resetLlm();
      expect(getLlmStatus()).toEqual({});
    });
  });

  describe('(e) nothing personal', () => {
    it('with users, calls and demo counters in the database, the answer holds no email, user id or IP', async () => {
      const user = await UserModel.create({
        email: 'someone.private@example.com',
        username: 'someone-private',
        passwordHash: 'x'.repeat(60),
      });
      await UserModel.deleteMany({ _id: { $ne: user._id } });
      await AiCallModel.insertMany([call('ok', 1000), call('error', 1000, 'demo')]);
      await DemoBudgetModel.create({
        day: utcDay(new Date()),
        scope: 'ip',
        key: 'a'.repeat(64),
        kind: 'generation',
        count: 1,
        expiresAt: new Date(Date.now() + 48 * HOUR),
      });
      process.env.GIT_COMMIT = 'abcdef0123456789';
      const res = await request(app)
        .get('/api/ops/summary')
        .set(auth)
        .set('X-Forwarded-For', '203.0.113.77');
      const text = JSON.stringify(res.body);
      expect(res.status).toBe(200);
      expect(text).not.toMatch(/@/);
      expect(text).not.toContain(user._id.toString());
      expect(text).not.toContain('someone');
      expect(text).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(HMAC);
      // the only long hex string is the caller's pseudonym, and it is not an address
      const longHex = text.match(/[0-9a-f]{32,}/gi) ?? [];
      expect(longHex).toHaveLength(1);
      expect(longHex[0]).toBe(res.body.caller.pseudonym);
      await UserModel.deleteMany({});
    });
  });

  describe('(f) caller.pseudonym tells whether X-Forwarded-For can be forged', () => {
    const miniApp = (trustProxy: number) => {
      const a = express();
      a.set('trust proxy', trustProxy);
      a.use('/api/ops', createOpsRouter());
      a.use(notFoundHandler);
      a.use(errorHandler);
      return a;
    };
    const pseudonymFor = async (a: express.Express, xff: string) =>
      (await request(a).get('/api/ops/summary').set(auth).set('X-Forwarded-For', xff)).body.caller
        .pseudonym as string;

    it('trusting no proxy hop: the header is ignored, two different values give the same pseudonym', async () => {
      const a = miniApp(0);
      const p1 = await pseudonymFor(a, '198.51.100.1');
      const p2 = await pseudonymFor(a, '198.51.100.2');
      expect(p1).toMatch(/^[0-9a-f]{64}$/);
      expect(p2).toBe(p1);
    });

    it('trusting 2 hops with a single real one: the client-supplied value is used, the pseudonyms differ (spoofable)', async () => {
      const a = miniApp(2);
      const p1 = await pseudonymFor(a, '198.51.100.1');
      const p2 = await pseudonymFor(a, '198.51.100.2');
      expect(p1).not.toBe(p2);
    });

    it('is null without DEMO_HMAC_SECRET in production (never a made-up value)', async () => {
      delete process.env.DEMO_HMAC_SECRET;
      const savedEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const res = await request(miniApp(0)).get('/api/ops/summary').set(auth);
        expect(res.status).toBe(200);
        expect(res.body.caller).toEqual({ pseudonym: null });
      } finally {
        process.env.NODE_ENV = savedEnv;
      }
    });

    it('is null without DEMO_HMAC_SECRET even outside production (no per-process random value reaches the monitor)', async () => {
      delete process.env.DEMO_HMAC_SECRET;
      const res = await request(miniApp(0)).get('/api/ops/summary').set(auth);
      expect(res.body.caller).toEqual({ pseudonym: null });
    });
  });

  describe('limiter', () => {
    it('60 requests per minute per IP is the default; the 61st is 429 even with a wrong token (brute force)', async () => {
      const a = express();
      a.use('/api/ops', createOpsRouter());
      a.use(notFoundHandler);
      a.use(errorHandler);
      for (let i = 0; i < 60; i++) {
        const res = await request(a).get('/api/ops/summary').set('Authorization', 'Bearer wrong');
        expect(res.status).toBe(401);
      }
      const limited = await request(a).get('/api/ops/summary').set(auth);
      expect(limited.status).toBe(429);
    });

    it('without OPS_TOKEN the endpoint does not count anyone (it does not exist)', async () => {
      delete process.env.OPS_TOKEN;
      const a = express();
      a.use('/api/ops', createOpsRouter({ max: 2 }));
      a.use(notFoundHandler);
      a.use(errorHandler);
      for (let i = 0; i < 5; i++) {
        expect((await request(a).get('/api/ops/summary')).status).toBe(404);
      }
    });
  });

  describe('(h) /api/health carries the deployed commit', () => {
    it('RENDER_GIT_COMMIT first, then GIT_COMMIT', async () => {
      process.env.RENDER_GIT_COMMIT = 'render-sha-1';
      process.env.GIT_COMMIT = 'git-sha-2';
      expect((await request(app).get('/api/health')).body.commit).toBe('render-sha-1');
      delete process.env.RENDER_GIT_COMMIT;
      expect((await request(app).get('/api/health')).body.commit).toBe('git-sha-2');
    });

    it('null when neither is set (or both are blank)', async () => {
      expect((await request(app).get('/api/health')).body.commit).toBeNull();
      process.env.GIT_COMMIT = '  ';
      expect((await request(app).get('/api/health')).body.commit).toBeNull();
    });

    it('keeps the fields it already had', async () => {
      const body = (await request(app).get('/api/health')).body;
      expect(body.status).toBe('ok');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('database');
    });
  });
});

describe('(g) assertProdConfig and OPS_TOKEN', () => {
  const base = {
    NODE_ENV: 'production',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    MONGODB_URI: 'mongodb://user:s3cr3tpass@mongo:27017/mockia?authSource=admin',
    CORS_ORIGIN: 'https://app.example.com',
    APP_URL: 'https://app.example.com',
  } as NodeJS.ProcessEnv;

  it('rejects an OPS_TOKEN shorter than 32 characters, naming the variable but not echoing the value', () => {
    const short = 'secret-ops-1234567890';
    let message = '';
    try {
      assertProdConfig({ ...base, OPS_TOKEN: short });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/OPS_TOKEN/);
    expect(message).toMatch(/32/);
    expect(message).not.toContain(short);
  });

  it('a whitespace-padded token is measured trimmed (a 31-char token with a space is still short)', () => {
    expect(() => assertProdConfig({ ...base, OPS_TOKEN: ` ${'x'.repeat(31)} ` })).toThrow(
      /OPS_TOKEN/
    );
  });

  it('accepts a token of 32 characters or more, and an unset or empty one (the endpoint is then off)', () => {
    expect(() => assertProdConfig({ ...base, OPS_TOKEN: 'x'.repeat(32) })).not.toThrow();
    expect(() => assertProdConfig({ ...base, OPS_TOKEN: '' })).not.toThrow();
    expect(() => assertProdConfig(base)).not.toThrow();
  });

  it('outside production it never throws', () => {
    expect(() =>
      assertProdConfig({ ...base, NODE_ENV: 'development', OPS_TOKEN: 'short' })
    ).not.toThrow();
  });
});
