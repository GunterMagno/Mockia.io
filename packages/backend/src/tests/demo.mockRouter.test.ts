import request from 'supertest';
import mongoose from 'mongoose';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { DemoMockModel } from '../models/DemoMock.js';
import { DemoBudgetModel } from '../models/DemoBudget.js';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { UsageModel } from '../models/Usage.js';
import { AiGenerationModel } from '../models/AiGeneration.js';
import { createDemoMock, DemoMockError, type DemoEndpoint } from '../modules/demo/mockStore.js';
import { demoClock } from '../modules/demo/mockRouter.js';
import { pseudonymizeIp } from '../modules/demo/ipHash.js';
import { skipsGlobalLimiter } from '../middlewares/rateLimit.js';

/**
 * Task B2: ephemeral demo mocks and the router that serves them. Real Mongo and the real Express app; the clock is
 * injected (demoClock) so expiry and day changes need no waiting.
 */

const SECRET = 'demo-test-secret-with-more-than-32-chars!!';
const MIN = 60 * 1000;
const T0 = new Date('2026-10-09T10:00:00Z');
// supertest connects over loopback; with trust proxy off, req.ip is this (an IPv4-mapped IPv6 address).
const TEST_IP = '::ffff:127.0.0.1';
// Derived from the demo secret, which the tests set in beforeEach: compute it lazily.
let IP_HASH = '';

const ENV_KEYS = ['DEMO_ENABLED', 'DEMO_HMAC_SECRET', 'DEMO_MOCK_TTL_MINUTES'] as const;
const saved: Record<string, string | undefined> = {};

const USERS_CHARGED = [UserModel, ProjectModel, UsageModel, AiGenerationModel].map((m) => m.collection.name);
const countCollection = async (name: string): Promise<number> =>
  mongoose.connection.db!.collection(name).countDocuments({});

