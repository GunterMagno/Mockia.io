import { Router } from 'express';
import { getProfile, updateProfile, changePassword, updatePreferences, exportMyData, deleteMyAccount } from './controller.js';
import { authenticateToken, type AuthenticatedRequest } from '../../middlewares/authenticateToken.js';
import { rateLimit } from '../../middlewares/rateLimit.js';
import { validate } from '../../middlewares/validateRequest.js';
import { updateProfileSchema, changePasswordSchema, updatePreferencesSchema, deleteAccountSchema } from './validation.js';

/**
 * User router
 * All routes in this router require authentication
 */
export const userRouter = Router();

const perUser = (req: unknown) => (req as AuthenticatedRequest).user?.id ?? (req as { ip?: string }).ip ?? 'unknown';

/** The export reads the whole account (heavy) and is the first thing a stolen session would grab: 5 per 15 min. */
const exportLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyFn: perUser });
/** Deleting re-checks the password: 5 attempts per 15 min per user, so a stolen access token cannot brute-force it. */
const deleteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyFn: perUser });

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: User profile and account settings
 */

/**
 * @swagger
 * /users/profile:
 *   get:
 *     summary: Get user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile data
 *       401:
 *         description: Unauthorized
 */
userRouter.get('/profile', authenticateToken, getProfile);

/**
 * @swagger
 * /users/profile:
 *   put:
 *     summary: Update user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated
 */
userRouter.put(
  '/profile',
  authenticateToken,
  validate({ body: updateProfileSchema }),
  updateProfile
);

/**
 * @swagger
 * /users/change-password:
 *   post:
 *     summary: Change password
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       204:
 *         description: Password changed
 */
userRouter.post(
  '/change-password',
  authenticateToken,
  validate({ body: changePasswordSchema }),
  changePassword
);

/**
 * @swagger
 * /users/me/preferences:
 *   patch:
 *     summary: Save the interface language of the user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - locale
 *             properties:
 *               locale:
 *                 type: string
 *                 enum: [en, es, zh]
 *     responses:
 *       200:
 *         description: Language saved
 *       400:
 *         description: Unsupported language
 *       401:
 *         description: Unauthorized
 */
userRouter.patch(
  '/me/preferences',
  authenticateToken,
  validate({ body: updatePreferencesSchema }),
  updatePreferences
);

/**
 * @swagger
 * /users/me/export:
 *   get:
 *     summary: Download all personal data of the user (GDPR access and portability)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: JSON attachment (mockia-export-YYYY-MM-DD.json) without password hash or other users' data
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Too many exports (5 per 15 minutes)
 */
userRouter.get('/me/export', authenticateToken, exportLimiter, exportMyData);

/**
 * @swagger
 * /users/me:
 *   delete:
 *     summary: Permanently delete the account and all its data (GDPR erasure)
 *     description: >
 *       Cancels any active Stripe subscription immediately (before deleting anything), then deletes projects,
 *       notifications, usage, sessions and the user. Stripe keeps the customer record for fiscal obligations.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - password
 *             properties:
 *               password:
 *                 type: string
 *     responses:
 *       204:
 *         description: Account deleted (the refresh cookie is cleared)
 *       400:
 *         description: Password missing
 *       401:
 *         description: Wrong password, or the account no longer exists
 *       409:
 *         description: Active subscription but Stripe is not configured; nothing was deleted
 *       502:
 *         description: Stripe could not cancel the subscription; nothing was deleted
 */
userRouter.delete('/me', authenticateToken, deleteLimiter, validate({ body: deleteAccountSchema }), deleteMyAccount);
