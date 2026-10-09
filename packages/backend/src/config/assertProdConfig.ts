/**
 * Production configuration guard.
 *
 * Pure function of `env`: when NODE_ENV is "production" it throws a single Error listing every unsafe setting,
 * so a misconfigured deploy fails at boot instead of running with open CORS, a default database password or
 * a guessable JWT secret. Outside production it never throws (dev/test keep their convenient defaults).
 *
 * Error messages name the offending variables but never echo secret values.
 */

import { parseAiProviders } from './ai.js';

const MIN_SECRET_LENGTH = 32;

/** Placeholder secrets shipped in docker-compose.prod.yml / .env.example in the past. Must never reach production. */
const KNOWN_DEFAULT_SECRETS: ReadonlySet<string> = new Set([
  'production_secret_key_change_me',
  'production_access_key',
  'production_refresh_key',
  'your-jwt-secret-key-change-this-in-production',
  'your-jwt-refresh-secret-key-change-this-in-production',
]);

/** Any "change-me" style placeholder (dev compose defaults, .env.example templates, copy-pasted examples). */
const PLACEHOLDER_SECRET = /change[-_ ]?(me|this|in[-_ ]production)/i;

const JWT_VARS = ['JWT_SECRET', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function assertProdConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const problems: string[] = [];

  const origins = (env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    problems.push('CORS_ORIGIN must be set to the explicit frontend origin(s)');
  } else if (origins.includes('*')) {
    problems.push(
      'CORS_ORIGIN must not be "*" in production; list the explicit frontend origin(s)',
    );
  }

  if ((env.MONGODB_URI ?? '').includes(':password@')) {
    problems.push('MONGODB_URI uses the default database password; set a strong one');
  }

  if (!env.APP_URL?.trim()) {
    problems.push('APP_URL must be set to the public URL of the application');
  }

  // GET /api/__test__/outbox serves every email sent, password-reset links included: an account takeover in production
  if (/^(true|1|yes|on)$/i.test(env.E2E_EXPOSE_MAIL_OUTBOX?.trim() ?? '')) {
    problems.push('E2E_EXPOSE_MAIL_OUTBOX must not be enabled in production (it would expose password reset links)');
  }

  // AI providers: "local" talks to a self-hosted model server, so it needs a usable address. OpenRouter keeps its
  // existing behaviour (the key is only needed when a request reaches it).
  if (env.AI_PROVIDERS !== undefined && env.AI_PROVIDERS.trim() !== '') {
    const { providers } = parseAiProviders(env.AI_PROVIDERS);
    if (providers.length === 0) {
      problems.push('AI_PROVIDERS does not list any valid provider (valid: local, openrouter)');
    } else if (providers.includes('local')) {
      const baseUrl = (env.AI_LOCAL_BASE_URL ?? '').trim();
      if (!baseUrl) {
        problems.push('AI_LOCAL_BASE_URL must be set when AI_PROVIDERS includes "local" (e.g. http://llm:11434)');
      } else if (!isHttpUrl(baseUrl)) {
        problems.push('AI_LOCAL_BASE_URL must be an http:// or https:// URL');
      }
    }
  }

  // The public demo signs its proof-of-work challenges and pseudonymizes visitor IPs with DEMO_HMAC_SECRET
  if (/^(true|1|yes|on)$/i.test(env.DEMO_ENABLED?.trim() ?? '')) {
    const secret = env.DEMO_HMAC_SECRET ?? '';
    if (secret.length < MIN_SECRET_LENGTH || KNOWN_DEFAULT_SECRETS.has(secret) || PLACEHOLDER_SECRET.test(secret)) {
      problems.push(`DEMO_HMAC_SECRET must be set to a random secret of at least ${MIN_SECRET_LENGTH} characters when DEMO_ENABLED is true`);
    }
  }

  // Missing JWT_ACCESS_SECRET / JWT_REFRESH_SECRET is reported by assertJwtConfig(); here we reject weak values that are set.
  for (const name of JWT_VARS) {
    const value = env[name];
    if (value === undefined || value === '') continue;
    if (KNOWN_DEFAULT_SECRETS.has(value) || PLACEHOLDER_SECRET.test(value)) {
      problems.push(
        `${name} is set to a known default/placeholder value; generate a random secret`,
      );
    } else if (value.length < MIN_SECRET_LENGTH) {
      problems.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Insecure production configuration:\n - ${problems.join('\n - ')}`);
  }
}
