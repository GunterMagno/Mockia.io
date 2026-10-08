/**
 * getLlm(): the one entry point controllers use to talk to a language model.
 *
 * AI_PROVIDERS ("local,openrouter") lists the providers in order of preference. A request goes to the first one and, if
 * it fails for any reason other than the caller aborting, to the next. The local provider sits behind a circuit breaker
 * so that a stopped or hung model server costs one slow request, not 120 s on every request.
 *
 * Logs name the provider and the kind of failure only (status code or error class): never prompts, repository
 * content, model answers or keys.
 */

import axios from 'axios';
import { ErrorCode } from '@mockia/shared';
import { AppError } from '../../../middlewares/errorHandler.js';
import { getLocalAiConfig, parseAiProviders, type AiProviderName } from '../../../config/ai.js';
import { createOpenAiCompatibleProvider, createOpenRouterProvider } from './openaiCompatible.js';
import { LlmResponseError, type LlmCompletion, type LlmProvider, type LlmRequest } from './types.js';

export type { ChatMessage, LlmCompletion, LlmProvider, LlmRequest } from './types.js';

/** Consecutive failures that open the circuit, and how long it stays open before one trial request is let through. */
export const BREAKER_FAILURE_THRESHOLD = 3;
export const BREAKER_COOLDOWN_MS = 60_000;

export interface BreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
}

export interface FallbackEntry {
  provider: LlmProvider;
  /** Skip this provider after repeated failures. Leave unset for the last resort, which must always be tried. */
  breaker?: BreakerOptions;
}

export interface FallbackOptions {
  /** Clock in ms, injectable for tests. */
  now?: () => number;
}

/** Closed -> (N consecutive failures) open -> (cooldown) half-open: exactly one trial request -> closed or open again. */
class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;
  private trialInFlight = false;

  constructor(
    private readonly options: BreakerOptions,
    private readonly now: () => number
  ) {}

  /** true when the request may go through. In half-open state only the first caller gets true until it reports back. */
  tryAcquire(): boolean {
    if (this.openUntil === 0) return true;
    if (this.now() < this.openUntil) return false;
    if (this.trialInFlight) return false;
    this.trialInFlight = true;
    return true;
  }

  onSuccess(): void {
    this.failures = 0;
    this.openUntil = 0;
    this.trialInFlight = false;
  }

  onFailure(): void {
    this.trialInFlight = false;
    this.failures += 1;
    if (this.failures >= this.options.failureThreshold) this.openUntil = this.now() + this.options.cooldownMs;
  }

  /** The call ended for a reason that says nothing about the provider's health (caller abort). */
  onAbandoned(): void {
    this.trialInFlight = false;
  }
}

/** Short, content-free name of a failure, safe to log. */
export function classifyFailure(err: unknown): string {
  if (err instanceof LlmResponseError) return err.kind;
  if (err instanceof AppError) return `http_${err.statusCode}`;
  if (axios.isAxiosError(err)) {
    if (err.response) return `http_${err.response.status}`;
    const code = err.code ?? '';
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'timeout';
    if (code === 'ECONNREFUSED') return 'connection_refused';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns_error';
    if (code) return code;
  }
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'timeout';
    if (code === 'ECONNREFUSED') return 'connection_refused';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns_error';
    return err.name || 'Error';
  }
  return 'unknown';
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('The AI request was aborted');
}

function toServiceError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError('AI service temporarily unavailable. Please try again later.', ErrorCode.EXTERNAL_SERVICE_ERROR, 503);
}

export function createFallbackLlm(entries: FallbackEntry[], options: FallbackOptions = {}): LlmProvider {
  const now = options.now ?? Date.now;
  const slots = entries.map((entry) => ({
    provider: entry.provider,
    breaker: entry.breaker ? new CircuitBreaker(entry.breaker, now) : undefined,
  }));

  return {
    name: slots.map((s) => s.provider.name).join(','),
    async complete(req: LlmRequest): Promise<LlmCompletion> {
      let lastError: unknown;
      for (let i = 0; i < slots.length; i++) {
        const { provider, breaker } = slots[i];
        if (req.signal?.aborted) throw abortReason(req.signal);
        if (breaker && !breaker.tryAcquire()) {
          console.warn(`[AI] Provider "${provider.name}" skipped (circuit open after repeated failures)`);
          continue;
        }
        try {
          const result = await provider.complete(req);
          breaker?.onSuccess();
          return result;
        } catch (err) {
          if (req.signal?.aborted) {
            breaker?.onAbandoned();
            throw err;
          }
          breaker?.onFailure();
          lastError = err;
          const next = slots[i + 1]?.provider.name;
          console.warn(
            `[AI] Provider "${provider.name}" failed (${classifyFailure(err)})` +
              (next ? `; falling back to "${next}"` : '; no more providers')
          );
        }
      }
      throw toServiceError(lastError);
    },
  };
}

function buildProvider(name: AiProviderName, env: NodeJS.ProcessEnv): FallbackEntry {
  if (name === 'local') {
    const local = getLocalAiConfig(env);
    return {
      provider: createOpenAiCompatibleProvider({ name: 'local', ...local }),
      breaker: { failureThreshold: BREAKER_FAILURE_THRESHOLD, cooldownMs: BREAKER_COOLDOWN_MS },
    };
  }
  return { provider: createOpenRouterProvider() };
}

let cached: { key: string; llm: LlmProvider } | null = null;

/**
 * The configured provider chain. Cached (the circuit breaker's state must outlive a request) and rebuilt only when the
 * AI_* settings change. Throws if AI_PROVIDERS lists no valid provider.
 */
export function getLlm(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const local = getLocalAiConfig(env);
  const key = JSON.stringify([env.AI_PROVIDERS ?? '', local]);
  if (cached?.key === key) return cached.llm;

  const { providers, ignored } = parseAiProviders(env.AI_PROVIDERS);
  if (ignored.length > 0) {
    console.warn(
      `[AI] AI_PROVIDERS: ignoring unknown provider(s) ${ignored.map((n) => `"${n}"`).join(', ')} (valid: local, openrouter)`
    );
  }
  if (providers.length === 0) {
    throw new Error('AI_PROVIDERS does not list any valid provider (valid: local, openrouter)');
  }

  const llm = createFallbackLlm(providers.map((name) => buildProvider(name, env)));
  cached = { key, llm };
  return llm;
}

/** Forgets the cached chain and its circuit breakers (tests). */
export function resetLlm(): void {
  cached = null;
}
