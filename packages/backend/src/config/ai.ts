/**
 * AI Configuration
 * Centralized configuration for AI services (OpenRouter, etc.)
 */

/**
 * OpenRouter API configuration
 */
/** Model used when OPENROUTER_MODEL is unset or empty. It may be retired by OpenRouter: production should set it. */
export const DEFAULT_OPENROUTER_MODEL = 'google/gemini-flash-1.5';

/** OPENROUTER_MODEL, or the default when it is unset, empty or blank (compose forwards unset variables as ""). */
export function openRouterModelFrom(env: NodeJS.ProcessEnv = process.env): string {
  return (env.OPENROUTER_MODEL ?? '').trim() || DEFAULT_OPENROUTER_MODEL;
}

export const openRouterConfig = {
  apiKey: process.env.OPENROUTER_API_KEY || '',
  model: openRouterModelFrom(),
  baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
};

/**
 * Sampling of the endpoint-generation calls (generate-mock-api-spec, generate-and-save). One definition for the
 * controller and for the evaluation bench, so the benchmark samples exactly like production.
 */
export const SPEC_GENERATION_DEFAULTS = { temperature: 0.85, maxTokens: 5000 } as const;

/**
 * Retry configuration for API calls
 */
export const retryConfig = {
  maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
  initialDelayMs: parseInt(process.env.INITIAL_RETRY_DELAY_MS || '1000', 10),
  maxDelayMs: parseInt(process.env.MAX_RETRY_DELAY_MS || '30000', 10),
};

/**
 * Get OpenRouter API key
 * @throws Error if API key is not configured
 */
export function getOpenRouterApiKey(): string {
  if (!openRouterConfig.apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is not set');
  }
  return openRouterConfig.apiKey;
}

/**
 * Get OpenRouter model name
 */
export function getOpenRouterModel(): string {
  return openRouterConfig.model;
}

/**
 * Get OpenRouter base URL
 */
export function getOpenRouterBaseUrl(): string {
  return openRouterConfig.baseUrl;
}

/* ------------------------------------------------------------------------------------------------------------------
 * Provider selection and local (self-hosted, OpenAI-compatible) model
 * ---------------------------------------------------------------------------------------------------------------- */

export const AI_PROVIDER_NAMES = ['local', 'openrouter'] as const;
export type AiProviderName = (typeof AI_PROVIDER_NAMES)[number];

const DEFAULT_LOCAL_MODEL = 'qwen2.5-coder:7b-instruct';
const DEFAULT_LOCAL_TIMEOUT_MS = 120_000; // a cold model load on a CPU/GPU box can take a minute or more
const DEFAULT_AI_RATE_PER_MINUTE = 20;
// Whole request budget across all providers. Keep it below the front proxy read timeout (nginx /api/ai/: 300 s).
const DEFAULT_AI_TOTAL_TIMEOUT_MS = 240_000;

/**
 * Parses AI_PROVIDERS: an ordered, comma separated list of provider names ("local,openrouter").
 * Unset or blank means "openrouter" (the behaviour before providers existed). Names are case/space insensitive,
 * duplicates collapse to their first position and unknown names are returned in `ignored` for the caller to warn about.
 * `providers` is empty only when the variable lists nothing valid; getLlm() turns that into an error.
 */
export function parseAiProviders(raw: string | undefined): { providers: AiProviderName[]; ignored: string[] } {
  if (raw === undefined || raw.trim() === '') return { providers: ['openrouter'], ignored: [] };
  const providers: AiProviderName[] = [];
  const ignored: string[] = [];
  for (const item of raw.split(',')) {
    const name = item.trim().toLowerCase();
    if (!name) continue;
    if ((AI_PROVIDER_NAMES as readonly string[]).includes(name)) {
      if (!providers.includes(name as AiProviderName)) providers.push(name as AiProviderName);
    } else if (!ignored.includes(name)) {
      ignored.push(name);
    }
  }
  return { providers, ignored };
}

