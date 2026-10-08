import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { ErrorCode } from '@mockia/shared';
import { AppError } from '../../middlewares/errorHandler.js';
import { REFRESH_TOKEN_TTL_SECONDS } from '../../services/jwt.service.js';

/**
 * The refresh token lives in an HttpOnly cookie, so page scripts (and any XSS) can never read it. Only the
 * short-lived access token is handed to the client in a response body and kept in memory.
 *
 * - Path=/api/auth: the browser sends the cookie only to the auth endpoints, never to the rest of the API or the mocks.
 * - Secure in production (and always with SameSite=None, which browsers reject without it).
 * - SameSite=Lax by default (COOKIE_SAMESITE=strict|none). Lax cookies are only sent on same-site requests, so
 *   production must serve the SPA and /api from ONE origin (nginx / the Render rewrite): across sites
 *   (e.g. two onrender.com services) the browser would drop the cookie and sessions could not be renewed.
 * - Max-Age 7 d only when the user chose "remember me"; otherwise a session cookie that ends with the browser.
 */

export const REFRESH_COOKIE_NAME = 'mockia_rt';
export const REFRESH_COOKIE_PATH = '/api/auth';

/** CSRF defence for the cookie-authenticated endpoints: a header a cross-site form can't send and a cross-origin
 *  fetch can only send after a CORS preflight that the allow-list rejects. */
export const CSRF_HEADER_NAME = 'X-Requested-With';
export const CSRF_HEADER_VALUE = 'mockia';

type SameSite = 'lax' | 'strict' | 'none';

/** SameSite policy of the cookie from COOKIE_SAMESITE; anything unknown falls back to the safe default, lax. */
export function cookieSameSite(env: NodeJS.ProcessEnv = process.env): SameSite {
  const value = env.COOKIE_SAMESITE?.trim().toLowerCase();
  return value === 'strict' || value === 'none' ? value : 'lax';
}

/**
 * Attributes of the refresh cookie. Read from the environment on every call (not at import time) so the policy
 * always matches the deployment's current configuration.
 *
 * @param persistent - the user chose "remember me": the cookie gets Max-Age (7 d), else it is a session cookie
 */
export function refreshCookieOptions(persistent: boolean, env: NodeJS.ProcessEnv = process.env): CookieOptions {
  const sameSite = cookieSameSite(env);
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production' || sameSite === 'none',
    sameSite,
    path: REFRESH_COOKIE_PATH,
    ...(persistent ? { maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000 } : {}),
  };
}

/** Sends the refresh token to the browser (also renews Max-Age on every rotation of a persistent session). */
export function setRefreshCookie(res: Response, refreshToken: string, persistent: boolean): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(persistent));
}

/** Tells the browser to drop the cookie. It must repeat Path/SameSite/Secure or the browser keeps the old one. */
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions(false));
}

/** The refresh token the browser sent, or undefined. Anything that is not a plain string (cookie-parser turns a
 *  `j:{...}` value into an object) counts as no token. */
export function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Login-CSRF defence for the credential endpoints (login, register, forgot, reset): only `application/json` bodies
 * are accepted (415 otherwise). A cross-site HTML form can only send urlencoded, multipart or text/plain bodies without
 * a CORS preflight; JSON forces the preflight, which the CORS allow-list rejects. Without this, an attacker's form
 * could log the victim's browser into the attacker's account (SameSite=Lax cookies are set on top-level POSTs).
 */
export function requireJsonBody(req: Request, _res: Response, next: NextFunction): void {
  if (!req.is('application/json')) {
    next(new AppError('Content-Type must be application/json', ErrorCode.VALIDATION_ERROR, 415));
    return;
  }
  next();
}

/** Rejects (403) the request unless it carries `X-Requested-With: mockia`. Guards the cookie-based endpoints. */
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction): void {
  if (req.get(CSRF_HEADER_NAME) !== CSRF_HEADER_VALUE) {
    next(new AppError(`Missing or invalid ${CSRF_HEADER_NAME} header`, ErrorCode.FORBIDDEN, 403));
    return;
  }
  next();
}
