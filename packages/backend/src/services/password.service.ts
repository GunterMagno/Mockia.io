import bcrypt from 'bcrypt';
import { UserModel } from '../models/User.js';

/** Work factor for every new password hash (register, reset, change-password, transparent re-hash at login). */
export const BCRYPT_COST = 12;

/** Password policy for NEW passwords (register, reset, change-password). Login does not enforce it: old accounts must still get in. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/** Work factor stored in a bcrypt hash (`$2b$10$...` -> 10), or undefined when the string is not a bcrypt hash. */
export function bcryptCostOf(hash: string): number | undefined {
  const match = /^\$2[abxy]\$(\d{2})\$/.exec(hash);
  return match ? Number(match[1]) : undefined;
}

/**
 * Upgrades a stored hash made with a lower cost (older accounts were hashed at 10) once the user proves the password.
 * Call it only after a successful bcrypt.compare. It is best effort (a failure must never fail a login) and
 * conditional on the hash that was verified: if the password changed in the meantime the newer hash is kept.
 *
 * @returns true when the hash was upgraded
 */
export async function rehashIfOutdated(userId: string, plain: string, currentHash: string): Promise<boolean> {
  const cost = bcryptCostOf(currentHash);
  if (cost === undefined || cost >= BCRYPT_COST) return false;
  try {
    const upgraded = await hashPassword(plain);
    const res = await UserModel.updateOne({ _id: userId, passwordHash: currentHash }, { $set: { passwordHash: upgraded } });
    return res.modifiedCount === 1;
  } catch (err) {
    console.error('[Auth] Could not upgrade the password hash:', err instanceof Error ? err.message : err);
    return false;
  }
}
