import crypto from 'crypto';

/**
 * OPS_TOKEN: the bearer token of GET /api/ops/summary, which the monitoring workflows (A3, A4) read. It is a secret of
 * the deployment, not a user credential. Unset, empty or shorter than 32 characters (after trimming) means the endpoint
 * does not exist: a short token would be a brute-force target, so it is treated as "off" at runtime and assertProdConfig
 * refuses to boot with one in production.
 */
export const MIN_OPS_TOKEN_LENGTH = 32;

/** The configured token, or null when the endpoint is off. Read from the environment on every call. */
export function getOpsToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = (env.OPS_TOKEN ?? '').trim();
  return token.length >= MIN_OPS_TOKEN_LENGTH ? token : null;
}

/** True when OPS_TOKEN is set but too short to be accepted (assertProdConfig turns it into a boot failure). */
export function isOpsTokenTooShort(env: NodeJS.ProcessEnv = process.env): boolean {
  const token = (env.OPS_TOKEN ?? '').trim();
  return token.length > 0 && token.length < MIN_OPS_TOKEN_LENGTH;
}

/**
 * Compares a presented token with the configured one in constant time. Both are hashed first, so the comparison always
 * runs over 32 bytes whatever the length of what was presented (timingSafeEqual throws on different lengths and a
 * length check would leak the token's length).
 */
export function opsTokenMatches(presented: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
