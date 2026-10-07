import { Router } from 'express';
import { register, login, refresh, logout, logoutAll, sessions, me } from './controller.js';
import { registerSchema, loginSchema, refreshSchema, logoutSchema } from './validation.js';
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
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 */
authRouter.post(
  '/login',
  validate({ body: loginSchema }),
  login
);

/**
 * POST /api/auth/refresh
 * Refreshes the access token using a valid refresh token
 *
 * Validations:
 * - refreshToken: required, must be a valid JWT
 *
 * Responses:
 * - 200: Token refresh successful, returns new tokens
 * - 400: Invalid input data
 * - 401: Invalid or expired refresh token
 */
authRouter.post(
  '/refresh',
  validate({ body: refreshSchema }),
  refresh
);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: End a session (revokes the refresh token family). Always 204.
 *     tags: [Auth]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       204:
 *         description: Session ended (also when the token was already invalid)
 */
authRouter.post(
  '/logout',
  validate({ body: logoutSchema }),
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
