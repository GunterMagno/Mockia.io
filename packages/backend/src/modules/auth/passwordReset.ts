import { createHash, randomBytes } from 'node:crypto';
import { ErrorCode } from '@mockia/shared';
import { UserModel } from '../../models/User.js';
import { AuthTokenModel, type AuthTokenPurpose } from '../../models/AuthToken.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { sendMail } from '../../services/mailer.js';
import { hashPassword } from '../../services/password.service.js';
import { revokeAllForUser } from './sessions.js';

/** Lifetime of a password-reset link. Short: it is a password-equivalent credential. */
export const RESET_TTL_MIN = 30;
/** Lifetime of an email-verification link. */
export const VERIFY_TTL_MIN = 24 * 60;
/**
 * Minimum time between two reset emails for the same account. Stops /auth/forgot from being used to flood a
 * victim's inbox (the per-IP limiter alone would let a botnet do it); a legitimate user waits a minute.
 */
export const RESET_COOLDOWN_MS = 60_000;

/** Same message for unknown, expired, used and wrong-purpose tokens: the response never says which. */
const INVALID_TOKEN_MESSAGE = 'Invalid or expired token';

/** sha256 of a raw token, hex. The token has 256 bits of entropy, so a fast hash is enough. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Creates a single-use token for `userId` and returns the RAW token (to put in the email link).
 * Only its sha256 is stored. A new reset token invalidates the older unused reset tokens of the user, so only the
 * latest link works; verification links are left alone (a delayed first email must still work after a resend).
 */
export async function createAuthToken(userId: string, purpose: AuthTokenPurpose, ttlMin: number): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  if (purpose === 'reset') {
    await AuthTokenModel.deleteMany({ userId, purpose, usedAt: null });
  }
  await AuthTokenModel.create({
    tokenHash: hashToken(raw),
    userId,
    purpose,
    expiresAt: new Date(Date.now() + ttlMin * 60_000),
  });
  return raw;
}

/**
 * Consumes a token: it works once. The claim is one atomic findOneAndUpdate on `usedAt: null`, so two concurrent
 * requests with the same token cannot both succeed.
 *
 * @returns the id of the user the token was issued to
 * @throws AppError 400 (generic) when the token is unknown, expired, already used or issued for another purpose
 */
export async function consumeAuthToken(raw: string, purpose: AuthTokenPurpose): Promise<string> {
  const claimed =
    typeof raw === 'string' && raw.length > 0
      ? await AuthTokenModel.findOneAndUpdate(
          { tokenHash: hashToken(raw), purpose, usedAt: null, expiresAt: { $gt: new Date() } },
          { $set: { usedAt: new Date() } }
        )
      : null;
  if (!claimed) {
    throw new AppError(INVALID_TOKEN_MESSAGE, ErrorCode.VALIDATION_ERROR, 400);
  }
  return claimed.userId.toString();
}

/** Public URL of the SPA (links in emails). APP_URL is mandatory in production; the fallbacks are for local development. */
export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.APP_URL?.trim() || env.FRONTEND_URL?.trim() || env.CORS_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:5173';
  return url.replace(/\/+$/, '');
}

const linkFor = (path: '/reset-password' | '/verify-email', token: string): string =>
  `${appBaseUrl()}${path}?token=${encodeURIComponent(token)}`;

/** Logs a mail failure without the address or the link (both would end up in the log aggregator). */
function logMailFailure(kind: string, err: unknown): void {
  console.error(`[Auth] Could not send the ${kind} email:`, err instanceof Error ? err.message : err);
}

/**
 * Email a verification link to a user. Never throws: registration and resend must not fail because of mail.
 * The token is created before returning (so the caller's response can rely on it); the SMTP delivery itself is not awaited.
 */
export async function sendVerificationEmail(user: { id: string; email: string; username: string }, locale?: string): Promise<void> {
  try {
    const token = await createAuthToken(user.id, 'verify', VERIFY_TTL_MIN);
    sendMail(user.email, 'verify', {
      link: linkFor('/verify-email', token),
      username: user.username,
      locale: locale ?? 'en',
    }).catch((err) => logMailFailure('verification', err));
  } catch (err) {
    logMailFailure('verification', err);
  }
}

/**
 * POST /auth/forgot. Looks the account up and, if there is one (and no reset mail went out in the last minute),
 * creates a token and queues the email. Resolves the same way whether or not the account exists, and never throws on
 * mail problems: the controller answers 202 either way. The only work an unknown address skips is one token write
 * and the (not awaited) mail delivery.
 */
export async function requestPasswordReset(email: string, locale?: string): Promise<void> {
  const user = await UserModel.findOne({ email: email.trim().toLowerCase() });
  if (!user) return;

  const recent = await AuthTokenModel.exists({
    userId: user._id,
    purpose: 'reset',
    createdAt: { $gt: new Date(Date.now() - RESET_COOLDOWN_MS) },
  });
  if (recent) return;

  try {
    const token = await createAuthToken(user._id.toString(), 'reset', RESET_TTL_MIN);
    sendMail(user.email, 'reset', {
      link: linkFor('/reset-password', token),
      username: user.username,
      locale: locale ?? 'en',
    }).catch((err) => logMailFailure('password reset', err));
  } catch (err) {
    logMailFailure('password reset', err);
  }
}

/** Sets emailVerifiedAt once: an already verified user keeps the original date. */
async function markEmailVerified(userId: string): Promise<void> {
  await UserModel.updateOne({ _id: userId, emailVerifiedAt: null }, { $set: { emailVerifiedAt: new Date() } });
}

/**
 * POST /auth/reset. Consumes the token, stores the new password (cost 12), ends every session of the user and marks
 * the email as verified (clicking the link proves control of the inbox).
 *
 * @throws AppError 400 (generic) for an invalid, expired or used token
 */
export async function resetPassword(token: string, password: string): Promise<void> {
  const userId = await consumeAuthToken(token, 'reset');
  const passwordHash = await hashPassword(password);
  const updated = await UserModel.findOneAndUpdate({ _id: userId }, { $set: { passwordHash } });
  if (!updated) {
    // The account was deleted after the link was issued: same answer as a dead link
    throw new AppError(INVALID_TOKEN_MESSAGE, ErrorCode.VALIDATION_ERROR, 400);
  }
  await markEmailVerified(userId);
  await revokeAllForUser(userId);
}

/**
 * POST /auth/verify. Consumes the token and marks the email as verified (the first date wins).
 *
 * @throws AppError 400 (generic) for an invalid, expired or used token
 */
export async function verifyEmail(token: string): Promise<void> {
  const userId = await consumeAuthToken(token, 'verify');
  const user = await UserModel.exists({ _id: userId });
  if (!user) throw new AppError(INVALID_TOKEN_MESSAGE, ErrorCode.VALIDATION_ERROR, 400);
  await markEmailVerified(userId);
}

/**
 * POST /auth/verify/resend. Sends a fresh verification email unless the user is already verified.
 *
 * @returns true when an email was queued, false when the address was already verified
 */
export async function resendVerification(userId: string, locale?: string): Promise<boolean> {
  const user = await UserModel.findById(userId);
  if (!user) throw new AppError('User not found', ErrorCode.NOT_FOUND, 404);
  if (user.emailVerifiedAt) return false;
  await sendVerificationEmail({ id: userId, email: user.email, username: user.username }, locale);
  return true;
}
