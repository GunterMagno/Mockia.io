import axios from 'axios';
import { LlmResponseError } from './types.js';

/**
 * What one request to a provider amounted to, from the point of view of "can the provider have billed it?":
 *  - answered:  the provider produced a completion (even one that is cut by max_tokens, empty or not what we asked for);
 *  - refused:   it explicitly refused (an HTTP error status) or could not be reached (connection refused, DNS): it
 *               generated nothing, so nothing is billed;
 *  - uncertain: anything else (a timeout, an abort or deadline, a reset in mid-flight, an unknown failure): the provider
 *               may have been generating, and a paid provider bills what it generated even if we gave up.
 * Callers that pay per model call refund only when every request that left ended `refused`.
 */
export type ProviderOutcome = 'answered' | 'refused' | 'uncertain';

const ABORT_NAMES = new Set(['AbortError', 'TimeoutError', 'CanceledError']);

/** Network failures that happen before any request reaches the provider. */
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

/**
 * Outcome of a provider call that threw. Errors that went through the OpenRouter client are AppErrors and carry the
 * outcome the client worked out from the original axios error (`providerOutcome`), because the AppError itself no longer
 * tells a 503 answer from a timeout.
 */
export function providerOutcomeOf(err: unknown): ProviderOutcome {
  if (err instanceof LlmResponseError) return 'answered';
  const marked = (err as { providerOutcome?: unknown } | null)?.providerOutcome;
  if (marked === 'answered' || marked === 'refused' || marked === 'uncertain') return marked;
  if (axios.isAxiosError(err)) {
    if (err.response) return 'refused';
    if (err.code && UNREACHABLE_CODES.has(err.code)) return 'refused';
    return 'uncertain'; // timeout, reset in flight, cancelled by the deadline or the caller...
  }
  if (err instanceof Error) {
    // Aborts say nothing about what the provider did; any other plain error is ours (a missing key, a bad URL) and
    // happened before anything could be generated
    return ABORT_NAMES.has(err.name) ? 'uncertain' : 'refused';
  }
  return 'uncertain';
}

/** Marks an error with the outcome of the call that produced it (see providerOutcomeOf). */
export function withProviderOutcome<T extends Error>(err: T, outcome: ProviderOutcome): T {
  (err as T & { providerOutcome?: ProviderOutcome }).providerOutcome = outcome;
  return err;
}
