import { PLAN_LIMITS, getUserPlan } from './plans.js';
import { nextPeriodStart, releaseAiGenerationSlot, reserveAiGenerationSlot } from './usage.js';

/**
 * Monthly cap of successful AI generations per plan (PLAN_LIMITS[plan].maxMonthlyAiGenerations). The AI is the only
 * real variable cost of the product, so the cap is enforced on the server BEFORE any model is called.
 *
 * The counter is `aiGenerations` of the owner's monthly `usages` document (UTC month, see usage.ts). A reservation is
 * one atomic conditional $inc, so parallel requests can never overshoot the cap; the caller gives it back with
 * `release()` on every failure path (model error, validation failure, deadline, exceptions) and keeps it on success.
 */

export type AiReservation =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; used: number; limit: number; resetsAt: Date };

/** Clock of the AI quota (UTC month boundaries). Tests replace `now` to cross a month without touching the system date. */
export const aiQuotaClock = { now: (): Date => new Date() };

const NO_RELEASE = async (): Promise<void> => undefined;

/**
 * Reserves one AI generation for `userId` under the cap of their effective plan (getUserPlan: 30 s cache, past_due
 * grace already applied). A plan without a finite cap is not metered and writes nothing.
 * `release()` is idempotent and never throws (a failed give-back is logged: the user can only lose one generation).
 */
export async function reserveAiGeneration(userId: string, now: Date = aiQuotaClock.now()): Promise<AiReservation> {
  const plan = await getUserPlan(userId);
  const limit = PLAN_LIMITS[plan].maxMonthlyAiGenerations;
  if (!Number.isFinite(limit)) return { ok: true, release: NO_RELEASE };

  const slot = await reserveAiGenerationSlot(userId, limit, now);
  if (!slot.ok) return { ok: false, used: slot.used, limit, resetsAt: nextPeriodStart(now) };

  let released = false;
  return {
    ok: true,
    release: async () => {
      if (released) return;
      released = true;
      try {
        await releaseAiGenerationSlot(userId, slot.period);
      } catch (err) {
        console.error('[AI quota] could not give back a reserved generation:', err);
      }
    },
  };
}
