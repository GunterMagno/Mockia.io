import { Request, Response, NextFunction } from 'express';
import { registerUser, loginUser, refreshTokens, logoutSession } from './service.js';
import { revokeAllForUser, listActiveSessions, type SessionMeta } from './sessions.js';
import type { AuthenticatedRequest } from '../../middlewares/authenticateToken.js';
import type { 
  CreateUserRequest,
  LoginRequest, 
  LoginResponse, 
  RefreshTokensResponse 
} from '@mockia/shared';
import { asyncHandler } from '../../middlewares/errorHandler.js';

/**
 * Controller for user registration
 * Connects the HTTP world (Express) with business logic
 */

/** Client info stored on a session so the user can recognise it in the session list. */
function sessionMeta(req: Request): SessionMeta {
  return { ip: req.ip, ua: req.get('user-agent') };
}

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
    const loginResponse: LoginResponse = await loginUser(loginRequest, sessionMeta(req));

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
    const newTokens: RefreshTokensResponse = await refreshTokens(refreshToken, sessionMeta(req));

    // Respond with 200 OK and the new token pair
    res.status(200).json({
      success: true,
      data: newTokens,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * POST /api/auth/logout
 * Revokes the session (refresh-token family) the given refresh token belongs to.
 * Idempotent: always 204, even for an unknown, expired or missing token.
 *
 * Expected body: { "refreshToken": "<jwt-refresh-token>" }
 */
export const logout = asyncHandler(
  async (req: Request<{}, {}, { refreshToken?: string }>, res: Response, next: NextFunction) => {
    await logoutSession(req.body?.refreshToken);
    res.status(204).send();
  }
);

/**
 * POST /api/auth/logout-all
 * Revokes every session of the authenticated user.
 *
 * @returns 204
 */
export const logoutAll = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user!.id;
  await revokeAllForUser(userId);
  res.status(204).send();
});

/**
 * GET /api/auth/sessions
 * Lists the authenticated user's live sessions (one per login).
 *
 * @returns 200 with [{ id, createdAt, ip, ua, current }]
 */
export const sessions = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user!.id;
  const data = await listActiveSessions(userId);
  res.status(200).json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
});

import { getUserProfile } from '../users/service.js';

/**
 * GET /api/auth/me
 * Gets current user info
 */
export const me = asyncHandler(
  async (req: Request, res: Response) => {
    const authReq = req as import('../../middlewares/authenticateToken.js').AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      res.status(401).json({ success: false, error: { message: 'Not authenticated' } });
      return;
    }
    
    const user = await getUserProfile(userId);

    res.status(200).json({
      success: true,
      user
    });
  }
);
