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
import {
  getAiTotalTimeoutMs,
  getLocalAiConfig,
  parseAiProviders,
  type AiProviderName,
} from '../../../config/ai.js';
import { createOpenAiCompatibleProvider, createOpenRouterProvider } from './openaiCompatible.js';
import { LlmResponseError, type LlmCompletion, type LlmProvider, type LlmRequest } from './types.js';
import { providerOutcomeOf } from './outcome.js';

export { providerOutcomeOf, type ProviderOutcome } from './outcome.js';

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
  /** Clock in ms for the circuit breaker, injectable for tests. */
  now?: () => number;
  /**
   * Overall deadline of one request across all providers (default AI_TOTAL_TIMEOUT_MS = 240000). It is delivered to
   * every provider as an AbortSignal, so each call ends at min(its own timeout, what is left of the budget).
   */
  totalTimeoutMs?: number;
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

function deadlineError(): AppError {
  return new AppError(
    'The AI request took too long and was cancelled. Please try again.',
    ErrorCode.EXTERNAL_SERVICE_ERROR,
    504
  );
}

function toServiceError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof LlmResponseError && (err.kind === 'invalid_output' || err.kind === 'truncated')) {
    return new AppError('The AI returned an invalid answer. Please try again.', ErrorCode.EXTERNAL_SERVICE_ERROR, 502);
  }
  return new AppError('AI service temporarily unavailable. Please try again later.', ErrorCode.EXTERNAL_SERVICE_ERROR, 503);
}

/** HTTP statuses that depend on the request itself (too large, rejected parameters), not on the server's health. */
const INPUT_DEPENDENT_FAILURES = new Set(['http_400', 'http_413', 'http_422']);

/** The extra turn of a repair retry: only the validator's content-free reason, never the rejected output. */
function repairMessage(reason: string) {
  return {
    role: 'user' as const,
    content:
      `Your previous output was invalid: ${reason}. Return only valid JSON that matches the required schema, ` +
      'with no explanation and no markdown.',
  };
}

/**
 * One provider's answer, validated with the caller's validator: an invalid text gets ONE repair retry on the same
 * provider (same deadline signal); a second invalid text throws LlmResponseError('invalid_output').
 */
async function completeValidated(provider: LlmProvider, req: LlmRequest): Promise<LlmCompletion> {
  const first = await callProvider(provider, req);
  if (!req.validate) return first;
  const reason = req.validate(first.text);
  if (reason === null) return first;
  console.warn(`[AI] Provider "${provider.name}" returned an invalid answer (invalid_output); asking it once to repair it`);
  const second = await callProvider(provider, { ...req, messages: [...req.messages, repairMessage(reason)] });
  if (req.validate(second.text) !== null) throw new LlmResponseError('invalid_output');
  return second;
}

/** One request to one provider, reported to the caller's hooks: that it left, and how it ended. */
async function callProvider(provider: LlmProvider, req: LlmRequest): Promise<LlmCompletion> {
  req.onProviderCall?.();
  try {
    const completion = await provider.complete(req);
    req.onProviderResult?.('answered');
    return completion;
  } catch (err) {
    req.onProviderResult?.(providerOutcomeOf(err));
    throw err;
  }
}

export function createFallbackLlm(entries: FallbackEntry[], options: FallbackOptions = {}): LlmProvider {
  const now = options.now ?? Date.now;
  const totalTimeoutMs = options.totalTimeoutMs ?? getAiTotalTimeoutMs();
  const slots = entries.map((entry) => ({
    provider: entry.provider,
    breaker: entry.breaker ? new CircuitBreaker(entry.breaker, now) : undefined,
  }));

  return {
    name: slots.map((s) => s.provider.name).join(','),
    async complete(req: LlmRequest): Promise<LlmCompletion> {
      let lastError: unknown;
      // The deadline and the caller's signal are one signal for the providers; which one fired is told apart below.
      const deadline = AbortSignal.timeout(totalTimeoutMs);
      const signal = req.signal ? AbortSignal.any([req.signal, deadline]) : deadline;
      const providerReq: LlmRequest = { ...req, signal };
      for (let i = 0; i < slots.length; i++) {
        const { provider, breaker } = slots[i];
        if (req.signal?.aborted) throw abortReason(req.signal);
        if (deadline.aborted) throw deadlineError();
        if (breaker && !breaker.tryAcquire()) {
          console.warn(`[AI] Provider "${provider.name}" skipped (circuit open after repeated failures)`);
          continue;
        }
        try {
          const result = await completeValidated(provider, providerReq);
          breaker?.onSuccess();
          return result;
        } catch (err) {
          if (req.signal?.aborted) {
            breaker?.onAbandoned();
            throw err;
          }
          // A 400/413/422 is caused by this request (size, parameters): fall back, but do not let one user's input
          // open the circuit for everybody
          if (INPUT_DEPENDENT_FAILURES.has(classifyFailure(err))) breaker?.onAbandoned();
          else breaker?.onFailure();
          if (deadline.aborted) {
            console.warn(`[AI] Provider "${provider.name}" cut by the overall deadline (${totalTimeoutMs} ms)`);
            throw deadlineError();
          }
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

/**
 * Chains by configuration. More than one can be alive (the demo may use its own AI_DEMO_PROVIDERS list while the
 * registered users use AI_PROVIDERS): a single slot would rebuild, and so reset the circuit breakers of, both chains
 * on every alternate request. Bounded, so changing the settings many times (tests) cannot grow it without limit.
 */
const MAX_CACHED_CHAINS = 8;
const cached = new Map<string, LlmProvider>();

/**
 * Who a chain serves. The scope is part of the cache key, so the public demo ALWAYS has its own chain, with its own
 * circuit breakers, even when it uses the same providers as the registered users: whatever anonymous visitors do
 * (garbage outputs, timeouts) can never open the breaker the users' requests go through.
 */
export type LlmScope = 'users' | 'demo';

/**
 * The configured provider chain. Cached (the circuit breaker's state must outlive a request) and rebuilt only when the
 * AI_* settings change. Throws if AI_PROVIDERS lists no valid provider.
 */
export function getLlm(env: NodeJS.ProcessEnv = process.env, scope: LlmScope = 'users'): LlmProvider {
  const local = getLocalAiConfig(env);
  const totalTimeoutMs = getAiTotalTimeoutMs(env);
  const key = JSON.stringify([scope, env.AI_PROVIDERS ?? '', local, totalTimeoutMs]);
  const hit = cached.get(key);
  if (hit) return hit;

  const { providers, ignored } = parseAiProviders(env.AI_PROVIDERS);
  if (ignored.length > 0) {
    console.warn(
      `[AI] AI_PROVIDERS: ignoring unknown provider(s) ${ignored.map((n) => `"${n}"`).join(', ')} (valid: local, openrouter)`
    );
  }
  if (providers.length === 0) {
    throw new Error('AI_PROVIDERS does not list any valid provider (valid: local, openrouter)');
  }

  const llm = createFallbackLlm(
    providers.map((name) => buildProvider(name, env)),
    { totalTimeoutMs }
  );
  if (cached.size >= MAX_CACHED_CHAINS) cached.delete(cached.keys().next().value as string);
  cached.set(key, llm);
  return llm;
}

/** Forgets the cached chain and its circuit breakers (tests). */
export function resetLlm(): void {
  cached.clear();
}