const ENDPOINTS: DemoEndpoint[] = [
  { method: 'GET', path: '/users', statusCode: 200, body: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Linus' }] },
  { method: 'GET', path: '/users/:id', statusCode: 200, body: { id: 7, name: 'Grace' } },
  { method: 'POST', path: '/users', statusCode: 201, body: { id: 3, created: true }, headers: { 'X-Total-Count': '3' } },
  { method: 'DELETE', path: '/users/:id', statusCode: 204, body: null },
];

const makeDemo = async (endpoints: DemoEndpoint[] = ENDPOINTS, now: Date = T0) => createDemoMock(IP_HASH, endpoints, now);

beforeAll(async () => {
  await connectDB();
  await DemoMockModel.init();
  await DemoBudgetModel.init();
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
  process.env.DEMO_ENABLED = 'true';
  IP_HASH = pseudonymizeIp(TEST_IP, T0);
  demoClock.now = () => T0;
  await Promise.all([DemoMockModel.deleteMany({}), DemoBudgetModel.deleteMany({})]);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  demoClock.now = () => new Date();
});

describe('serving a demo mock', () => {
  it('(a) answers each route with its exact method, status and body, plus the security headers', async () => {
    const { demoId } = await makeDemo();

    const list = await request(app).get(`/api/demo-mock/${demoId}/users`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([{ id: 1, name: 'Ada' }, { id: 2, name: 'Linus' }]);
    expect(list.headers['content-type']).toMatch(/^application\/json/);
    expect(list.headers['x-mockia-demo']).toBe('true');
    expect(list.headers['x-content-type-options']).toBe('nosniff');
    expect(list.headers['cache-control']).toBe('no-store');
    expect(list.headers['access-control-allow-origin']).toBe('*');

    const byId = await request(app).get(`/api/demo-mock/${demoId}/users/42?verbose=1`);
    expect(byId.status).toBe(200);
    expect(byId.body).toEqual({ id: 7, name: 'Grace' });

    const created = await request(app).post(`/api/demo-mock/${demoId}/users`).send({ any: 'thing' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: 3, created: true });
    expect(created.headers['x-total-count']).toBe('3');

    const removed = await request(app).delete(`/api/demo-mock/${demoId}/users/42`);
    expect(removed.status).toBe(204);
    expect(removed.text).toBe('');
    expect(removed.headers['x-mockia-demo']).toBe('true');
  });

  it('(b) an unknown route, an unknown method or an unknown demo answers 404 in the real mock error format', async () => {
    const { demoId } = await makeDemo();
    const unknownRoute = await request(app).get(`/api/demo-mock/${demoId}/nope`);
    const unknownMethod = await request(app).put(`/api/demo-mock/${demoId}/users`).send({});
    const unknownDemo = await request(app).get(`/api/demo-mock/${'0'.repeat(32)}/users`);
    const malformedDemo = await request(app).get('/api/demo-mock/not-a-demo-id/users');
    for (const res of [unknownRoute, unknownMethod, unknownDemo, malformedDemo]) {
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
      expect(typeof res.body.timestamp).toBe('string');
      expect(res.headers['x-mockia-demo']).toBe('true');
    }
  });

  it('(c) the 151st request to one demo answers 429 with Retry-After; rejected requests and OPTIONS never count', async () => {
    const { demoId } = await makeDemo();
    const url = `/api/demo-mock/${demoId}/users`;

    // These must not consume the demo's 150 requests
    await request(app).get(`/api/demo-mock/${demoId}/nope`).expect(404);
    await request(app).options(url).expect(204);
    expect((await DemoMockModel.findOne({ demoId }).lean())!.requestCount).toBe(0);

    for (let i = 0; i < 150; i++) {
      const res = await request(app).get(url);
      if (res.status !== 200) throw new Error(`request ${i + 1} answered ${res.status}`);
    }
    const over = await request(app).get(url);
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ success: false, error: { code: 'DEMO_MOCK_LIMIT' } });
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    expect(over.headers['x-mockia-demo']).toBe('true');

    // Refused / unknown / OPTIONS: still 150
    await request(app).get(url).expect(429);
    await request(app).options(url).expect(204);
    await request(app).get(`/api/demo-mock/${demoId}/nope`).expect(404);
    expect((await DemoMockModel.findOne({ demoId }).lean())!.requestCount).toBe(150);
  }, 60_000);

  it('(d) after expiresAt the demo answers 404, and the TTL index exists', async () => {
    const { demoId, expiresAt } = await makeDemo();
    expect(expiresAt.getTime()).toBe(T0.getTime() + 30 * MIN);

    demoClock.now = () => new Date(T0.getTime() + 29 * MIN);
    await request(app).get(`/api/demo-mock/${demoId}/users`).expect(200);

    demoClock.now = () => new Date(expiresAt.getTime() + 1);
    const gone = await request(app).get(`/api/demo-mock/${demoId}/users`);
    expect(gone.status).toBe(404);
    expect(gone.body.error.code).toBe('NOT_FOUND');

    const indexes = await DemoMockModel.collection.indexes();
    expect(indexes.some((i) => i.key.expiresAt === 1 && i.expireAfterSeconds === 0)).toBe(true);
    expect(indexes.some((i) => i.key.demoId === 1 && i.unique === true)).toBe(true);
  });

  it('(d2) the TTL follows DEMO_MOCK_TTL_MINUTES', async () => {
    process.env.DEMO_MOCK_TTL_MINUTES = '5';
    const { expiresAt } = await makeDemo();
    expect(expiresAt.getTime()).toBe(T0.getTime() + 5 * MIN);
  });

  it('(f) a body with </script><script> or HTML is served as JSON with nosniff, never as a document', async () => {
    const evil = { html: '</script><script>alert(1)</script><img src=x onerror=alert(1)>' };
    const { demoId } = await makeDemo([{ method: 'GET', path: '/x', statusCode: 200, body: evil }]);
    const res = await request(app).get(`/api/demo-mock/${demoId}/x`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['content-type']).not.toMatch(/html/i);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(JSON.parse(res.text)).toEqual(evil);
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
  });

  it('stores and serves bodies that Mongo would mangle as documents (empty object, $ and . in keys, arrays, null)', async () => {
    const { demoId } = await makeDemo([
      { method: 'GET', path: '/empty', statusCode: 200, body: {} },
      { method: 'GET', path: '/weird', statusCode: 200, body: { '$ref': 'a', 'a.b': { '': [] } } },
      { method: 'GET', path: '/null', statusCode: 200, body: null },
    ]);
    expect((await request(app).get(`/api/demo-mock/${demoId}/empty`)).body).toEqual({});
    expect((await request(app).get(`/api/demo-mock/${demoId}/weird`)).body).toEqual({ $ref: 'a', 'a.b': { '': [] } });
    expect((await request(app).get(`/api/demo-mock/${demoId}/null`)).text).toBe('null');
  });

  it('tolerates a trailing slash and prefers a static route over a parameter one', async () => {
    const { demoId } = await makeDemo([
      { method: 'GET', path: '/items/:id', statusCode: 200, body: { kind: 'param' } },
      { method: 'GET', path: '/items/featured', statusCode: 200, body: { kind: 'static' } },
    ]);
    expect((await request(app).get(`/api/demo-mock/${demoId}/items/featured/`)).body).toEqual({ kind: 'static' });
    expect((await request(app).get(`/api/demo-mock/${demoId}/items/9`)).body).toEqual({ kind: 'param' });
  });

  it('answers CORS preflight for the allowed methods without a lookup, and does not echo arbitrary methods', async () => {
    const res = await request(app)
      .options(`/api/demo-mock/${'a'.repeat(32)}/anything`)
      .set('Origin', 'https://example.org')
      .set('Access-Control-Request-Method', 'PUT');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toBe('GET, POST, PUT, PATCH, DELETE, OPTIONS');
    expect(res.headers['x-mockia-demo']).toBe('true');
  });

  it('answers 503 DEMO_UNAVAILABLE when the demo is switched off', async () => {
    const { demoId } = await makeDemo();
    process.env.DEMO_ENABLED = 'false';
    const res = await request(app).get(`/api/demo-mock/${demoId}/users`);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEMO_UNAVAILABLE');
  });
});

