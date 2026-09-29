/**
 * Engine tests without Mongo: mockRouter is mounted on a bare Express app with the cache/resolver mocked.
 * Covers verbs, forced status, custom headers, jitter latency, multipart, malformed JSON and async failures.
 */
import express from 'express';
import request from 'supertest';

const getProject = jest.fn();
const getEndpointConfig = jest.fn();
const resolveRoute = jest.fn();

jest.mock('../modules/mock/mockCache.service.js', () => ({
  mockCache: {
    getProject: (...a: unknown[]) => getProject(...a),
    getEndpointConfig: (...a: unknown[]) => getEndpointConfig(...a),
  },
}));
jest.mock('../modules/mock/routeResolution.service.js', () => ({
  resolveRoute: (...a: unknown[]) => resolveRoute(...a),
}));

import { mockRouter } from '../modules/mock/mockRouter.js';

const endpoint = (responses: Array<Record<string, unknown>>) => ({
  _id: { toString: () => 'ep1' },
  responses,
});

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.all('/mock/:projectSlug/*', mockRouter);
  // Same contract as the real errorHandler for what matters here: JSON body, never a crash.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status || err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

describe('mockRouter engine', () => {
  const app = buildApp();

  beforeEach(() => {
    jest.resetAllMocks();
    getProject.mockResolvedValue({ slug: 'p', apiKey: '' });
    getEndpointConfig.mockResolvedValue(null);
    resolveRoute.mockResolvedValue({
      endpoint: endpoint([{ is_default: true, statusCode: 200, examples: [{ ok: true }] }]),
      pathParams: {},
    });
  });

  it.each(['get', 'post', 'put', 'patch', 'delete'] as const)('serves the default response for %s', async (verb) => {
    const res = await (request(app) as any)[verb]('/mock/p/items').send(verb === 'get' ? undefined : { a: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(resolveRoute).toHaveBeenCalledWith('p', verb.toUpperCase(), '/items');
  });

  it('HEAD answers with headers and no body', async () => {
    const res = await request(app).head('/mock/p/items');
    expect(res.status).toBe(200);
    expect(res.text ?? '').toBe('');
  });

  it('applies forced status, generated error body and sanitized custom headers', async () => {
    getEndpointConfig.mockResolvedValue({
      force_status_code: 503,
      headers: { 'X-Test': 'yes', 'Set-Cookie': 'sid=1', Connection: 'close', 'X-Inject': 'a\r\nb' },
    });
    const res = await request(app).get('/mock/p/items');
    expect(res.status).toBe(503);
    expect(res.body).toBeTruthy();
    expect(res.headers['x-test']).toBe('yes');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['x-inject']).toBeUndefined();
  });

  it('forced 204 has no body; out-of-range stored status falls back instead of throwing', async () => {
    getEndpointConfig.mockResolvedValue({ force_status_code: 204 });
    expect((await request(app).get('/mock/p/items')).status).toBe(204);

    getEndpointConfig.mockResolvedValue(null);
    resolveRoute.mockResolvedValue({
      endpoint: endpoint([{ is_default: true, statusCode: 99999, examples: [{ ok: true }] }]),
      pathParams: {},
    });
    const res = await request(app).get('/mock/p/items');
    expect(res.status).toBe(200);
  });

  it('latency: waits about delay_ms, jitter stays bounded, absurd values are capped by clamp (not awaited in full)', async () => {
    getEndpointConfig.mockResolvedValue({ delay_ms: 150, jitter_ms: 20 });
    const t0 = Date.now();
    await request(app).get('/mock/p/items').expect(200);
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(120);
    expect(took).toBeLessThan(1500);
  });

  it('multipart/form-data bodies do not crash the engine', async () => {
    const res = await request(app)
      .post('/mock/p/upload')
      .field('name', 'x')
      .attach('file', Buffer.from('hello'), 'a.txt');
    expect(res.status).toBe(200);
  });

  it('malformed JSON body yields a controlled 4xx JSON error, not a crash', async () => {
    const res = await request(app).post('/mock/p/items').set('Content-Type', 'application/json').send('{"a":');
    expect(res.status).toBe(400);
  });

  it('a rejected async dependency becomes an error response instead of an unhandled rejection', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    getProject.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/mock/p/items');
    expect(res.status).toBe(500);
    await new Promise((r) => setImmediate(r));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('unknown project gives 404 and wrong API key gives 401', async () => {
    getProject.mockResolvedValueOnce(null);
    expect((await request(app).get('/mock/nope/x')).status).toBe(404);
    getProject.mockResolvedValueOnce({ slug: 'p', apiKey: 'secret' });
    expect((await request(app).get('/mock/p/x')).status).toBe(401);
  });
});
