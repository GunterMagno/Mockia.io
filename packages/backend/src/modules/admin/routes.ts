import { Router, Response, NextFunction } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../../middlewares/authenticateToken.js';
import { requireAdmin, isAdminUser } from '../../middlewares/requireAdmin.js';
import { AppError, asyncHandler } from '../../middlewares/errorHandler.js';
import { ADMIN_METRICS_DEFAULT_DAYS, ErrorCode } from '@mockia/shared';
import { getAdminMetrics, isMetricsWindow } from './metrics.js';

/** `?days=` as one of the accepted windows, or null (a repeated parameter, a decimal, "007" or text are all refused). */
function parseDays(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d{0,2}$/.test(raw)) return null;
  const days = Number(raw);
  return isMetricsWindow(days) ? days : null;
}

/**
 * Owner-only API (mounted at /api/admin). Who is an administrator: config/admin.ts (ADMIN_EMAILS, verified address).
 * Everything except /me sits behind requireAdmin, including paths that do not exist yet, so a non-administrator cannot
 * map what is there: it is always 403, never 404.
 */
export const adminRouter = Router();

// Nothing here is cacheable: the answers depend on who asks and on the current list.
adminRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

adminRouter.use(authenticateToken);

/**
 * @swagger
 * /admin/me:
 *   get:
 *     summary: Whether the authenticated user is an administrator
 *     description: Answers { isAdmin } to any authenticated user. It never reveals who the administrators are.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ isAdmin: boolean }"
 *       401:
 *         description: Unauthorized
 */
adminRouter.get(
  '/me',
  asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const admin = await isAdminUser(req.user?.id);
    if (admin === null) throw new AppError('User not found', ErrorCode.UNAUTHORIZED, 401);
    res.json({ success: true, data: { isAdmin: admin }, timestamp: new Date().toISOString() });
  })
);

adminRouter.use(requireAdmin);

/**
 * @swagger
 * /admin/metrics:
 *   get:
 *     summary: Owner metrics (users, funnel, estimated MRR, AI usage and cost, demo), aggregates only
 *     description: >
 *       Cached for 60 seconds per window. Contains no email, user id or IP. Money figures are estimates from the plan
 *       catalogue and from AI_PRICES_JSON, not accounting.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           enum: [7, 30, 90]
 *           default: 30
 *     responses:
 *       200:
 *         description: AdminMetrics
 *       400:
 *         description: days is not 7, 30 or 90
 *       403:
 *         description: Not an administrator
 */
adminRouter.get(
  '/metrics',
  asyncHandler(async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const raw = req.query.days;
    const days = raw === undefined ? ADMIN_METRICS_DEFAULT_DAYS : parseDays(raw);
    if (days === null) {
      throw new AppError('days must be 7, 30 or 90', ErrorCode.VALIDATION_ERROR, 400);
    }
    const data = await getAdminMetrics(days);
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  })
);
