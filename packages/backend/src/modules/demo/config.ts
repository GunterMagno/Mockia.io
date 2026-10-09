import crypto from 'crypto';

/**
 * Configuration of the public demo (anonymous, no account). Everything is read from the environment on every call, so
 * a deploy can tighten a limit without code changes and tests can change it per case. The demo ships DISABLED:
 * deploying this code opens nothing until the owner sets DEMO_ENABLED=true (and DEMO_HMAC_SECRET in production).
 */

export interface DemoConfig {
  enabled: boolean;
  /** AI generations the whole demo may spend per UTC day (the demo's own budget, apart from every user's quota). */
  dailyGenerations: number;
  perIpGenerationsPerDay: number;
  /** Generations running at the same time in this process; per-process, so N instances allow N times this. */
  maxConcurrent: number;
  maxConcurrentPerIp: number;
  /** Leading zero bits the browser must find in SHA-256(challenge:nonce). */
  powBits: number;
  mockTtlMinutes: number;
  /** Requests one demo mock serves before it stops. */
  mockMaxRequests: number;
  ipMockRequestsPerDay: number;
  maxEndpoints: number;
}

/** 2^24 hashes is already minutes of CPU in a browser: anything higher is a typo, not a policy. */
const MAX_POW_BITS = 24;

const TRUE = /^(true|1|yes|on)$/i;

const int = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw.trim());
  return n >= min && n <= max ? n : fallback;
};

export function getDemoConfig(env: NodeJS.ProcessEnv = process.env): DemoConfig {
  return {
    enabled: TRUE.test(env.DEMO_ENABLED?.trim() ?? ''),
    dailyGenerations: int(env.DEMO_DAILY_GENERATIONS, 150, 0, 100_000),
    perIpGenerationsPerDay: int(env.DEMO_PER_IP_GENERATIONS, 2, 0, 1000),
    maxConcurrent: int(env.DEMO_MAX_CONCURRENT, 4, 1, 100),
    maxConcurrentPerIp: 1,
    powBits: int(env.DEMO_POW_BITS, 18, 1, MAX_POW_BITS),
    mockTtlMinutes: int(env.DEMO_MOCK_TTL_MINUTES, 30, 1, 24 * 60),
    mockMaxRequests: 150,
    ipMockRequestsPerDay: 300,
    maxEndpoints: 5,
  };
}

let ephemeralSecret: string | undefined;

/**
 * Root secret of the demo (DEMO_HMAC_SECRET). Outside production a missing one is replaced by a random per-process
 * secret so development works without setup; in production it must exist (assertProdConfig enforces it at boot when
 * the demo is enabled) and a missing one throws instead of silently signing with something guessable.
 */
function rootSecret(env: NodeJS.ProcessEnv): string {
  const configured = env.DEMO_HMAC_SECRET;
  if (configured) return configured;
  if (env.NODE_ENV === 'production') throw new Error('DEMO_HMAC_SECRET is not set');
  ephemeralSecret ??= crypto.randomBytes(32).toString('hex');
  return ephemeralSecret;
}

/** Key for one purpose ('demo-pow', 'demo-ip'): the two uses of the root secret never share a key. */
export function demoKey(label: 'demo-pow' | 'demo-ip', env: NodeJS.ProcessEnv = process.env): Buffer {
  return crypto.createHmac('sha256', rootSecret(env)).update(label).digest();
}
