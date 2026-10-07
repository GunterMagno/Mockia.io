import crypto from 'crypto';
import type { IncomingHttpHeaders } from 'http';

/**
 * API keys of the mock endpoints.
 *
 * A project with visibility 'key' only answers requests that carry its key in `X-Mockia-API-Key`
 * (`X-Mockia-Key` is accepted as an alias). The database only stores the SHA-256 of the key plus a short
 * display prefix; the full key is shown once, when it is issued. Keys are 192 random bits, so a plain
 * (unsalted, fast) hash is the right tool here: there is nothing to brute-force.
 */

export const API_KEY_HEADERS = ['x-mockia-api-key', 'x-mockia-key'] as const;
const KEY_PREFIX = 'mk_';
/** "mk_" + the first 6 hex chars: enough to recognise a key, useless to guess it. */
const DISPLAY_PREFIX_LENGTH = KEY_PREFIX.length + 6;
/** Longer than any key we issue: not worth hashing (headers are capped by Node anyway). */
const MAX_PRESENTED_LENGTH = 256;

export const hashApiKey = (key: string): string => crypto.createHash('sha256').update(key, 'utf8').digest('hex');

/** A new key. The caller stores `hash` and `prefix`; `apiKey` is shown to the user once and then forgotten. */
export function generateApiKey(): { apiKey: string; hash: string; prefix: string } {
  const apiKey = `${KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
  return { apiKey, hash: hashApiKey(apiKey), prefix: apiKey.slice(0, DISPLAY_PREFIX_LENGTH) };
}

/** The key sent by the client, if any (first value when the header is repeated). */
export function presentedApiKey(headers: IncomingHttpHeaders): string | undefined {
  for (const name of API_KEY_HEADERS) {
    const raw = headers[name];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value) return value;
  }
  return undefined;
}

/** True when `presented` is the key whose SHA-256 is `storedHash`. Compares digests in constant time. */
export function apiKeyMatches(presented: string | undefined, storedHash: string | null | undefined): boolean {
  if (!presented || !storedHash || presented.length > MAX_PRESENTED_LENGTH) return false;
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(hashApiKey(presented), 'hex');
  // Both are 32-byte digests whatever the length of the presented value, so the compare never short-circuits on length.
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export interface MockAccessProject {
  visibility?: string | null;
  apiKeyHash?: string | null;
}

/**
 * May this request reach the mock? Public projects: always. 'key' projects: only with the right key.
 * A 'key' project with no key (revoked) lets nobody in: it fails closed.
 */
export function mockAccessAllowed(project: MockAccessProject, headers: IncomingHttpHeaders): boolean {
  if (project.visibility !== 'key') return true;
  return apiKeyMatches(presentedApiKey(headers), project.apiKeyHash);
}

/** Body of the 401 for a request without a valid key (same envelope as every other mock error). */
export const mockUnauthorizedBody = () => ({
  success: false,
  error: {
    code: 'UNAUTHORIZED',
    message: 'This mock requires an API key: send it in the X-Mockia-API-Key header',
  },
  timestamp: new Date().toISOString(),
});

/** Headers a browser may read from a mock response (rate limit info). */
export const MOCK_EXPOSED_HEADERS = [
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'Retry-After',
  'X-Mockia-Request-ID',
];

/**
 * CORS of the mock endpoints (open origin). `allowedHeaders` is left unset on purpose: the cors package then echoes
 * Access-Control-Request-Headers, so X-Mockia-API-Key / X-Mockia-Key and whatever else the consumer's app sends
 * (Authorization, custom headers) pass the preflight. The preflight itself never needs a key.
 */
export const MOCK_CORS_OPTIONS = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  exposedHeaders: MOCK_EXPOSED_HEADERS,
};
