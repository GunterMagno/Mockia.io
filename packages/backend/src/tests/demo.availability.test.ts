import request from 'supertest';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { DemoBudgetModel } from '../models/DemoBudget.js';
import { demoClock } from '../modules/demo/mockRouter.js';
import { DEMO_API_FLOOD_MAX, resetDemoApiLimits } from '../modules/demo/routes.js';
import { skipsGlobalLimiter } from '../middlewares/rateLimit.js';
import { tryConsumeDemoBudget } from '../modules/demo/budget.js';

/**
 * GET /api/demo/availability: the one question the site header and the landing page ask on every page load ("show the
 * demo links?"). It must be cheap and anonymous (no visitor address, no budget write) and must NOT use up the demo's
 * per-address flood guard or the general /api limiter: behind a shared NAT (a university, an office) browsing the site
 * would otherwise take away the visitors' own demo requests (Review Focus 1).
 */

const SECRET = 'demo-test-secret-with-more-than-32-chars!!';
const KEYS = ['DEMO_ENABLED', 'DEMO_HMAC_SECRET', 'DEMO_DAILY_GENERATIONS', 'DEMO_PER_IP_GENERATIONS'] as const;
const saved: Record<string, string | undefined> = {};

describe('demo publica: disponibilidad (GET /api/demo/availability)', () => {
  const trustProxyBefore = app.get('trust proxy');

  beforeAll(async () => {
    await connectDB();
    await DemoBudgetModel.init();
    app.set('trust proxy', 1);
  });
  afterAll(async () => {
    app.set('trust proxy', trustProxyBefore);
    await disconnectDB();
  });
  beforeEach(async () => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.DEMO_HMAC_SECRET = SECRET;
    process.env.DEMO_ENABLED = 'true';
    demoClock.now = () => new Date();
    resetDemoApiLimits();
    await DemoBudgetModel.deleteMany({});
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetDemoApiLimits();
  });

  const get = (ip = '203.0.113.9') => request(app).get('/api/demo/availability').set('X-Forwarded-For', ip);

  it('answers { available } and nothing else, publicly cacheable for a minute', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ available: true });
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('is false when the demo is off (also in production without DEMO_HMAC_SECRET) and when the global budget is spent', async () => {
    process.env.DEMO_ENABLED = 'false';
    delete process.env.DEMO_HMAC_SECRET;
    const off = await get();
    expect(off.status).toBe(200);
    expect(off.body.data).toEqual({ available: false });
    expect(off.headers['cache-control']).toBe('public, max-age=60');

    process.env.DEMO_ENABLED = 'true';
    process.env.DEMO_HMAC_SECRET = SECRET;
    process.env.DEMO_DAILY_GENERATIONS = '1';
    resetDemoApiLimits();
    expect((await get()).body.data.available).toBe(true);
    expect((await tryConsumeDemoBudget('some-pseudonym', 'generation', new Date())).ok).toBe(true);
    resetDemoApiLimits();
    expect((await get()).body.data.available).toBe(false);
  });

  it('touches no address and writes nothing: no budget document is created, no visitor number is revealed', async () => {
    const res = await get('198.51.100.77');
    expect(JSON.stringify(res.body)).not.toMatch(/remainingToday|maxEndpoints|198\.51\.100\.77/);
    expect(await DemoBudgetModel.countDocuments({})).toBe(0);
  });

  it('does not count against the demo flood guard: many calls from one address never take the visitor\'s own requests', async () => {
    const ip = '192.0.2.50';
    for (let i = 0; i < DEMO_API_FLOOD_MAX + 20; i += 1) {
      expect((await get(ip)).status).toBe(200);
    }
    // The same address still has its whole allowance for the routes that do count
    const status = await request(app).get('/api/demo/status').set('X-Forwarded-For', ip);
    expect(status.status).toBe(200);
  });

  it('is exempt from the general /api limiter, and only that exact GET route', () => {
    expect(skipsGlobalLimiter('GET', '/demo/availability')).toBe(true);
    expect(skipsGlobalLimiter('GET', '/demo/availability/')).toBe(true);
    expect(skipsGlobalLimiter('HEAD', '/demo/availability')).toBe(true);
    expect(skipsGlobalLimiter('POST', '/demo/availability')).toBe(false);
    expect(skipsGlobalLimiter('GET', '/demo/status')).toBe(false);
    expect(skipsGlobalLimiter('POST', '/demo/generate')).toBe(false);
    expect(skipsGlobalLimiter('GET', '/demo/availability/extra')).toBe(false);
  });
});
