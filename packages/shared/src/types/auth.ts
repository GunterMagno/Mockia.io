import type { User } from './user.js';

/**
 * Authentication request - for login endpoint
 */
export interface LoginRequest {
  email: string;
  password: string;
  /**
   * "Remember me": the session cookie that carries the refresh token lives 7 days instead of ending with the
   * browser session. Omitted = false.
   */
  remember?: boolean;
}

/**
 * Tokens the client gets in a response body. Only the short-lived access token: the refresh token never appears
 * in a body, it travels in the HttpOnly `mockia_rt` cookie (Set-Cookie on login / refresh).
 */
export interface AuthTokens {
  accessToken: string;
}

/**
 * Authentication response - returned after successful login
 */
export interface LoginResponse {
  user: User;
  tokens: AuthTokens;
}

/**
 * Refresh response (POST /auth/refresh, which reads the refresh cookie and rotates it): a new access token and
 * the user, so a page that just loaded can restore its session with this single call.
 */
export interface RefreshTokensResponse {
  accessToken: string;
  user: User;
}

/** POST /auth/forgot. The answer is always 202, whether or not the email has an account. */
export interface ForgotPasswordRequest {
  email: string;
  /** Language of the email ('en' | 'es' | 'zh'). Defaults to 'en'. */
  locale?: string;
}

/** POST /auth/reset: sets a new password with the token from the email. */
export interface ResetPasswordRequest {
  token: string;
  password: string;
}

/** POST /auth/verify: confirms the email address with the token from the email. */
export interface VerifyEmailRequest {
  token: string;
}