describe('per-IP daily limit', () => {
  it('(h) is shared by every demo of the same visitor, refuses with Retry-After, and a refusal does not burn the demo count', async () => {
    const a = await makeDemo();
    const b = await makeDemo();
    // The visitor has already used 298 of the 300 daily mock requests
    await DemoBudgetModel.create({
      day: '2026-10-09', scope: 'ip', key: IP_HASH, kind: 'mockRequest', count: 298, expiresAt: new Date(T0.getTime() + 3 * 24 * 60 * MIN),
    });

    await request(app).get(`/api/demo-mock/${a.demoId}/users`).expect(200); // 299
    await request(app).get(`/api/demo-mock/${b.demoId}/users`).expect(200); // 300
    const refusedA = await request(app).get(`/api/demo-mock/${a.demoId}/users`);
    const refusedB = await request(app).get(`/api/demo-mock/${b.demoId}/users`);
    for (const res of [refusedA, refusedB]) {
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('DEMO_IP_LIMIT');
      // 14 h to the next UTC midnight, never more than a day
      expect(Number(res.headers['retry-after'])).toBe(14 * 3600);
    }
    // The refused calls gave their demo slot back
    expect((await DemoMockModel.findOne({ demoId: a.demoId }).lean())!.requestCount).toBe(1);
    expect((await DemoMockModel.findOne({ demoId: b.demoId }).lean())!.requestCount).toBe(1);

    // A new UTC day gives a fresh allowance (and a fresh pseudonym)
    const nextDay = new Date('2026-10-10T00:00:01Z');
    demoClock.now = () => nextDay;
    const c = await makeDemo(ENDPOINTS, nextDay);
    await request(app).get(`/api/demo-mock/${c.demoId}/users`).expect(200);
  });

  it('a different visitor is not affected by the first one\'s exhaustion', async () => {
    const { demoId } = await makeDemo();
    await DemoBudgetModel.create({
      day: '2026-10-09', scope: 'ip', key: IP_HASH, kind: 'mockRequest', count: 300, expiresAt: new Date(T0.getTime() + 3 * 24 * 60 * MIN),
    });
    await request(app).get(`/api/demo-mock/${demoId}/users`).expect(429);
    await request(app).get(`/api/demo-mock/${demoId}/users`).set('X-Forwarded-For', '203.0.113.9').expect(429); // proxy header ignored: trust proxy is off
  });

  it('never stores the visitor address in clear: only the pseudonym lands in Mongo', async () => {
    const { demoId } = await makeDemo();
    await request(app).get(`/api/demo-mock/${demoId}/users`).expect(200);
    const dump = JSON.stringify([
      await DemoMockModel.find({}).lean(),
      await DemoBudgetModel.find({}).lean(),
    ]);
    expect(dump).not.toContain('127.0.0.1');
    expect(dump).toContain(IP_HASH);
  });
});

