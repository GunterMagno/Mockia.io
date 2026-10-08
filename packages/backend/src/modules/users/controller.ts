import { Request, Response, NextFunction } from 'express';
import { getUserProfile, updateUserProfile, changeUserPassword, updateUserLocale } from './service.js';
import { exportUserData, deleteUserAccount } from './gdpr.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../auth/cookie.js';
import { issueFreshSession, isPersistentSession } from '../auth/service.js';
import { setAiTrainingConsent } from '../ai/consent.js';
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
 * Change password after verifying the current one. Every older session (other devices, and the caller's own family)
 * is revoked; the caller gets a fresh session right away so it is not silently logged out when its access token
 * expires: a new refresh cookie and, in the body, the same shape as /auth/refresh ({ accessToken, user }).
 * "Remember me" is kept when the caller's refresh cookie reaches this route (it is scoped to /api/auth, so browsers
 * normally do not send it here: the new cookie then lasts for the browser session).
 */
export const changePassword = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { currentPassword, newPassword } = req.body;
  const persistent = await isPersistentSession(readRefreshCookie(req), userId);
  await changeUserPassword(userId, currentPassword, newPassword);
  const issued = await issueFreshSession(userId, { ip: req.ip, ua: req.get('user-agent') }, persistent);
  setRefreshCookie(res, issued.refreshToken, issued.persistent);
  res.status(200).json({
    success: true,
    data: { accessToken: issued.accessToken, user: issued.user },
    timestamp: new Date().toISOString(),
  });
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

/**
 * GET /api/users/me/export
 * Downloads every personal datum of the authenticated user as a JSON attachment (GDPR access / portability).
 */
export const exportMyData = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const data = await exportUserData(userId);
  const day = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="mockia-export-${day}.json"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(JSON.stringify(data, null, 2));
});

/**
 * DELETE /api/users/me   body: { password }
 * Permanently deletes the account and all its data (GDPR erasure). 204 and the refresh cookie is cleared.
 */
export const deleteMyAccount = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  await deleteUserAccount(userId, req.body.password);
  clearRefreshCookie(res);
  res.status(204).send();
});

/**
 * PUT /api/users/me/ai-consent   body: { granted: boolean }
 * Opt in (200 with the consent state) or out (204: every stored generation and feedback row of the user is erased).
 */
export const updateAiConsent = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const state = await setAiTrainingConsent(userId, req.body.granted);
  if (!state.granted) {
    res.status(204).send();
    return;
  }
  res.json({ aiTrainingConsent: { granted: true, at: state.at.toISOString() } });
});
