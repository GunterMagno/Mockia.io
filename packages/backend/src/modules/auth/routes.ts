import { Router } from 'express';
import { register, login, refresh, logout, logoutAll, sessions, me } from './controller.js';
import { registerSchema, loginSchema } from './validation.js';
import { requireCsrfHeader } from './cookie.js';
import { validate } from '../../middlewares/validateRequest.js';
import { authenticateToken } from '../../middlewares/authenticateToken.js';

/**
 * Authentication router
 * Defines auth routes and middleware stack
 *
 * Middleware stack for each route:
 * 1. validate({ body: registerSchema }) - Validates that body is a valid CreateUserRequest
 * 2. register - Controller that registers the user
 */

export const authRouter = Router();

/**
 * POST /api/auth/register
 * Registers a new user
 *
 * Validations:
 * - email: required, valid email format
 * @swagger
 * /auth/register:
 *   post:
 *     summary: User registration
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created
 */
authRouter.post(
  '/register',
  validate({ body: registerSchema }),
  register
);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: User login
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               remember:
 *                 type: boolean
 *                 description: Keep the session cookie for 7 days instead of ending it with the browser session
 *     responses:
 *       200:
 *         description: Login successful. The body carries the access token; the refresh token is set in the HttpOnly mockia_rt cookie.
 *       401:
 *         description: Invalid credentials
 */
authRouter.post(
  '/login',
  validate({ body: loginSchema }),
  login
);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Renew the session from the HttpOnly mockia_rt cookie (rotates it)
 *     tags: [Auth]
 *     parameters:
 *       - in: header
 *         name: X-Requested-With
 *         required: true
 *         schema:
 *           type: string
 *           enum: [mockia]
 *         description: CSRF defence. Any other value (or none) is rejected with 403.
 *     responses:
 *       200:
 *         description: New access token and the user; a new refresh token is set in the cookie
 *       401:
 *         description: Cookie missing, invalid, expired, revoked or reused (the cookie is cleared)
 *       403:
 *         description: Missing X-Requested-With header
 */
authRouter.post(
  '/refresh',
  requireCsrfHeader,
  refresh
);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: End a session (revokes the family of the mockia_rt cookie and clears it). Always 204.
 *     tags: [Auth]
 *     parameters:
 *       - in: header
 *         name: X-Requested-With
 *         required: true
 *         schema:
 *           type: string
 *           enum: [mockia]
 *         description: CSRF defence. Any other value (or none) is rejected with 403.
 *     responses:
 *       204:
 *         description: Session ended (also when the cookie was missing or already invalid)
 *       403:
 *         description: Missing X-Requested-With header
 */
authRouter.post(
  '/logout',
  requireCsrfHeader,
  logout
);

/**
 * @swagger
 * /auth/logout-all:
 *   post:
 *     summary: End every session of the authenticated user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       204:
 *         description: All sessions revoked
 *       401:
 *         description: Unauthorized
 */
authRouter.post(
  '/logout-all',
  authenticateToken,
  logoutAll
);

/**
 * @swagger
 * /auth/sessions:
 *   get:
 *     summary: List the authenticated user's live sessions
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: One entry per login with id, createdAt, ip, ua and current
 *       401:
 *         description: Unauthorized
 */
authRouter.get(
  '/sessions',
  authenticateToken,
  sessions
);

/**
 * GET /api/auth/me
 * Gets current user info
 */
authRouter.get(
  '/me',
  authenticateToken,
  me
);

export default authRouter;
