import { Router, Response, NextFunction } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../../middlewares/authenticateToken.js';
import { requireAdmin, isAdminUser } from '../../middlewares/requireAdmin.js';
import { AppError, asyncHandler } from '../../middlewares/errorHandler.js';
import { ErrorCode } from '@mockia/shared';

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
 * /admin/ping:
 *   get:
 *     summary: Guard probe, administrators only
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The caller is an administrator
 *       403:
 *         description: Not an administrator
 */
adminRouter.get('/ping', (_req, res) => {
  res.json({ success: true, data: { ok: true }, timestamp: new Date().toISOString() });
});
