import bcrypt from 'bcrypt';
import { UserModel } from '../models/User';
import { DuplicateUserError } from '../models/errors';
import type { 
  CreateUserRequest, 
  User as UserDTO,
  LoginRequest,
  LoginResponse,
  RefreshTokensResponse 
} from '@mockia/shared';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './jwt.service';
import { AppError } from '../middlewares/errorHandler';
import { ErrorCode } from '@mockia/shared';

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
 * 3. Generate access and refresh tokens
 * 4. Map user document to DTO and return with tokens
 * 
 * @param loginRequest - DTO with email and password
 * @returns Object with user DTO and token pair
 * @throws AppError with 401 if credentials are invalid
 * @throws Error if there are database issues
 */
export async function loginUser(loginRequest: LoginRequest): Promise<LoginResponse> {
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

  // 3. Generate tokens
  const accessToken = signAccessToken(user._id.toString());
  const refreshToken = signRefreshToken(user._id.toString());

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
 * Refreshes expired access token using a valid refresh token
 * 
 * Flow:
 * 1. Verify the refresh token is valid
 * 2. Extract user ID from refresh token payload
 * 3. Generate new access and refresh tokens
 * 
 * @param refreshToken - Valid JWT refresh token
 * @returns New token pair
 * @throws AppError with 401 if refresh token is invalid or expired
 * @throws Error if token verification fails
 */
export async function refreshTokens(refreshToken: string): Promise<RefreshTokensResponse> {
  // 1. Verify refresh token
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (error) {
    throw new AppError(
      'Invalid or expired refresh token',
      ErrorCode.UNAUTHORIZED,
      401
    );
  }

  // 2. Extract user ID
  const userId = payload.sub;

  // Optional: Verify user still exists
  const user = await UserModel.findById(userId);
  if (!user) {
    throw new AppError(
      'User not found',
      ErrorCode.UNAUTHORIZED,
      401
    );
  }

  // 3. Generate new tokens
  const newAccessToken = signAccessToken(userId);
  const newRefreshToken = signRefreshToken(userId);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
}
