import { Router } from 'express';
import { getProfile, updateProfile, changePassword } from './controller.js';
import { authenticateToken } from '../../middlewares/authenticateToken.js';
import { validate } from '../../middlewares/validateRequest.js';
import { updateProfileSchema, changePasswordSchema } from './validation.js';

/**
 * User router
 * All routes in this router require authentication
 */
export const userRouter = Router();

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
