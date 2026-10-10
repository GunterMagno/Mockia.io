import express, { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { ErrorCode } from '@mockia/shared';
import { AppError } from '../../middlewares/errorHandler.js';
import { requireJsonBody } from '../auth/cookie.js';
import { describeError } from '../../utils/safeErrorLog.js';
import { authenticateToken, type AuthenticatedRequest } from '../../middlewares/authenticateToken.js';
import { requireVerifiedEmail } from '../../middlewares/requireVerifiedEmail.js';
import { enforceProjectLimit } from '../../middlewares/planGate.js';
import { availabilityHandler, challengeHandler, claimHandler, generateHandler, isDemoEnabled, resetChallengeLimiter, statusHandler } from './controller.js';
import { createFloodLimiter } from './floodLimit.js';
import { pseudonymizeIp } from './ipHash.js';
import { demoClock } from './mockRouter.js';
import { DemoRefusal, resetDemoAvailabilityCache } from './service.js';

/**
 * /api/demo: the anonymous entry points of the public demo (status, challenge, generate). Mounted BEFORE the global body
 * parsers and outside authenticateToken: it has its own small JSON parser (6000 characters of text can take up to 36 KB
 * once JSON-escaped, so 48 KB; nothing near the 1 MB of the rest of the API), its own error handling, and no cookies.
 *
 * Defences, in the order a request meets them:
 *  1. in-memory flood guard per pseudonymized address (60 requests a minute, every route) - before any database work;
 *  2. demo switched off -> 503 DEMO_UNAVAILABLE (the status route answers `available: false` instead);
 *  3. POSTs must be application/json (415 otherwise), the same login-CSRF rule as the credential endpoints: an HTML form
 *     on another site can neither send JSON nor pass the CORS preflight, so it cannot burn a visitor's challenges;
 *  4. the controller: strict Joi shape, then the service (budget, proof of work, slot, model).
 * Errors are answered here, with fixed messages: nothing the visitor sent or the model said is echoed or logged.
 */

export const DEMO_API_FLOOD_MAX = 60;
const FLOOD_WINDOW_MS = 60 * 1000;
const flood = createFloodLimiter({ windowMs: FLOOD_WINDOW_MS, max: DEMO_API_FLOOD_MAX, maxKeys: 10_000, now: () => demoClock.now().getTime() });

/** Claims per account and window. Every attempt counts, found or not: a stolen token cannot guess ids for free. */
export const CLAIMS_PER_WINDOW = 10;
const CLAIM_WINDOW_MS = 15 * 60 * 1000;
const claimLimiter = createFloodLimiter({ windowMs: CLAIM_WINDOW_MS, max: CLAIMS_PER_WINDOW, maxKeys: 10_000, now: () => demoClock.now().getTime() });

/** Forgets every in-memory counter of the demo API (tests). */
export const resetDemoApiLimits = (): void => {
  flood.clear();
  claimLimiter.clear();
  resetChallengeLimiter();
  resetDemoAvailabilityCache();
};

const errorBody = (code: ErrorCode, message: string) => ({ success: false, error: { code, message }, timestamp: new Date().toISOString() });

const guarded =
  (handler: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    // Express 4 does not catch rejected promises
    handler(req, res).catch(next);
  };

export const demoRouter = Router();

const guardedMiddleware = (mw: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    mw(req as AuthenticatedRequest, res, next).catch(next);
  };

// Before the flood guard on purpose: every page of the site asks this, and behind a shared NAT those asks must not use
// up the per-address allowance of people who really use the demo. It reads one global counter and keeps no address.
demoRouter.get('/availability', guarded(availabilityHandler));

// Signed-in users only (their own limiter, keyed by account, not by address), so it sits before the anonymous flood guard
// too. Order: session -> verified email -> per-account limiter -> plan project limit (402, the demo is untouched) -> claim.
// It does not depend on DEMO_ENABLED: copying a mock that already exists costs no AI and no demo budget.
const perAccountClaimLimit: RequestHandler = (req, _res, next) => {
  const userId = (req as AuthenticatedRequest).user?.id ?? 'unknown';
  const verdict = claimLimiter.hit(userId);
  if (verdict.ok) return next();
  next(new DemoRefusal('Too many attempts. Try again in a few minutes.', ErrorCode.RATE_LIMIT_ERROR, 429, verdict.retryAfterSeconds));
};

demoRouter.post(
  '/:demoId/claim',
  authenticateToken,
  guardedMiddleware(requireVerifiedEmail),
  perAccountClaimLimit,
  enforceProjectLimit,
  guarded(claimHandler),
);

demoRouter.use((req: Request, res: Response, next: NextFunction) => {
  // Off: nothing below needs the visitor's pseudonym (which in production cannot exist without DEMO_HMAC_SECRET)
  if (!isDemoEnabled()) return next();
  const verdict = flood.hit(pseudonymizeIp(req.ip || 'unknown', demoClock.now()));
  if (verdict.ok) return next();
  res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
  res.status(429).json(errorBody(ErrorCode.DEMO_RATE_LIMIT, 'Too many requests. Try again in a moment.'));
});

demoRouter.get('/status', guarded(statusHandler));

const requireDemoEnabled: RequestHandler = (_req, _res, next) => {
  if (!isDemoEnabled()) {
    next(new DemoRefusal('The public demo is not available right now.', ErrorCode.DEMO_UNAVAILABLE, 503));
    return;
  }
  next();
};

const jsonBody = express.json({ limit: '48kb', strict: true });

demoRouter.post('/challenge', requireDemoEnabled, requireJsonBody, jsonBody, guarded(challengeHandler));
demoRouter.post('/generate', requireDemoEnabled, requireJsonBody, jsonBody, guarded(generateHandler));

/** Every error of the router ends here, in the app's error format but with fixed texts and no logging of content. */
demoRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  let status = 500;
  let code = ErrorCode.INTERNAL_SERVER_ERROR;
  let message = 'The demo could not process your request. Please try again.';

  const e = err as { type?: unknown; status?: unknown; statusCode?: unknown };
  if (err instanceof DemoRefusal && err.retryAfterSeconds) res.setHeader('Retry-After', String(err.retryAfterSeconds));
  if (err instanceof AppError) {
    ({ statusCode: status, code, message } = err);
  } else if (e?.type === 'entity.too.large') {
    status = 413;
    code = ErrorCode.VALIDATION_ERROR;
    message = 'The request body is too large.';
  } else if (typeof e?.type === 'string' && /^(entity\.|encoding\.|charset\.|request\.)/.test(e.type)) {
    // Malformed JSON, unsupported charset/encoding, aborted upload: the parser's message may quote the body, so it is not used
    status = 400;
    code = ErrorCode.VALIDATION_ERROR;
    message = 'The request body is not valid JSON.';
  } else {
    console.error(`[Demo] unexpected error (${describeError(err)})`);
  }
  res.status(status).json(errorBody(code, message));
});
