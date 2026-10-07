import jsonwebtoken from 'jsonwebtoken';

/**
 * JWT payload interface
 * Contains the token payload structure
 */
interface TokenPayload {
  sub: string; // user ID
  jti?: string; // Token ID (refresh tokens only: id of the stored RefreshSession)
  iat?: number; // Issued at
  exp?: number; // Expiration time
}

/** Refresh tokens always carry the jti of their RefreshSession. */
export interface RefreshTokenPayload extends TokenPayload {
  jti: string;
}

const ACCESS_TOKEN_EXPIRES_IN = '15m';
/** Also the lifetime of a RefreshSession (sessions.ts), so the JWT and its stored session expire together. */
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
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
    // A refresh token without jti (issued before sessions were revocable) cannot be checked against a session.
    if (kind === 'refresh' && (typeof payload.jti !== 'string' || !payload.jti)) {
      throw new Error('missing jti');
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
 * Signs a refresh token with user ID and the jti of its RefreshSession
 * @param userId - The user's unique identifier
 * @param jti - Id of the stored session this token belongs to (becomes the `jti` claim)
 * @returns Signed JWT refresh token
 * @throws Error if JWT_REFRESH_SECRET is missing or weak
 */
export function signRefreshToken(userId: string, jti: string): string {
  return jsonwebtoken.sign({ sub: userId }, getSecret('JWT_REFRESH_SECRET'), {
    algorithm: ALGORITHM,
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
    jwtid: jti,
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
 * @returns Token payload including user ID and jti
 * @throws Error if token is invalid, expired or has no jti
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return verifyToken(token, getSecret('JWT_REFRESH_SECRET'), 'refresh') as RefreshTokenPayload;
}
