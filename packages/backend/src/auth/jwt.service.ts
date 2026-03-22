import jsonwebtoken from 'jsonwebtoken';

/**
 * JWT payload interface
 * Contains the token payload structure
 */
interface TokenPayload {
  sub: string; // user ID
  iat?: number; // Issued at
  exp?: number; // Expiration time
}

const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_EXPIRES_IN = '7d';

/**
 * Signs an access token with user ID
 * @param userId - The user's unique identifier
 * @returns Signed JWT access token
 * @throws Error if JWT_ACCESS_SECRET is not defined
 */
export function signAccessToken(userId: string): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error('JWT_ACCESS_SECRET is not defined in environment variables');
  }

  return jsonwebtoken.sign({ sub: userId }, secret, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });
}

/**
 * Signs a refresh token with user ID
 * @param userId - The user's unique identifier
 * @returns Signed JWT refresh token
 * @throws Error if JWT_REFRESH_SECRET is not defined
 */
export function signRefreshToken(userId: string): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) {
    throw new Error('JWT_REFRESH_SECRET is not defined in environment variables');
  }

  return jsonwebtoken.sign({ sub: userId }, secret, {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
  });
}

/**
 * Verifies an access token and returns the payload
 * @param token - The JWT access token to verify
 * @returns Token payload including user ID
 * @throws Error if token is invalid or expired
 */
export function verifyAccessToken(token: string): TokenPayload {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error('JWT_ACCESS_SECRET is not defined in environment variables');
  }

  try {
    return jsonwebtoken.verify(token, secret) as TokenPayload;
  } catch (error) {
    throw new Error(`Invalid or expired access token: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Verifies a refresh token and returns the payload
 * @param token - The JWT refresh token to verify
 * @returns Token payload including user ID
 * @throws Error if token is invalid or expired
 */
export function verifyRefreshToken(token: string): TokenPayload {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) {
    throw new Error('JWT_REFRESH_SECRET is not defined in environment variables');
  }

  try {
    return jsonwebtoken.verify(token, secret) as TokenPayload;
  } catch (error) {
    throw new Error(`Invalid or expired refresh token: ${error instanceof Error ? error.message : String(error)}`);
  }
}