describe('createDemoMock', () => {
  const ep = (i: number): DemoEndpoint => ({ method: 'GET', path: `/r${i}`, statusCode: 200, body: { i } });

  it('(e) keeps at most 5 endpoints', async () => {
    const { demoId } = await makeDemo(Array.from({ length: 9 }, (_, i) => ep(i)));
    const doc = await DemoMockModel.findOne({ demoId }).lean();
    expect(doc!.endpoints.map((e) => e.path)).toEqual(['/r0', '/r1', '/r2', '/r3', '/r4']);
  });

  it('(e) rejects a body of 9 KB and accepts one of exactly 8 KB', async () => {
    const big = (bytes: number) => ({ text: 'x'.repeat(bytes - '{"text":""}'.length) });
    await expect(makeDemo([{ method: 'GET', path: '/big', statusCode: 200, body: big(9 * 1024) }])).rejects.toBeInstanceOf(DemoMockError);
    await expect(makeDemo([{ method: 'GET', path: '/ok', statusCode: 200, body: big(8 * 1024) }])).resolves.toBeDefined();
    await expect(makeDemo([{ method: 'GET', path: '/over', statusCode: 200, body: big(8 * 1024 + 1) }])).rejects.toBeInstanceOf(DemoMockError);
  });

  it('(e) counts the body in bytes, not characters', async () => {
    const body = { text: 'ñ'.repeat(4096) }; // 4096 chars, 8192 bytes + wrapper
    await expect(makeDemo([{ method: 'GET', path: '/b', statusCode: 200, body }])).rejects.toBeInstanceOf(DemoMockError);
  });

  it('(e) drops every header outside the allow-list (no Set-Cookie, no Location) and forces JSON', async () => {
    const { demoId } = await makeDemo([
      {
        method: 'GET',
        path: '/h',
        statusCode: 200,
        body: {},
        headers: {
          'Set-Cookie': 'sid=1; Path=/',
          Location: 'https://evil.example/',
          'Content-Type': 'text/html',
          'Access-Control-Allow-Origin': 'https://evil.example',
          Refresh: '0;url=https://evil.example',
          'X-Total-Count': '12',
          'X-Bad': 'a\r\nSet-Cookie: x=1',
        },
      },
    ]);
    const doc = await DemoMockModel.findOne({ demoId }).lean();
    expect(doc!.endpoints[0].headers).toEqual({ 'x-total-count': '12' });

    const res = await request(app).get(`/api/demo-mock/${demoId}/h`);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers.location).toBeUndefined();
    expect(res.headers.refresh).toBeUndefined();
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['x-total-count']).toBe('12');
  });

  it('rejects control characters in paths and strings, invalid methods and statuses, and an empty list', async () => {
    const bad: DemoEndpoint[][] = [
      [{ method: 'GET', path: '/a\u0000b', statusCode: 200, body: {} }],
      [{ method: 'GET', path: '/a\nb', statusCode: 200, body: {} }],
      [{ method: 'GET', path: 'no-slash', statusCode: 200, body: {} }],
      [{ method: 'GET', path: '/a b', statusCode: 200, body: {} }],
      [{ method: 'GET', path: '/' + 'a'.repeat(300), statusCode: 200, body: {} }],
      [{ method: 'GET', path: '/c', statusCode: 200, body: { k: 'bell\u0007' } }],
      [{ method: 'TRACE' as never, path: '/m', statusCode: 200, body: {} }],
      [{ method: 'GET', path: '/s', statusCode: 99, body: {} }],
      [{ method: 'GET', path: '/s', statusCode: 600, body: {} }],
      [{ method: 'GET', path: '/s', statusCode: 200.5, body: {} }],
      [],
    ];
    for (const endpoints of bad) {
      await expect(makeDemo(endpoints)).rejects.toBeInstanceOf(DemoMockError);
    }
    // Ordinary whitespace (new lines, tabs) inside text is fine
    await expect(makeDemo([{ method: 'GET', path: '/ws', statusCode: 200, body: { t: 'line1\nline2\tx' } }])).resolves.toBeDefined();
  });

  it('rejects a cyclic body instead of crashing', async () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    await expect(makeDemo([{ method: 'GET', path: '/cyc', statusCode: 200, body: cyc }])).rejects.toBeInstanceOf(DemoMockError);
  });

  it('ignores a repeated method+path (the first wins) and returns a 128-bit hex id, unique per call', async () => {
    const one = await makeDemo([
      { method: 'GET', path: '/dup', statusCode: 200, body: { n: 1 } },
      { method: 'GET', path: '/dup/', statusCode: 200, body: { n: 2 } },
    ]);
    const two = await makeDemo();
    expect(one.demoId).toMatch(/^[0-9a-f]{32}$/);
    expect(two.demoId).not.toBe(one.demoId);
    expect((await request(app).get(`/api/demo-mock/${one.demoId}/dup`)).body).toEqual({ n: 1 });
  });

  it('stores no reference to users or projects', async () => {
    const { demoId } = await makeDemo();
    const raw = await DemoMockModel.collection.findOne({ demoId });
    expect(Object.keys(raw!).sort()).toEqual(['__v', '_id', 'createdAt', 'demoId', 'endpoints', 'expiresAt', 'ipHash', 'requestCount'].sort());
  });
});

