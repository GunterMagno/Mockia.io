import bcrypt from 'bcrypt';
import { UserModel } from '../../models/User.js';
import { DuplicateUserError } from '../../models/errors.js';
import type { 
  CreateUserRequest, 
  User as UserDTO,
  LoginRequest,
  LoginResponse,
  RefreshTokensResponse 
} from '@mockia/shared';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../services/jwt.service.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { ErrorCode } from '@mockia/shared';
import {
  createSession,
  rotateSession,
  revokeAllForUser,
  revokeFamilyByJti,
  type SessionMeta,
} from './sessions.js';

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

/**
 * Authenticates a user with email and password
 * Returns user data and JWT tokens (access + refresh)
 * 
 * Flow:
 * 1. Find user by email (case-insensitive)
 * 2. Verify the provided password against the stored hash
 * 3. Open a session (new refresh-token family) and generate access and refresh tokens
 * 4. Map user document to DTO and return with tokens
 *
 * @param loginRequest - DTO with email and password
 * @param meta - ip / user agent of the client, stored on the session
 * @returns Object with user DTO and token pair
 * @throws AppError with 401 if credentials are invalid
 * @throws Error if there are database issues
 */
export async function loginUser(loginRequest: LoginRequest, meta: SessionMeta = {}): Promise<LoginResponse> {
  const { email, password } = loginRequest;

  // 1. Find user by email or username (case-insensitive)
  const identifier = email.toLowerCase();
  const user = await UserModel.findOne({
    $or: [
      { email: identifier },
      { username: identifier }
    ]
  });

  if (!user) {
    throw new AppError(
      'Invalid email or password',
      ErrorCode.UNAUTHORIZED,
      401
    );
  }
  
  // 2. Verify password
  const isPasswordValid = await verifyPassword(password, user.passwordHash);
  if (!isPasswordValid) {
    throw new AppError(
      'Invalid email or password',
      ErrorCode.UNAUTHORIZED,
      401
    );
  }

  // 3. Open a session and generate tokens
  const userId = user._id.toString();
  const session = await createSession(userId, meta);
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId, session.jti);

  // 4. Map user to DTO
  const userDTO: UserDTO = {
    id: user._id.toString(),
    email: user.email,
    username: user.username,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };

  return {
    user: userDTO,
    tokens: {
      accessToken,
      refreshToken,
    },
  };
}

/**
 * Refreshes an expired access token using a valid refresh token (rotation)
 * 
 * Flow:
 * 1. Verify the refresh token (signature, expiry, jti)
 * 2. Rotate its session: the presented token becomes used and a child is issued in the same family.
 *    A used token replayed outside the grace window revokes the whole family.
 * 3. Verify the user still exists
 * 4. Generate new access and refresh tokens
 * 
 * @param refreshToken - Valid JWT refresh token
 * @param meta - ip / user agent of the client, stored on the new session
 * @returns New token pair
 * @throws AppError with 401 if the refresh token is invalid, expired, revoked or reused
 */
export async function refreshTokens(refreshToken: string, meta: SessionMeta = {}): Promise<RefreshTokensResponse> {
  // 1. Verify refresh token
  let jti: string;
  try {
    jti = verifyRefreshToken(refreshToken).jti;
  } catch (error) {
    throw new AppError(
      'Invalid or expired refresh token',
      ErrorCode.UNAUTHORIZED,
      401
    );
  }

  // 2. Rotate the session (throws AppError 401 for unknown/expired/revoked/reused)
  const rotated = await rotateSession(jti, meta);

  // 3. The user may have been deleted since the session was opened
  const user = await UserModel.findById(rotated.userId);
  if (!user) {
    await revokeAllForUser(rotated.userId);
    throw new AppError(
      'User not found',
      ErrorCode.UNAUTHORIZED,
      401
    );
  }

  // 4. Generate new tokens (the session in the database is the source of truth for the user id)
  return {
    accessToken: signAccessToken(rotated.userId),
    refreshToken: signRefreshToken(rotated.userId, rotated.jti),
  };
}

/**
 * Ends the session a refresh token belongs to (revokes its whole family).
 * Idempotent: an invalid, expired or unknown token is ignored, never an error.
 *
 * @param refreshToken - Refresh token of the session to end (optional so that a client without one can still log out)
 */
export async function logoutSession(refreshToken?: string): Promise<void> {
  if (!refreshToken) return;
  let jti: string;
  try {
    jti = verifyRefreshToken(refreshToken).jti;
  } catch {
    return;
  }
  await revokeFamilyByJti(jti);
}
