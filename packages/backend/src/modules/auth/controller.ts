import { Request, Response, NextFunction } from 'express';
import { registerUser, loginUser, refreshTokens, logoutSession, refreshTokenJti, type IssuedSession } from './service.js';
import { revokeAllForUser, listActiveSessions, type SessionMeta } from './sessions.js';
import { setRefreshCookie, clearRefreshCookie, readRefreshCookie } from './cookie.js';
import type { AuthenticatedRequest } from '../../middlewares/authenticateToken.js';
import type { 
  CreateUserRequest,
  LoginRequest, 
  LoginResponse, 
  RefreshTokensResponse 
} from '@mockia/shared';
import { AppError, asyncHandler } from '../../middlewares/errorHandler.js';

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
 * Authenticates a user: the access token comes in the body, the refresh token in the HttpOnly `mockia_rt` cookie.
 *
 * Expected body:
 * {
 *   "email": "user@example.com",
 *   "password": "password123",
 *   "remember": true            (optional: the cookie lives 7 days instead of ending with the browser session)
 * }
 *
 * @returns 200 with { user, tokens: { accessToken } } and Set-Cookie: mockia_rt
 * @throws 400 if validation fails
 * @throws 401 if credentials are invalid
 */
export const login = asyncHandler(
  async (req: Request<{}, {}, LoginRequest>, res: Response, next: NextFunction) => {
    const loginRequest: LoginRequest = req.body;

    const { user, accessToken, refreshToken, persistent } = await loginUser(loginRequest, sessionMeta(req));
    setRefreshCookie(res, refreshToken, persistent);

    // The refresh token must never reach the body (page scripts can read bodies, not HttpOnly cookies)
    const data: LoginResponse = { user, tokens: { accessToken } };
    res.status(200).json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * POST /api/auth/refresh
 * Exchanges the refresh cookie for a new access token and a rotated cookie.
 * Requires the `X-Requested-With: mockia` header (CSRF defence, see requireCsrfHeader in the route).
 * The refresh token is read ONLY from the cookie; a body is ignored.
 *
 * @returns 200 with { accessToken, user } and a new Set-Cookie: mockia_rt (same lifetime policy as the login)
 * @throws 401 if the cookie is missing, invalid, expired, revoked or reused (the cookie is cleared)
 * @throws 403 if the CSRF header is missing
 */
export const refresh = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    let issued: IssuedSession;
    try {
      issued = await refreshTokens(readRefreshCookie(req), sessionMeta(req));
    } catch (err) {
      // The session is gone (no/invalid/expired/revoked/reused token): drop the dead cookie. A server error
      // (e.g. database down) keeps it, since the user may still hold a perfectly valid session.
      if (err instanceof AppError && err.statusCode === 401) clearRefreshCookie(res);
      throw err;
    }
    setRefreshCookie(res, issued.refreshToken, issued.persistent);

    const data: RefreshTokensResponse = { accessToken: issued.accessToken, user: issued.user };
    res.status(200).json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * POST /api/auth/logout
 * Revokes the session (refresh-token family) the cookie belongs to and clears the cookie.
 * Idempotent: always 204, even for an unknown, expired or missing cookie.
 * Requires the `X-Requested-With: mockia` header (403 otherwise; nothing is revoked or cleared).
 */
export const logout = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    // Cleared first: even if revoking fails the browser stops holding the credential
    clearRefreshCookie(res);
    await logoutSession(readRefreshCookie(req));
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
 * @returns 200 with [{ id, createdAt, ip, ua, current }] (`current`: the login of the request's refresh cookie)
 */
export const sessions = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user!.id;
  // The refresh cookie (Path /api/auth also covers this route) tells which listed login is the caller's
  const data = await listActiveSessions(userId, refreshTokenJti(readRefreshCookie(req)));
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
