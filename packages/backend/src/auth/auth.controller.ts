import { Request, Response, NextFunction } from 'express';
import { registerUser, loginUser, refreshTokens } from './auth.service';
import type { 
  CreateUserRequest,
  LoginRequest, 
  LoginResponse, 
  RefreshTokensResponse 
} from '@mockia/shared';
import { asyncHandler } from '../middlewares/errorHandler';

/**
 * Controller for user registration
 * Connects the HTTP world (Express) with business logic
 */

/**
 * POST /api/auth/register
 * Registers a new user
 *
 * Expected body:
 * {
 *   "email": "user@example.com",
 *   "password": "password123",
 *   "username": "testuser"
 * }
 *
 * @returns 201 with the created user (without password)
 * @throws 400 if validation fails
 * @throws 409 if email already exists
 */
export const register = asyncHandler(
  async (req: Request<{}, {}, CreateUserRequest>, res: Response, next: NextFunction) => {
    const createUserRequest: CreateUserRequest = req.body;

    // Call the service to register the user
    const userDTO = await registerUser(createUserRequest);

    // Respond with 201 (Created) and the created user
    res.status(201).json({
      success: true,
      data: userDTO,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * POST /api/auth/login
 * Authenticates a user and returns JWT tokens
 *
 * Expected body:
 * {
 *   "email": "user@example.com",
 *   "password": "password123"
 * }
 *
 * @returns 200 with user data and { accessToken, refreshToken }
 * @throws 400 if validation fails
 * @throws 401 if credentials are invalid
 */
export const login = asyncHandler(
  async (req: Request<{}, {}, LoginRequest>, res: Response, next: NextFunction) => {
    const loginRequest: LoginRequest = req.body;

    // Call the service to authenticate
    const loginResponse: LoginResponse = await loginUser(loginRequest);

    // Respond with 200 OK and the user data + tokens
    res.status(200).json({
      success: true,
      data: loginResponse,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * POST /api/auth/refresh
 * Refreshes the access token using a valid refresh token
 *
 * Expected body:
 * {
 *   "refreshToken": "<jwt-refresh-token>"
 * }
 *
 * @returns 200 with new { accessToken, refreshToken }
 * @throws 400 if validation fails
 * @throws 401 if refresh token is invalid or expired
 */
export const refresh = asyncHandler(
  async (req: Request<{}, {}, { refreshToken: string }>, res: Response, next: NextFunction) => {
    const { refreshToken } = req.body;

    // Call the service to refresh tokens
    const newTokens: RefreshTokensResponse = await refreshTokens(refreshToken);

    // Respond with 200 OK and the new token pair
    res.status(200).json({
      success: true,
      data: newTokens,
      timestamp: new Date().toISOString(),
    });
  }
);