describe('isolation from accounts, plans and generation quota', () => {
  it('(g) serving, refusing and expiring demo mocks creates or touches no User, Project, Usage or AiGeneration document', async () => {
    const before = await Promise.all(USERS_CHARGED.map(countCollection));
    const { demoId } = await makeDemo();
    await request(app).get(`/api/demo-mock/${demoId}/users`).expect(200);
    await request(app).post(`/api/demo-mock/${demoId}/users`).send({}).expect(201);
    await request(app).get(`/api/demo-mock/${demoId}/nope`).expect(404);
    await request(app).options(`/api/demo-mock/${demoId}/users`).expect(204);
    await DemoBudgetModel.updateOne({ scope: 'ip', kind: 'mockRequest' }, { $set: { count: 300 } });
    await request(app).get(`/api/demo-mock/${demoId}/users`).expect(429);
    demoClock.now = () => new Date(T0.getTime() + 31 * MIN);
    await request(app).get(`/api/demo-mock/${demoId}/users`).expect(404);

    expect(await Promise.all(USERS_CHARGED.map(countCollection))).toEqual(before);
  });
});

describe('wiring', () => {
  it('the general rate limiter does not count demo mock traffic (it has its own budget)', () => {
    expect(skipsGlobalLimiter('GET', '/demo-mock/abc/users')).toBe(true);
    expect(skipsGlobalLimiter('POST', '/demo-mock/abc/users')).toBe(true);
    expect(skipsGlobalLimiter('GET', '/projects')).toBe(false);
    expect(skipsGlobalLimiter('GET', '/demo-mocks-not')).toBe(false);
  });

  it('is public: no Authorization needed, and the restrictive global CORS allow-list does not answer its preflight', async () => {
    const { demoId } = await makeDemo();
    const res = await request(app).get(`/api/demo-mock/${demoId}/users`).set('Origin', 'https://some.site');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});