export interface LocalAiConfig {
  /** Server root WITHOUT /v1 (e.g. http://llm:11434); the client appends /v1/chat/completions. */
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** Optional: vLLM can be started with --api-key; Ollama needs none. */
  apiKey: string | undefined;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt((value ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Local model settings, read from `env` on every call so tests (and a restart-less env change) see current values. */
export function getLocalAiConfig(env: NodeJS.ProcessEnv = process.env): LocalAiConfig {
  return {
    baseUrl: (env.AI_LOCAL_BASE_URL ?? '').trim().replace(/\/+$/, ''),
    model: (env.AI_LOCAL_MODEL ?? '').trim() || DEFAULT_LOCAL_MODEL,
    timeoutMs: positiveInt(env.AI_LOCAL_TIMEOUT_MS, DEFAULT_LOCAL_TIMEOUT_MS),
    apiKey: (env.AI_LOCAL_API_KEY ?? '').trim() || undefined,
  };
}

/** AI calls one user may start per minute (AI_RATE_PER_MINUTE, default 20). */
export function getAiRatePerMinute(env: NodeJS.ProcessEnv = process.env): number {
  return positiveInt(env.AI_RATE_PER_MINUTE, DEFAULT_AI_RATE_PER_MINUTE);
}

/** Overall deadline of one AI request across the whole fallback chain (AI_TOTAL_TIMEOUT_MS, default 240000). */
export function getAiTotalTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return positiveInt(env.AI_TOTAL_TIMEOUT_MS, DEFAULT_AI_TOTAL_TIMEOUT_MS);
}

const DEFAULT_AI_GENERATION_RETENTION_DAYS = 180;
const MAX_AI_GENERATION_RETENTION_DAYS = 3650;

/**
 * Days a stored AI generation (consented users only) and its feedback live before the TTL index removes them
 * (AI_GENERATION_RETENTION_DAYS, default 180). Only a plain positive integer counts; anything else falls back to the
 * default, and the value is capped at ten years so a typo cannot keep personal data practically forever.
 */
export function getAiGenerationRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.AI_GENERATION_RETENTION_DAYS ?? '').trim();
  if (!/^\d{1,5}$/.test(raw)) return DEFAULT_AI_GENERATION_RETENTION_DAYS;
  const n = Number.parseInt(raw, 10);
  return n > 0 ? Math.min(n, MAX_AI_GENERATION_RETENTION_DAYS) : DEFAULT_AI_GENERATION_RETENTION_DAYS;
}

/**
 * Sampling of the endpoint-generation routes. Always the server's: the client cannot choose temperature or max tokens
 * (a huge max_tokens could keep the local model busy and its breaker open for everyone). AI_SPEC_TEMPERATURE lets the
 * owner tune the temperature after running the evaluation bench (a number from 0 to 2; empty or invalid keeps 0.85).
 */
export function getSpecGenerationSampling(env: NodeJS.ProcessEnv = process.env): { temperature: number; maxTokens: number } {
  const raw = (env.AI_SPEC_TEMPERATURE ?? '').trim();
  const value = raw === '' ? Number.NaN : Number(raw);
  const temperature = Number.isFinite(value) && value >= 0 && value <= 2 ? value : SPEC_GENERATION_DEFAULTS.temperature;
  return { temperature, maxTokens: SPEC_GENERATION_DEFAULTS.maxTokens };
}

/**
 * Startup warning (production only, and only when OpenRouter is in the chain) when OPENROUTER_MODEL is not set: the
 * built-in default may have been retired by OpenRouter, and the evaluation baseline must be measured against the model
 * production really uses. The default is deliberately NOT changed silently. Returns null when there is nothing to say.
 */
export function openRouterModelWarning(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_ENV !== 'production') return null;
  if (!parseAiProviders(env.AI_PROVIDERS).providers.includes('openrouter')) return null;
  if ((env.OPENROUTER_MODEL ?? '').trim() !== '') return null;
  return (
    `[AI] OPENROUTER_MODEL is not set: using the built-in default "${DEFAULT_OPENROUTER_MODEL}", which OpenRouter may have ` +
    'retired. Set OPENROUTER_MODEL explicitly (and run the evaluation baseline with that same model).'
  );
}
