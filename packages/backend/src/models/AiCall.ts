import { Schema, model } from 'mongoose';
import type { Plan } from '@mockia/shared';

/**
 * One call to the AI (a user generation or a public-demo generation), kept ONLY for the owner's metrics and alerts
 * (decision D3). It is deliberately anonymous: no user id, no IP, no project, no prompt, no output. With nothing that
 * points at a person it is not personal data, so it stays outside the account export/erase (see users.gdpr.test.ts).
 * Adding a field that identifies someone or quotes content here is a privacy decision, not a schema tweak: the test
 * metrics.aiCalls pins the exact keys of the document.
 *
 * Documents expire 90 days after `at` through the TTL index.
 */
export type AiCallScope = 'users' | 'demo' | 'byok';
export type AiCallPlan = Plan | 'anonymous';
export type AiCallOutcome = 'ok' | 'invalid' | 'truncated' | 'timeout' | 'refused' | 'error';

export const AI_CALL_SCOPES: readonly AiCallScope[] = ['users', 'demo', 'byok'];
export const AI_CALL_PLANS: readonly AiCallPlan[] = ['free', 'starter', 'pro', 'team', 'anonymous'];
export const AI_CALL_OUTCOMES: readonly AiCallOutcome[] = [
  'ok',
  'invalid',
  'truncated',
  'timeout',
  'refused',
  'error',
];

/** Retention of the events. */
export const AI_CALL_TTL_SECONDS = 90 * 24 * 60 * 60;

export interface AiCallEvent {
  scope: AiCallScope;
  plan: AiCallPlan;
  /** Name of the provider that answered, or the last one a request was sent to ('none' when nothing was sent). */
  provider: string;
  /** Model that answered, as the server reported it ('unknown' when no completion came back). */
  model: string;
  outcome: AiCallOutcome;
  inputTokens?: number;
  outputTokens?: number;
  /** From the start of the call to the provider chain until it ended, repair retries and fallbacks included. */
  latencyMs: number;
}

export interface AiCallDocument extends AiCallEvent {
  at: Date;
}

const aiCallSchema = new Schema<AiCallDocument>(
  {
    at: { type: Date, required: true },
    scope: { type: String, required: true, enum: AI_CALL_SCOPES },
    plan: { type: String, required: true, enum: AI_CALL_PLANS },
    provider: { type: String, required: true, maxlength: 64 },
    model: { type: String, required: true, maxlength: 200 },
    outcome: { type: String, required: true, enum: AI_CALL_OUTCOMES },
    inputTokens: { type: Number, min: 0 },
    outputTokens: { type: Number, min: 0 },
    latencyMs: { type: Number, required: true, min: 0 },
  },
  // Strict (the default) drops any field that is not above; no __v either: the document has exactly these keys
  { versionKey: false }
);

aiCallSchema.index({ at: 1 }, { expireAfterSeconds: AI_CALL_TTL_SECONDS });
// The panel reads windows of time split by scope and outcome
aiCallSchema.index({ scope: 1, outcome: 1, at: -1 });

export const AiCallModel = model<AiCallDocument>('AiCall', aiCallSchema);
