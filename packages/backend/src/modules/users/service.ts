import bcrypt from 'bcrypt';
import { hashPassword } from '../../services/password.service.js';
import { toUserDTO } from './dto.js';
import { UserModel } from '../../models/User.js';
import type { User as UserDTO, Locale } from '@mockia/shared';
import { AppError } from '../../middlewares/errorHandler.js';
import { ErrorCode } from '@mockia/shared';
import { revokeAllForUser } from '../auth/sessions.js';

/**
 * Get user profile by ID
 * Returns public user data without sensitive information
 * 
 * @throws {AppError} If user is not found
 */
export async function getUserProfile(userId: string): Promise<UserDTO> {
  const user = await UserModel.findById(userId).exec();
  
  if (!user) {
    throw new AppError('User not found', ErrorCode.NOT_FOUND, 404);
  }

  return toUserDTO(user);
}

/**
 * Update user profile
 * Only allows updating non-sensitive fields like username
 * 
 * @throws {AppError} If user is not found
 */
export async function updateUserProfile(
  userId: string,
  updateData: { username?: string }
): Promise<UserDTO> {
  const user = await UserModel.findById(userId).exec();
  
  if (!user) {
    throw new AppError('User not found', ErrorCode.NOT_FOUND, 404);
  }

  // Update only allowed fields
  if (updateData.username !== undefined) {
    user.username = updateData.username;
  }

  await user.save();

  return toUserDTO(user);
}

/**
 * Change user password
 * Verifies current password before allowing change
 * 
 * @throws {AppError} If user not found or current password is invalid
 */
export async function changeUserPassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await UserModel.findById(userId).exec();
  
  if (!user) {
    throw new AppError('User not found', ErrorCode.NOT_FOUND, 404);
  }

  // Verify current password
  const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isPasswordValid) {
    throw new AppError('Current password is invalid', ErrorCode.VALIDATION_ERROR, 400);
  }

  // Hash and save new password
  const passwordHash = await hashPassword(newPassword);
  user.passwordHash = passwordHash;

  await user.save();
  // A stolen session must not survive a password change: end every refresh session of the user
  await revokeAllForUser(userId);
}

/**
 * Save the interface language of the user.
 *
 * @throws {AppError} If user is not found
 */
export async function updateUserLocale(userId: string, locale: Locale): Promise<{ locale: Locale }> {
  const user = await UserModel.findByIdAndUpdate(userId, { locale }, { new: true, runValidators: true }).exec();

  if (!user || !user.locale) {
    throw new AppError('User not found', ErrorCode.NOT_FOUND, 404);
  }

  return { locale: user.locale };
}
