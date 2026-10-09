import { UserModel } from '../../models/User.js';
import { PAST_DUE_GRACE_DAYS, PLAN_LIMITS, type BillingStatus, type PaidPlan, type Plan } from '@mockia/shared';

/**
 * Plan limits and prices live in @mockia/shared (billing.ts): one catalog for what the backend
 * enforces and what the frontend advertises. Re-exported here so existing imports keep working.
 */
export { PLAN_LIMITS };
export type { BillingStatus, PaidPlan, Plan };

export function asPaidPlan(value: unknown): PaidPlan | undefined {
  return value === 'starter' || value === 'pro' || value === 'team' ? value : undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

type BillingFields = {
  plan?: string | null;
  billingStatus?: string | null;
  /** Date from the DB (or ISO string from a serialized copy). */
  pastDueSince?: Date | string | null;
};

/**
 * End of the grace period of a past_due user, or null when there is none to speak of: not past_due, or the start of the
 * failure is unknown (legacy rows that were downgraded under the old immediate rule stay free).
 */
export function graceEndsAt(user?: BillingFields | null): Date | null {
  if (!user || user.billingStatus !== 'past_due' || !user.pastDueSince) return null;
  const since = new Date(user.pastDueSince).getTime();
  return Number.isFinite(since) ? new Date(since + PAST_DUE_GRACE_DAYS * DAY_MS) : null;
}

/**
 * Plan actually enforced. A paid plan counts while billingStatus is 'active'; a 'past_due' user keeps it during the grace
 * period (PAST_DUE_GRACE_DAYS from the first failed payment) and drops to free once it is over; 'canceled' is free at once.
 * Missing fields (legacy users) mean free/active.
 */
export function effectivePlan(user?: BillingFields | null, now: number = Date.now()): Plan {
  if (!user) return 'free';
  const status = user.billingStatus ?? 'active';
  const paid = asPaidPlan(user.plan) ?? 'free';
  if (status === 'active') return paid;
  if (status === 'past_due') {
    const end = graceEndsAt(user);
    return end !== null && now < end.getTime() ? paid : 'free';
  }
  return 'free';
}

// ponytail: per-process cache of userId -> plan (30s TTL) to keep the mock hot path off the DB.
// The webhook invalidates it in the same process; with several instances a plan change takes up to TTL to propagate.
// A past_due answer is never cached beyond the end of the grace period, so the downgrade needs no webhook to take effect.
const PLAN_TTL_MS = 30_000;
const PLAN_CACHE_MAX = 5_000;
const planCache = new Map<string, { plan: Plan; exp: number }>();

export async function getUserPlan(userId: string): Promise<Plan> {
  const now = Date.now();
  const hit = planCache.get(userId);
  if (hit && hit.exp > now) return hit.plan;
  const user = await UserModel.findById(userId).select('plan billingStatus pastDueSince').lean();
  const plan = effectivePlan(user, now);
  const graceEnd = graceEndsAt(user)?.getTime();
  const exp = graceEnd !== undefined && graceEnd > now ? Math.min(now + PLAN_TTL_MS, graceEnd) : now + PLAN_TTL_MS;
  if (planCache.size >= PLAN_CACHE_MAX) planCache.clear();
  planCache.set(userId, { plan, exp });
  return plan;
}

export function invalidatePlanCache(userId?: string): void {
  if (userId) planCache.delete(userId);
  else planCache.clear();
}
