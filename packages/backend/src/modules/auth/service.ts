import bcrypt from 'bcrypt';
import { UserModel } from '../../models/User.js';
import { RefreshSessionModel } from '../../models/RefreshSession.js';
import { toUserDTO } from '../users/dto.js';
import { hashPassword, rehashIfOutdated } from '../../services/password.service.js';
import { sendVerificationEmail } from './passwordReset.js';
import { DuplicateUserError } from '../../models/errors.js';
import type { 
  CreateUserRequest, 
  User as UserDTO,
  LoginRequest
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
 * What the service hands to the controller after opening or renewing a session.
 * The controller sends `accessToken` (and `user`) in the JSON body and `refreshToken` ONLY in the HttpOnly cookie;
 * `persistent` decides whether that cookie outlives the browser session ("remember me").
 */
export interface IssuedSession {
  user: UserDTO;
  accessToken: string;
  refreshToken: string;
  persistent: boolean;
}

/**
 * Registers a new user
 * 
 * Flow:
 * 1. Check if email already exists in the database
 * 2. Hash the plain text password (bcrypt cost 12)
 * 3. Create the document in MongoDB (unverified)
 * 4. Email a verification link (best effort: registration never fails because of mail)
 * 5. Map the document to API User DTO
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
  const passwordHash = await hashPassword(password);

  // 3. Create the document in MongoDB
  const userDocument = new UserModel({
    email: email.toLowerCase(),
    username,
    passwordHash,
  });

  const savedUser = await userDocument.save();

  // 4. Verification email: the token is created here, the SMTP delivery is not awaited and cannot throw
  await sendVerificationEmail(
    { id: savedUser._id.toString(), email: savedUser.email, username: savedUser.username },
    createUserRequest.locale
  );

  // 5. Map the document to API User DTO
  return toUserDTO(savedUser);
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
 * 3. Transparently re-hash a password stored with a lower bcrypt cost
 * 4. Open a session (new refresh-token family) and generate access and refresh tokens
 * 5. Map user document to DTO and return with tokens
 *
 * @param loginRequest - DTO with email, password and the optional "remember me" flag
 * @param meta - ip / user agent of the client, stored on the session
 * @returns The user plus the issued tokens (the refresh token is for the cookie, not for the response body)
 * @throws AppError with 401 if credentials are invalid
 * @throws Error if there are database issues
 */
export async function loginUser(loginRequest: LoginRequest, meta: SessionMeta = {}): Promise<IssuedSession> {
  const { email, password } = loginRequest;
  const persistent = loginRequest.remember === true;

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

  // 3. Hashes made with an older, cheaper bcrypt cost are upgraded now that the password is proven
  await rehashIfOutdated(user._id.toString(), password, user.passwordHash);

  // 4. Open a session and generate tokens
  const userId = user._id.toString();
  const session = await createSession(userId, meta, persistent);
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId, session.jti);

  // 5. Map user to DTO
  return { user: toUserDTO(user), accessToken, refreshToken, persistent };
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
 * @param refreshToken - JWT refresh token from the cookie (undefined = the browser sent none)
 * @param meta - ip / user agent of the client, stored on the new session
 * @returns The user plus the new tokens (the new refresh token goes back into the cookie, with the same lifetime policy)
 * @throws AppError with 401 if the refresh token is missing, invalid, expired, revoked or reused
 */
export async function refreshTokens(refreshToken: string | undefined, meta: SessionMeta = {}): Promise<IssuedSession> {
  // 1. Verify refresh token
  const jti = refreshTokenJti(refreshToken);
  if (!jti) {
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
    user: toUserDTO(user),
    accessToken: signAccessToken(rotated.userId),
    refreshToken: signRefreshToken(rotated.userId, rotated.jti),
    persistent: rotated.persistent,
  };
}

/**
 * Opens a brand-new session (new family) for a user who is already authenticated, e.g. right after a password change
 * revoked every older session: the caller keeps working instead of being logged out 15 minutes later.
 *
 * @param persistent - "remember me" of the new cookie
 * @throws AppError 404 if the user no longer exists
 */
export async function issueFreshSession(userId: string, meta: SessionMeta, persistent: boolean): Promise<IssuedSession> {
  const user = await UserModel.findById(userId);
  if (!user) throw new AppError('User not found', ErrorCode.NOT_FOUND, 404);
  const session = await createSession(userId, meta, persistent);
  return {
    user: toUserDTO(user),
    accessToken: signAccessToken(userId),
    refreshToken: signRefreshToken(userId, session.jti),
    persistent,
  };
}

/**
 * Whether the refresh session a token belongs to was opened with "remember me". False for a missing, invalid or
 * foreign token (only a session of `userId` counts).
 */
export async function isPersistentSession(refreshToken: string | undefined, userId: string): Promise<boolean> {
  const jti = refreshTokenJti(refreshToken);
  if (!jti) return false;
  const session = await RefreshSessionModel.findOne({ jti, userId }).select('persistent');
  return session?.persistent === true;
}

/**
 * jti of a refresh token, or undefined when there is no token or it is not a valid, unexpired refresh JWT
 * (bad signature, expired, an access token, no jti).
 */
export function refreshTokenJti(refreshToken: string | undefined): string | undefined {
  if (!refreshToken) return undefined;
  try {
    return verifyRefreshToken(refreshToken).jti;
  } catch {
    return undefined;
  }
}

/**
 * Ends the session a refresh token belongs to (revokes its whole family).
 * Idempotent: an invalid, expired or unknown token is ignored, never an error.
 *
 * @param refreshToken - Refresh token of the session to end (optional so that a client without one can still log out)
 */
export async function logoutSession(refreshToken?: string): Promise<void> {
  const jti = refreshTokenJti(refreshToken);
  if (jti) await revokeFamilyByJti(jti);
}
