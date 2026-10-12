import { Response, NextFunction } from 'express';
import { ErrorCode } from '@mockia/shared';
import { Types } from 'mongoose';
import { UserModel } from '../models/User.js';
import { isAdminEmail } from '../config/admin.js';
import { AppError } from './errorHandler.js';
import type { AuthenticatedRequest } from './authenticateToken.js';

/**
 * Whether the authenticated user is an administrator: their address is in ADMIN_EMAILS AND verified.
 * Verification is required whatever REQUIRE_EMAIL_VERIFICATION says (that flag is relaxed in dev and CI; this one is
 * about who may see the owner's data). Returns `null` when the account no longer exists.
 */
export async function isAdminUser(userId: string | undefined): Promise<boolean | null> {
  if (!userId || !Types.ObjectId.isValid(userId)) return null;
  const user = await UserModel.findById(userId).select('email emailVerifiedAt').lean();
  if (!user) return null;
  return Boolean(user.emailVerifiedAt) && isAdminEmail(user.email);
}

/**
 * Express middleware, to be used AFTER authenticateToken: 401 when the account is gone, 403 FORBIDDEN otherwise
 * unless the user is an administrator. The refusal is the same whether the address is not listed or not verified, and
 * says nothing about the list. Evaluated per request, so the environment and the verification are read at call time.
 */
export async function requireAdmin(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user?.id)
      throw new AppError('Missing authorization header', ErrorCode.UNAUTHORIZED, 401);
    const admin = await isAdminUser(req.user.id);
    if (admin === null) throw new AppError('User not found', ErrorCode.UNAUTHORIZED, 401);
    if (!admin) throw new AppError('Forbidden', ErrorCode.FORBIDDEN, 403);
    next();
  } catch (err) {
    next(err);
  }
}
