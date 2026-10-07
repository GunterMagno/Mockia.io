import { Request, Response, NextFunction } from 'express';
import { getUserProfile, updateUserProfile, changeUserPassword, updateUserLocale } from './service.js';
import { AuthRequest } from '../../types/auth.js';
import { asyncHandler } from '../../middlewares/errorHandler.js';

/**
 * GET /api/users/profile
 * Read-only endpoint to fetch authenticated user's profile
 */
export const getProfile = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const profile = await getUserProfile(userId);
  res.json(profile);
});

/**
 * PUT /api/users/profile
 * Update authenticated user's profile (username only)
 */
export const updateProfile = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { username } = req.body;
  const updatedProfile = await updateUserProfile(userId, { username });
  res.json(updatedProfile);
});

/**
 * POST /api/users/change-password
 * Change password after verifying the current one
 */
export const changePassword = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { currentPassword, newPassword } = req.body;
  await changeUserPassword(userId, currentPassword, newPassword);
  res.status(204).send();
});

/**
 * PATCH /api/users/me/preferences
 * Save the interface language of the authenticated user
 */
export const updatePreferences = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const saved = await updateUserLocale(userId, req.body.locale);
  res.json(saved);
});
