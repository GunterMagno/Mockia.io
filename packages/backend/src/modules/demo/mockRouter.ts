import { Router, type NextFunction, type Request, type Response } from 'express';
import { getDemoConfig } from './config.js';
import { pseudonymizeIp } from './ipHash.js';
import { tryConsumeDemoBudget } from './budget.js';
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
 * Only requests that are actually served count: unknown demo/route/method, refused requests and OPTIONS do not.
 */

/** Clock of the router (UTC day and expiry). Tests replace `now` to cross an expiry or a day without waiting. */
export const demoClock = { now: (): Date => new Date() };

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

// Express 4 does not catch rejections of async handlers: forward them or a DB failure would kill the process.
demoMockRouter.all(['/:demoId', '/:demoId/*'], (req: Request, res: Response, next: NextFunction) => {
  handleDemoMock(req, res).catch(next);
});
