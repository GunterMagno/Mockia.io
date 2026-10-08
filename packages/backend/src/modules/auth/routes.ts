import { Router } from 'express';
import { register, login, refresh, logout, logoutAll, sessions, me, forgot, reset, verify, resendVerificationEmail } from './controller.js';
import { registerSchema, loginSchema, forgotSchema, resetSchema, verifySchema, resendSchema } from './validation.js';
import { requireCsrfHeader, requireJsonBody } from './cookie.js';
import { validate } from '../../middlewares/validateRequest.js';
import { authenticateToken, type AuthenticatedRequest } from '../../middlewares/authenticateToken.js';
import { rateLimit } from '../../middlewares/rateLimit.js';

/**
 * Authentication router
 * Defines auth routes and middleware stack
 *
 * Middleware stack for each route:
 * 1. validate({ body: registerSchema }) - Validates that body is a valid CreateUserRequest
 * 2. register - Controller that registers the user
 */

export const authRouter = Router();

/** Resend of the verification email: 5 per user per 15 minutes (each one is an outgoing email). */
const resendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyFn: (req) => (req as AuthenticatedRequest).user?.id ?? req.ip ?? 'unknown',
});

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
  requireJsonBody,
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
 *       415:
 *         description: Body is not application/json (login-CSRF defence; HTML forms cannot send JSON)
 */
authRouter.post(
  '/login',
  requireJsonBody,
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
 * @swagger
 * /auth/forgot:
 *   post:
 *     summary: Start a password reset. Always 202, whether or not the email has an account.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *               locale:
 *                 type: string
 *                 enum: [en, es, zh]
 *                 description: Language of the email (default en)
 *     responses:
 *       202:
 *         description: Accepted. If the account exists a single-use link (valid 30 minutes) is emailed.
 *       400:
 *         description: Invalid email format
 *       429:
 *         description: Too many requests (strict limiter shared with login and register)
 */
authRouter.post('/forgot', requireJsonBody, validate({ body: forgotSchema }), forgot);

/**
 * @swagger
 * /auth/reset:
 *   post:
 *     summary: Set a new password with the token from the reset email. Ends every session of the user.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 10
 *                 maxLength: 128
 *     responses:
 *       200:
 *         description: Password updated
 *       400:
 *         description: Weak password, or invalid / expired / already used token
 */
authRouter.post('/reset', requireJsonBody, validate({ body: resetSchema }), reset);

/**
 * @swagger
 * /auth/verify:
 *   post:
 *     summary: Confirm the email address with the token from the verification email
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email verified
 *       400:
 *         description: Invalid, expired or already used token
 */
authRouter.post('/verify', validate({ body: verifySchema }), verify);

/**
 * @swagger
 * /auth/verify/resend:
 *   post:
 *     summary: Send the authenticated user a new verification email (no-op if already verified)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       202:
 *         description: Accepted (data.alreadyVerified tells whether anything was sent)
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Too many requests (5 per 15 minutes)
 */
authRouter.post('/verify/resend', authenticateToken, resendLimiter, validate({ body: resendSchema }), resendVerificationEmail);

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
