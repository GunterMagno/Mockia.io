import { PLAN_LIMITS, getUserPlan } from './plans.js';
import {
  getMonthlyUsageDetail,
  nextPeriodStart,
  releaseAiGenerationSlot,
  reserveAiGenerationSlot,
} from './usage.js';

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

/** Monthly cap of the user's effective plan, or null when the plan has no finite cap (not metered). The single place that decides it. */
async function aiLimitOf(userId: string): Promise<number | null> {
  const plan = await getUserPlan(userId);
  const limit = PLAN_LIMITS[plan].maxMonthlyAiGenerations;
  return Number.isFinite(limit) ? limit : null;
}

export interface AiQuotaStatus {
  used: number;
  /** null: the plan has no finite cap */
  limit: number | null;
  resetsAt: Date;
  /** Whether a reservation made right now would succeed (informative only: the atomic reservation decides). */
  available: boolean;
}

/**
 * Reads the AI quota of `userId` for this UTC month WITHOUT reserving anything: same plan and cap as
 * `reserveAiGeneration`, same counter, but nothing is written and no document is created. The answer can be stale by the
 * time the caller acts (another tab may take the last generation), so the reservation stays the authority.
 */
export async function peekAiGeneration(
  userId: string,
  now: Date = aiQuotaClock.now()
): Promise<AiQuotaStatus> {
  const limit = await aiLimitOf(userId);
  const resetsAt = nextPeriodStart(now);
  if (limit === null) return { used: 0, limit: null, resetsAt, available: true };
  const { aiGenerations } = await getMonthlyUsageDetail(userId, now);
  return { used: aiGenerations, limit, resetsAt, available: aiGenerations < limit };
}
/**
 * Reserves one AI generation for `userId` under the cap of their effective plan (getUserPlan: 30 s cache, past_due
 * grace already applied). A plan without a finite cap is not metered and writes nothing.
 * `release()` is idempotent and never throws (a failed give-back is logged: the user can only lose one generation).
 */
export async function reserveAiGeneration(
  userId: string,
  now: Date = aiQuotaClock.now()
): Promise<AiReservation> {
  const limit = await aiLimitOf(userId);
  if (limit === null) return { ok: true, release: NO_RELEASE };

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
