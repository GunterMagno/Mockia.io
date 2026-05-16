import { Router } from 'express';
import { getProfile, updateProfile, changePassword } from '../controllers/user.controller.js';
import { authenticateToken } from '../middlewares/authenticateToken.js';
import { validate } from '../middlewares/validateRequest.js';
import { updateProfileSchema, changePasswordSchema } from '../validation/user.validation.js';

/**
 * User router
 * All routes in this router require authentication
 */
export const userRouter = Router();

/**
 * GET /api/users/profile
 * Fetch authenticated user's profile
 *
 * Responses:
 * - 200: Profile data
 * - 401: Unauthorized
 */
userRouter.get('/profile', authenticateToken, getProfile);

/**
 * PUT /api/users/profile
 * Update authenticated user's profile
 *
 * Request body:
 * - username (optional): 2-80 characters
 *
 * Responses:
 * - 200: Updated profile data
 * - 400: Invalid input data
 * - 401: Unauthorized
 */
userRouter.put(
  '/profile',
  authenticateToken,
  validate({ body: updateProfileSchema }),
  updateProfile
);

/**
 * POST /api/users/change-password
 * Change user's password
 *
 * Request body:
 * - currentPassword (required): Current password
 * - newPassword (required): New password, minimum 8 characters
 *
 * Responses:
 * - 204: Password changed successfully
 * - 400: Invalid input data or current password is wrong
 * - 401: Unauthorized
 */
userRouter.post(
  '/change-password',
  authenticateToken,
  validate({ body: changePasswordSchema }),
  changePassword
);
