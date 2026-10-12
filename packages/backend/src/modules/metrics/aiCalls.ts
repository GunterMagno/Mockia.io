import { AiCallModel, type AiCallEvent, type AiCallOutcome } from '../../models/AiCall.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { describeError } from '../../utils/safeErrorLog.js';
import {
  carriesProviderOutcome,
  llmFailureOf,
  providerOutcomeOf,
  type ProviderOutcome,
} from '../ai/providers/outcome.js';
import type { LlmCompletion, LlmProvider, LlmRequest } from '../ai/providers/types.js';

export type { AiCallEvent, AiCallOutcome, AiCallPlan, AiCallScope } from '../../models/AiCall.js';

/** Writes that were fired and have not finished: lets a test (or a clean shutdown) wait for them. */
const pending = new Set<Promise<void>>();

/**
 * Stores one AI call event. NEVER throws and is meant to be fired without awaiting (`void recordAiCall(...)`): a metric
 * must not change what the user receives, so a failure (Mongo down, a bad value) is logged without content and dropped.
 */
export function recordAiCall(event: AiCallEvent, now: Date = new Date()): Promise<void> {
  const write = (async () => {
    try {
      await AiCallModel.create({ ...event, at: now });
    } catch (err) {
      // describeError: class, status and code only; the error message could quote the event or a connection string
      console.error(`[Metrics] could not record an AiCall (${describeError(err)})`);
    }
  })();
  pending.add(write);
  void write.finally(() => pending.delete(write));
  return write;
}

/**
 * Waits for the event writes in flight (tests, graceful shutdown), at most `timeoutMs`: a write stuck on a dead
 * database must not hold a shutdown. Never rejects.
 */
export async function drainAiCalls(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (pending.size > 0 && Date.now() < deadline) {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all([...pending]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
      }),
    ]);
    clearTimeout(timer);
  }
}

/**
 * What an AI call amounted to, for the metrics.
 *  - `result`: how the LAST request that left for a provider ended (the onProviderResult hook), or undefined when none left;
 *  - `err`: what the call threw, undefined when it succeeded.
 * Order: success; a model answer that was cut or unusable; the overall deadline; then what the provider did. A failure of
 * ours after a good answer (the database, say) or before anything was sent is a plain 'error'.
 */
export function outcomeFromProviderResult(
  result: ProviderOutcome | undefined,
  err?: unknown
): AiCallOutcome {
  if (err === undefined) return 'ok';
  const failure = llmFailureOf(err);
  if (failure === 'truncated') return 'truncated';
  if (failure) return 'invalid';
  if (err instanceof AppError && err.statusCode === 504) return 'timeout';
  const outcome = result ?? (carriesProviderOutcome(err) ? providerOutcomeOf(err) : undefined);
  if (outcome === 'uncertain') return 'timeout';
  if (outcome === 'refused') return 'refused';
  return 'error';
}

export interface AiCallContext {
  scope: AiCallEvent['scope'];
  plan: AiCallEvent['plan'];
}

/**
 * Runs one completion through `llm` and records ONE AiCall for it (the single place per path: the users' controller and
 * the demo service both go through here). The caller's own hooks (refund tracking, budget) keep working. Recording is
 * fired, not awaited, so the answer is never delayed or changed by it.
 */
export async function completeAndRecord(
  llm: LlmProvider,
  req: LlmRequest,
  context: AiCallContext
): Promise<LlmCompletion> {
  const startedAt = Date.now();
  let provider: string | undefined;
  let last: ProviderOutcome | undefined;
  const wrapped: LlmRequest = {
    ...req,
    onProviderCall: (name) => {
      if (name) provider = name;
      req.onProviderCall?.(name);
    },
    onProviderResult: (outcome) => {
      last = outcome;
      req.onProviderResult?.(outcome);
    },
  };
  const latencyMs = () => Math.max(0, Date.now() - startedAt);
  try {
    const completion = await llm.complete(wrapped);
    void recordAiCall({
      scope: context.scope,
      plan: context.plan,
      provider: completion.provider,
      model: completion.model,
      outcome: 'ok',
      ...(completion.usage
        ? { inputTokens: completion.usage.inputTokens, outputTokens: completion.usage.outputTokens }
        : {}),
      latencyMs: latencyMs(),
    });
    return completion;
  } catch (err) {
    void recordAiCall({
      scope: context.scope,
      plan: context.plan,
      provider: provider ?? 'none',
      model: 'unknown',
      // `err ?? new Error()`: a thrown undefined is still a failure
      outcome: outcomeFromProviderResult(last, err ?? new Error('unknown')),
      latencyMs: latencyMs(),
    });
    throw err;
  }
}
