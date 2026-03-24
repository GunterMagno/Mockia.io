import type { User } from './user';

/**
 * Authentication request - for login endpoint
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Authentication tokens pair
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Authentication response - returned after successful login
 */
export interface LoginResponse {
  user: User;
  tokens: AuthTokens;
}

/**
 * Refresh tokens request
 */
export interface RefreshTokensRequest {
  refreshToken: string;
}

/**
 * Refresh tokens response - returned after token refresh
 */
export interface RefreshTokensResponse {
  accessToken: string;
  refreshToken: string;
}
