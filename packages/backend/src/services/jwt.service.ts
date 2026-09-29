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

const ACCESS_TOKEN_EXPIRES_IN = '1h';
const REFRESH_TOKEN_EXPIRES_IN = '7d';
const ALGORITHM = 'HS256' as const;
const MIN_SECRET_LENGTH = 32;

/**
 * Reads a JWT secret from the environment.
 * Rejects missing or short secrets and an access secret equal to the refresh secret
 * (equal secrets would let a refresh token pass as an access token).
 */
function getSecret(name: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET'): string {
  const secret = process.env[name];
  if (!secret) {
    throw new Error(`${name} is not defined in environment variables`);
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  const other = process.env[name === 'JWT_ACCESS_SECRET' ? 'JWT_REFRESH_SECRET' : 'JWT_ACCESS_SECRET'];
  if (other === secret) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }
  return secret;
}

/**
 * Fails fast at startup when the JWT configuration is unsafe.
 */
export function assertJwtConfig(): void {
  getSecret('JWT_ACCESS_SECRET');
  getSecret('JWT_REFRESH_SECRET');
}

function verifyToken(token: string, secret: string, kind: 'access' | 'refresh'): TokenPayload {
  try {
    // Algorithm pinned: rejects "none" and any algorithm other than HS256.
    const payload = jsonwebtoken.verify(token, secret, { algorithms: [ALGORITHM] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string' || !payload.sub) {
      throw new Error('malformed payload');
    }
    return payload as TokenPayload;
  } catch (error) {
    throw new Error(`Invalid or expired ${kind} token: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Signs an access token with user ID
 * @param userId - The user's unique identifier
 * @returns Signed JWT access token
 * @throws Error if JWT_ACCESS_SECRET is missing or weak
 */
export function signAccessToken(userId: string): string {
  return jsonwebtoken.sign({ sub: userId }, getSecret('JWT_ACCESS_SECRET'), {
    algorithm: ALGORITHM,
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });
}

/**
 * Signs a refresh token with user ID
 * @param userId - The user's unique identifier
 * @returns Signed JWT refresh token
 * @throws Error if JWT_REFRESH_SECRET is missing or weak
 */
export function signRefreshToken(userId: string): string {
  return jsonwebtoken.sign({ sub: userId }, getSecret('JWT_REFRESH_SECRET'), {
    algorithm: ALGORITHM,
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
  return verifyToken(token, getSecret('JWT_ACCESS_SECRET'), 'access');
}

/**
 * Verifies a refresh token and returns the payload
 * @param token - The JWT refresh token to verify
 * @returns Token payload including user ID
 * @throws Error if token is invalid or expired
 */
export function verifyRefreshToken(token: string): TokenPayload {
  return verifyToken(token, getSecret('JWT_REFRESH_SECRET'), 'refresh');
}
