import { Router, type NextFunction, type Request, type Response } from 'express';
import { getDemoConfig } from './config.js';
import { pseudonymizeIp } from './ipHash.js';
import { tryConsumeDemoBudget } from './budget.js';
import { createFloodLimiter } from './floodLimit.js';
import { DEMO_METHODS, findLiveDemoMock, matchDemoEndpoint, releaseDemoRequest, reserveDemoRequest } from './mockStore.js';

/**
 * Public router of the demo's ephemeral mocks: ALL /api/demo-mock/:demoId/*.
 *
 * It is a separate, deliberately smaller router than the project mocks: no accounts, no plan quota, no API keys, no
 * interceptors, no delays and no custom headers beyond the allow-list stored with the mock. What it serves is
 * attacker-controlled text from our own origin, so every answer is plain JSON with `nosniff`, a CSP that forbids
 * everything and no caching; the demo mock never becomes an HTML page, a download or a redirect.
 *
 * Limits (all enforced here, on the server):
 *  - `mockMaxRequests` served requests per demo mock (atomic counter on the mock);
 *  - `ipMockRequestsPerDay` per visitor, shared by every demo mock of that visitor (DemoBudget, keyed on the daily
 *    pseudonym of req.ip: the address itself is never stored or logged here).
 * Before any of that, a light in-memory flood limiter (FLOOD_MAX requests per FLOOD_WINDOW_MS per visitor) counts EVERY
 * request that reaches the router - OPTIONS, unknown or malformed ids, exhausted mocks - and answers 429 before any
 * Mongo query, so unserved traffic is not free. It is separate from the two limits above and does not consume them.
 * Only requests that are actually served count: unknown demo/route/method, refused requests and OPTIONS do not.
 */

/** Clock of the router (UTC day and expiry). Tests replace `now` to cross an expiry or a day without waiting. */
export const demoClock = { now: (): Date => new Date() };

/** Flood guard (all requests, served or not): per visitor pseudonym, per process. */
export const FLOOD_WINDOW_MS = 60 * 1000;
export const FLOOD_MAX = 120;
const FLOOD_MAX_KEYS = 10_000;
const flood = createFloodLimiter({ windowMs: FLOOD_WINDOW_MS, max: FLOOD_MAX, maxKeys: FLOOD_MAX_KEYS, now: () => demoClock.now().getTime() });
/** Forgets every counter (tests). */
export const resetDemoFlood = (): void => flood.clear();

const ALLOWED_METHODS = [...DEMO_METHODS, 'OPTIONS'].join(', ');
const EXPOSED_HEADERS = 'X-Mockia-Demo, Retry-After, X-Total-Count, X-Page, X-Per-Page, X-Next-Cursor, X-Request-Id';

const errorBody = (code: string, message: string) => ({
  success: false,
  error: { code, message },
  timestamp: new Date().toISOString(),
});

function applyDemoHeaders(res: Response): void {
  res.setHeader('X-Mockia-Demo', 'true');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; sandbox");
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
}

const secondsUntil = (target: Date, now: Date): number => Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 1000));

function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

const notFound = (res: Response, message: string) => res.status(404).json(errorBody('NOT_FOUND', message));

async function handleDemoMock(req: Request, res: Response): Promise<void> {
  applyDemoHeaders(res);

  if (req.method === 'OPTIONS') {
    // Preflight: nothing to look up and nothing to count
    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    res.status(204).end();
    return;
  }

  const cfg = getDemoConfig();
  if (!cfg.enabled) {
    res.status(503).json(errorBody('DEMO_UNAVAILABLE', 'The public demo is not available right now'));
    return;
  }

  const method = req.method;
  if (!(DEMO_METHODS as readonly string[]).includes(method)) {
    notFound(res, 'Route not found');
    return;
  }

  const now = demoClock.now();
  const demoId = String(req.params.demoId ?? '');
  const mock = await findLiveDemoMock(demoId, now);
  if (!mock) {
    notFound(res, 'Demo not found or expired');
    return;
  }

  const endpoint = matchDemoEndpoint(mock.endpoints, method, `/${String(req.params[0] ?? '')}`);
  if (!endpoint) {
    notFound(res, 'Route not found');
    return;
  }

  // From here on the request would be served: take one of this mock's requests, then one of the visitor's day.
  if (!(await reserveDemoRequest(demoId, cfg.mockMaxRequests))) {
    res.setHeader('Retry-After', String(secondsUntil(mock.expiresAt, now)));
    res.status(429).json(errorBody('DEMO_MOCK_LIMIT', `This demo mock already served its ${cfg.mockMaxRequests} requests`));
    return;
  }
  const ipHash = pseudonymizeIp(req.ip || 'unknown', now);
  const budget = await tryConsumeDemoBudget(ipHash, 'mockRequest', now);
  if (!budget.ok) {
    await releaseDemoRequest(demoId);
    res.setHeader('Retry-After', String(secondsUntil(nextUtcMidnight(now), now)));
    res.status(429).json(errorBody('DEMO_IP_LIMIT', 'Daily limit of demo requests reached for your network'));
    return;
  }

  for (const [name, value] of Object.entries(endpoint.headers ?? {})) res.setHeader(name, value);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(endpoint.statusCode);
  if (endpoint.statusCode === 204 || endpoint.statusCode === 304) {
    res.end();
    return;
  }
  // The stored JSON text goes out as it is. res.end (not res.send) avoids a computed ETag and conditional 304s.
  const payload = Buffer.from(endpoint.bodyJson, 'utf8');
  res.setHeader('Content-Length', String(payload.length));
  res.end(payload);
}

export const demoMockRouter = Router();

// First thing, for every path under the mount: no Mongo, no body, just a counter.
demoMockRouter.use((req: Request, res: Response, next: NextFunction) => {
  const verdict = flood.hit(pseudonymizeIp(req.ip || 'unknown', demoClock.now()));
  if (verdict.ok) return next();
  applyDemoHeaders(res);
  res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
  res.status(429).json(errorBody('DEMO_RATE_LIMIT', 'Too many requests. Try again in a moment.'));
});

// Express 4 does not catch rejections of async handlers: forward them or a DB failure would kill the process.
demoMockRouter.all(['/:demoId', '/:demoId/*'], (req: Request, res: Response, next: NextFunction) => {
  handleDemoMock(req, res).catch(next);
});

// Express decodes the path parameters before the handler runs, and a malformed escape (/%E0%A4%A) makes it fail with a
// 400 that the app's error handler would turn into a 500 on a public route. Anything that is not a valid demo URL is
// simply a demo 404; other errors keep their normal path.
demoMockRouter.use((err: Error & { status?: number; statusCode?: number }, req: Request, res: Response, next: NextFunction) => {
  if ((err.status ?? err.statusCode) === 400 && /decode param/i.test(err.message)) {
    applyDemoHeaders(res);
    notFound(res, 'Route not found');
    return;
  }
  next(err);
});
