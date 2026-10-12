import { Router, type Request } from 'express';
import { ErrorCode } from '@mockia/shared';
import { AppError, asyncHandler } from '../../middlewares/errorHandler.js';
import { rateLimit } from '../../middlewares/rateLimit.js';
import { getOpsToken, opsTokenMatches } from '../../config/ops.js';
import { buildOpsSummary } from './summary.js';

/**
 * Operations API (mounted at /api/ops), read by the owner's monitoring workflows with `Authorization: Bearer <OPS_TOKEN>`.
 * - Without a valid OPS_TOKEN in the environment (unset, empty, under 32 characters) the whole prefix does not exist:
 *   the router steps aside and the request ends in the ordinary 404, indistinguishable from any unknown route.
 * - Its own light limiter (60 per minute per IP, wrong tokens included) sits before the token check, so guessing the
 *   token is throttled; it is mounted in index.ts before the general /api limiters, which therefore never see it.
 * - A missing or wrong token is the same 401 with the same body: no hint about which part failed.
 */

const BEARER = /^Bearer ([^\s]+)$/;

function presentedToken(req: Request): string {
  return BEARER.exec(req.headers.authorization ?? '')?.[1] ?? '';
}

export function createOpsRouter(options: { max?: number; windowMs?: number } = {}): Router {
  const router = Router();
  const limiter = rateLimit({ windowMs: options.windowMs ?? 60_000, max: options.max ?? 60 });

  router.use((req, res, next) => {
    if (!getOpsToken()) return next('router');
    res.setHeader('Cache-Control', 'no-store');
    limiter(req, res, next);
  });

  router.use((req, _res, next) => {
    const expected = getOpsToken();
    const presented = presentedToken(req);
    // Compared even when nothing was presented, so a missing header costs the same as a wrong one
    const ok = opsTokenMatches(presented, expected ?? '') && presented !== '';
    if (!ok) return next(new AppError('Unauthorized', ErrorCode.UNAUTHORIZED, 401));
    next();
  });

  router.get(
    '/summary',
    asyncHandler(async (req, res) => {
      res.json(await buildOpsSummary(req.ip));
    })
  );

  return router;
}

export const opsRouter = createOpsRouter();
