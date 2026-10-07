import { Response, NextFunction } from 'express';
import { ErrorCode } from '@mockia/shared';
import { UserModel } from '../models/User.js';
import { AppError } from './errorHandler.js';
import type { AuthenticatedRequest } from './authenticateToken.js';

/**
 * Whether features that cost money (AI generation, Stripe checkout / portal) require a verified email.
 * REQUIRE_EMAIL_VERIFICATION=true|false decides; unset (or anything else) means "on only in production", so local
 * development, CI and the e2e suite keep working without an inbox.
 */
export function isEmailVerificationRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.REQUIRE_EMAIL_VERIFICATION?.trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return env.NODE_ENV === 'production';
}

/**
 * Express middleware, to be used AFTER authenticateToken. When verification is required and the user has not
 * verified their address it answers 403 with the EMAIL_NOT_VERIFIED code (the SPA shows its "verify your email"
 * notice for it). Evaluated per request, so the environment is read at call time.
 */
export async function requireVerifiedEmail(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!isEmailVerificationRequired()) return next();

    const userId = req.user?.id;
    if (!userId) throw new AppError('Missing authorization header', ErrorCode.UNAUTHORIZED, 401);

    const user = await UserModel.findById(userId).select('emailVerifiedAt').lean();
    if (!user) throw new AppError('User not found', ErrorCode.UNAUTHORIZED, 401);
    if (!user.emailVerifiedAt) {
      throw new AppError(
        'Email not verified. Verify your email address to use this feature.',
        ErrorCode.EMAIL_NOT_VERIFIED,
        403
      );
    }
    next();
  } catch (err) {
    next(err);
  }
}
