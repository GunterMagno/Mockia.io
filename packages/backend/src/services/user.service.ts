import bcrypt from 'bcrypt';
import { UserModel } from '../models/User.js';
import type { User as UserDTO } from '@mockia/shared';
import { AppError } from '../middlewares/errorHandler.js';
import { ErrorCode } from '@mockia/shared';

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

  return {
    id: user._id.toString(),
    email: user.email,
    username: user.username,
    createdAt: user.createdAt!.toISOString(),
    updatedAt: user.updatedAt!.toISOString(),
  };
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

  return {
    id: user._id.toString(),
    email: user.email,
    username: user.username,
    createdAt: user.createdAt!.toISOString(),
    updatedAt: user.updatedAt!.toISOString(),
  };
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
  const passwordHash = await bcrypt.hash(newPassword, 10);
  user.passwordHash = passwordHash;
  
  await user.save();
}
