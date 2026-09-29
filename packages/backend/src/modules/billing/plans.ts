import { UserModel } from '../../models/User.js';

export type Plan = 'free' | 'pro' | 'team';
export type BillingStatus = 'active' | 'past_due' | 'canceled';
export type PaidPlan = Exclude<Plan, 'free'>;

/**
 * Single source of truth for plan limits. Infinity = unlimited.
 * Edit here to change pricing tiers; nothing else hardcodes numbers.
 */
export const PLAN_LIMITS: Record<Plan, { maxActiveProjects: number; maxMonthlyRequests: number }> = {
  free: { maxActiveProjects: 5, maxMonthlyRequests: 10_000 },
  pro: { maxActiveProjects: Infinity, maxMonthlyRequests: Infinity },
  team: { maxActiveProjects: Infinity, maxMonthlyRequests: Infinity },
};

export function asPaidPlan(value: unknown): PaidPlan | undefined {
  return value === 'pro' || value === 'team' ? value : undefined;
}

/**
 * Plan actually enforced. A paid plan only counts while billingStatus is 'active';
 * 'past_due' and 'canceled' degrade to free. Missing fields (legacy users) mean free/active.
 */
export function effectivePlan(user?: { plan?: string | null; billingStatus?: string | null } | null): Plan {
  if (!user) return 'free';
  if ((user.billingStatus ?? 'active') !== 'active') return 'free';
  return asPaidPlan(user.plan) ?? 'free';
}

// ponytail: per-process cache of userId -> plan (30s TTL) to keep the mock hot path off the DB.
// The webhook invalidates it in the same process; with several instances a plan change takes up to TTL to propagate.
const PLAN_TTL_MS = 30_000;
const PLAN_CACHE_MAX = 5_000;
const planCache = new Map<string, { plan: Plan; exp: number }>();

export async function getUserPlan(userId: string): Promise<Plan> {
  const hit = planCache.get(userId);
  if (hit && hit.exp > Date.now()) return hit.plan;
  const user = await UserModel.findById(userId).select('plan billingStatus').lean();
  const plan = effectivePlan(user);
  if (planCache.size >= PLAN_CACHE_MAX) planCache.clear();
  planCache.set(userId, { plan, exp: Date.now() + PLAN_TTL_MS });
  return plan;
}

export function invalidatePlanCache(userId?: string): void {
  if (userId) planCache.delete(userId);
  else planCache.clear();
}
