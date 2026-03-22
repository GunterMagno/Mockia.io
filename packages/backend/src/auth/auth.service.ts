import bcrypt from 'bcrypt';
import { UserModel } from '../models/User';
import { DuplicateUserError } from './errors';
import type { CreateUserRequest, User as UserDTO } from '@mockia/shared';

/**
 * Registers a new user
 * 
 * Flow:
 * 1. Check if email already exists in the database
 * 2. Hash the plain text password
 * 3. Create the document in MongoDB
 * 4. Map the document to API User DTO
 * 
 * @param createUserRequest - DTO with email, password, username
 * @returns Created user mapped to User DTO
 * @throws DuplicateUserError if email already exists
 * @throws Error if there are database issues
 */
export async function registerUser(
  createUserRequest: CreateUserRequest
): Promise<UserDTO> {
  const { email, password, username } = createUserRequest;

  // 1. Check if email already exists
  const existingUser = await UserModel.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    throw new DuplicateUserError(`Email ${email} is already registered`);
  }

  // 2. Hash the password
  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // 3. Create the document in MongoDB
  const userDocument = new UserModel({
    email: email.toLowerCase(),
    username,
    passwordHash,
  });

  const savedUser = await userDocument.save();

  // 4. Map the document to API User DTO
  const userDTO: UserDTO = {
    id: savedUser._id.toString(),
    email: savedUser.email,
    username: savedUser.username,
    createdAt: savedUser.createdAt.toISOString(),
    updatedAt: savedUser.updatedAt.toISOString(),
  };

  return userDTO;
}

/**
 * Verifies a password against its hash
 * Useful for login
 * 
 * @param password - Plain text password
 * @param passwordHash - Stored hash in database
 * @returns true if password is correct
 */
export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
