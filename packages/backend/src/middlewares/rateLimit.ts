import { Request, Response, NextFunction } from 'express';
import { ErrorCode } from '@mockia/shared';
import { AppError } from './errorHandler.js';

interface RateLimitOptions {
  /** Window length in ms */
  windowMs: number;
  /** Max requests per key inside the window */
  max: number;
  /** Bucket key. Default: client IP */
  keyFn?: (req: Request) => string;
  /** Injectable clock, for tests */
  now?: () => number;
}

/**
 * In-memory sliding-window rate limiter (no dependencies).
 * Keeps one timestamp list per key and drops entries older than the window.
 *
 * ponytail: state lives in one process. Behind several instances swap for a shared store (Redis).
 */
export function rateLimit(opts: RateLimitOptions) {
  const hits = new Map<string, number[]>();
  const now = opts.now ?? Date.now;
  const keyFn = opts.keyFn ?? ((req: Request) => req.ip || req.socket?.remoteAddress || 'unknown');

  // Purge idle keys so the map cannot grow without bound.
  const sweep = setInterval(() => {
    const cutoff = now() - opts.windowMs;
    for (const [key, stamps] of hits) {
      if (stamps[stamps.length - 1] <= cutoff) hits.delete(key);
    }
  }, Math.max(opts.windowMs, 1000));
  sweep.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const t = now();
    const cutoff = t - opts.windowMs;
    const key = keyFn(req);
    const stamps = (hits.get(key) ?? []).filter((s) => s > cutoff);

    if (stamps.length >= opts.max) {
      hits.set(key, stamps);
      const retryAfter = Math.max(1, Math.ceil((stamps[0] + opts.windowMs - t) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return next(new AppError('Too many requests. Try again later.', ErrorCode.RATE_LIMIT_ERROR, 429));
    }

    stamps.push(t);
    hits.set(key, stamps);
    next();
  };
}

/**
 * True for the endpoints under /api/auth that get the strict brute-force bucket: the credential endpoints (login,
 * register) and the password-reset pair (forgot sends an email, reset takes a secret token).
 * `path` is relative to the /api/auth mount. Express routes case-insensitively and tolerates a trailing slash,
 * so /LOGIN and /login/ reach the same handler and must hit the same bucket: the match ignores case and any
 * run of leading or trailing slashes.
 */
export function isStrictAuthPath(path: string): boolean {
  return /^\/*(login|register|forgot|reset)\/*$/i.test(path);
}

/**
 * True for requests under /api that the global limiter (1000 / 15 min per IP) must not count. `path` is relative to the
 * /api mount.
 * - Public mock traffic (own monthly quota), the Stripe webhook (/billing) and health probes.
 * - GET /notifications: every open tab polls it; counting the polls would let a few tabs exhaust the bucket that
 *   real API calls share (and behind one NAT, other users'). It is a cheap authenticated read.
 */
export function skipsGlobalLimiter(method: string, path: string): boolean {
  if (/^\/(mock|billing|health)(\/|$)/.test(path)) return true;
  const isRead = method === 'GET' || method === 'HEAD';
  return isRead && /^\/notifications\/?$/i.test(path);
}
