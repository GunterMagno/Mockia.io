import { UserModel } from '../../models/User.js';

/**
 * One-off migration: marks every user without a verification date as verified.
 * Run it BEFORE turning email verification on (REQUIRE_EMAIL_VERIFICATION, on by default in production), so the
 * accounts that existed before the feature are not locked out of AI generation and billing.
 * Idempotent: users that already have a date keep it.
 *
 * @returns how many users were updated
 */
export async function backfillEmailVerified(): Promise<number> {
  const result = await UserModel.updateMany({ emailVerifiedAt: null }, { $set: { emailVerifiedAt: new Date() } });
  return result.modifiedCount;
}
