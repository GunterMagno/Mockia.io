import {
  ADMIN_METRICS_DAYS,
  PAST_DUE_GRACE_DAYS,
  PLAN_PRICE_USD,
  PLANS,
  type AdminAiScope,
  type AdminMetrics,
  type PaidPlan,
  type Plan,
} from '@mockia/shared';
import { UserModel } from '../../models/User.js';
import { ProjectModel } from '../../models/Project.js';
import { UsageModel } from '../../models/Usage.js';
import { AiCallModel } from '../../models/AiCall.js';
import { parseAiPrices } from '../../config/aiPrices.js';
import { asPaidPlan } from '../billing/plans.js';

/**
 * The owner's metrics (GET /api/admin/metrics). Everything here is an aggregate: no email, user id, IP or content ever
 * leaves this module. The windows are whole UTC days, today included, so the first and last bucket are comparable with
 * the rest and a chart needs no cleaning.
 *
 * Money figures are ESTIMATES from the published catalogue (PLAN_PRICE_USD) and from the owner's AI_PRICES_JSON, not
 * accounting: Stripe is the authority for revenue and the providers' invoices for cost.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Same data, same answer: a dashboard refreshed by hand or by two tabs must not rerun the aggregations. */
export const METRICS_CACHE_TTL_MS = 60_000;

const SCOPES: readonly AdminAiScope[] = ['users', 'demo', 'byok'];

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

/** The `days` UTC days ending today, oldest first, and the instant the first one starts. */
function windowOf(days: number, now: Date): { start: Date; keys: string[] } {
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startMs = todayStart - (days - 1) * DAY_MS;
  const keys = Array.from({ length: days }, (_, i) => dayKey(new Date(startMs + i * DAY_MS)));
  return { start: new Date(startMs), keys };
}

const round = (value: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

const mongoDay = (field: string) => ({
  $dateToString: { format: '%Y-%m-%d', date: field, timezone: 'UTC' },
});

const isVerified = { $cond: [{ $ifNull: ['$emailVerifiedAt', false] }, true, false] };

interface AccountGroup {
  _id: {
    plan: string;
    status: string;
    interval: string | null;
    verified: boolean;
    inGrace: boolean;
  };
  n: number;
}

/**
 * All the accounts, grouped by the few fields that decide what they are worth (a handful of groups whatever the
 * number of users), then interpreted here with the same rules as billing/plans.ts effectivePlan.
 */
async function accounts(now: Date) {
  const graceCutoff = new Date(now.getTime() - PAST_DUE_GRACE_DAYS * DAY_MS);
  const rows = await UserModel.aggregate<AccountGroup>([
    {
      $group: {
        _id: {
          plan: { $ifNull: ['$plan', 'free'] },
          status: { $ifNull: ['$billingStatus', 'active'] },
          interval: { $ifNull: ['$billingInterval', null] },
          verified: isVerified,
          inGrace: { $cond: [{ $gt: ['$pastDueSince', graceCutoff] }, true, false] },
        },
        n: { $sum: 1 },
      },
    },
  ]);

  const byPlan = Object.fromEntries(PLANS.map((p) => [p, 0])) as Record<Plan, number>;
  const paying: Record<PaidPlan, number> = { starter: 0, pro: 0, team: 0 };
  let total = 0;
  let verified = 0;
  let mrr = 0;
  for (const { _id: g, n } of rows) {
    total += n;
    if (g.verified) verified += n;
    const paid = asPaidPlan(g.plan);
    // The plan that applies today (billing/plans.ts effectivePlan): a past_due account keeps it only inside the grace
    const applies = g.status === 'active' || (g.status === 'past_due' && g.inGrace);
    byPlan[applies && paid ? paid : 'free'] += n;
    // Revenue: only accounts being billed normally. past_due is not collected yet and canceled never will be.
    if (g.status === 'active' && paid) {
      paying[paid] += n;
      // Annual = price / 12. An unknown interval (accounts from before it was stored) is billed as monthly.
      const monthly =
        g.interval === 'year' ? PLAN_PRICE_USD[paid].annual / 12 : PLAN_PRICE_USD[paid].monthly;
      mrr += monthly * n;
    }
  }
  return { total, verified, byPlan, paying, mrrUsdEstimate: round(mrr, 2) };
}

/** The accounts registered inside the window: per day, and how far each got (each step needs the previous one). */
async function cohort(start: Date, now: Date, keys: string[]) {
  const [res] = await UserModel.aggregate<{
    perDay: { _id: string; n: number }[];
    funnel: {
      registered: number;
      verified: number;
      withProject: number;
      withAiGeneration: number;
    }[];
  }>([
    // createdAt is indexed: the lookups below only ever run for the accounts of the window
    { $match: { createdAt: { $gte: start, $lte: now } } },
    {
      $facet: {
        perDay: [{ $group: { _id: mongoDay('$createdAt'), n: { $sum: 1 } } }],
        funnel: [
          { $project: { verified: isVerified } },
          {
            $lookup: {
              from: ProjectModel.collection.name,
              localField: '_id',
              foreignField: 'ownerId',
              as: 'projects',
            },
          },
          {
            $lookup: {
              from: UsageModel.collection.name,
              localField: '_id',
              foreignField: 'ownerId',
              as: 'usage',
            },
          },
          {
            $project: {
              verified: 1,
              hasProject: { $gt: [{ $size: '$projects' }, 0] },
              hasAi: {
                $anyElementTrue: {
                  $map: { input: '$usage', as: 'u', in: { $gt: ['$$u.aiGenerations', 0] } },
                },
              },
            },
          },
          {
            $group: {
              _id: null,
              registered: { $sum: 1 },
              verified: { $sum: { $cond: ['$verified', 1, 0] } },
              withProject: { $sum: { $cond: [{ $and: ['$verified', '$hasProject'] }, 1, 0] } },
              withAiGeneration: {
                $sum: { $cond: [{ $and: ['$verified', '$hasProject', '$hasAi'] }, 1, 0] },
              },
            },
          },
        ],
      },
    },
  ]);
  const perDay = new Map((res?.perDay ?? []).map((r) => [r._id, r.n]));
  const f = res?.funnel?.[0];
  return {
    newPerDay: keys.map((day) => ({ day, count: perDay.get(day) ?? 0 })),
    funnel: {
      registered: f?.registered ?? 0,
      verified: f?.verified ?? 0,
      withProject: f?.withProject ?? 0,
      withAiGeneration: f?.withAiGeneration ?? 0,
    },
  };
}

interface AiGroup {
  _id: { day: string; scope: AdminAiScope; provider: string; model: string; ok: boolean };
  calls: number;
  input: number;
  output: number;
}

async function aiCalls(start: Date, now: Date, keys: string[]) {
  const rows = await AiCallModel.aggregate<AiGroup>([
    { $match: { at: { $gte: start, $lte: now } } },
    {
      $group: {
        _id: {
          day: mongoDay('$at'),
          scope: '$scope',
          provider: '$provider',
          model: '$model',
          ok: { $eq: ['$outcome', 'ok'] },
        },
        calls: { $sum: 1 },
        input: { $sum: '$inputTokens' },
        output: { $sum: '$outputTokens' },
      },
    },
  ]);

  const table = parseAiPrices();
  if (table.status === 'invalid') {
    // Never the value: the variable may have been pasted with something it should not have
    console.warn(
      '[Metrics] AI_PRICES_JSON is not valid and is ignored; the cost estimate is disabled'
    );
  }
  const prices = table.status === 'ok' ? table.prices : null;

  const perDay = new Map(
    keys.map((day) => [
      day,
      {
        day,
        calls: 0,
        errors: 0,
        byScope: { users: 0, demo: 0, byok: 0 } as Record<AdminAiScope, number>,
      },
    ])
  );
  const demo = new Map(keys.map((day) => [day, 0]));
  const tokens = { input: 0, output: 0 };
  let calls = 0;
  let errors = 0;
  let cost = 0;
  const unpriced = new Set<string>();

  for (const { _id: g, calls: n, input, output } of rows) {
    const bucket = perDay.get(g.day);
    if (!bucket) continue;
    bucket.calls += n;
    if (!g.ok) bucket.errors += n;
    if (SCOPES.includes(g.scope)) bucket.byScope[g.scope] += n;
    if (g.scope === 'demo') demo.set(g.day, (demo.get(g.day) ?? 0) + n);
    calls += n;
    if (!g.ok) errors += n;
    tokens.input += input;
    tokens.output += output;

    // The owner pays for the platform's own AI (users, demo); a BYOK call is paid by the user with their own key
    if (!prices || g.scope === 'byok') continue;
    const price = prices.get(`${g.provider}/${g.model}`);
    if (price) cost += (input * price.inputPerMTok + output * price.outputPerMTok) / 1_000_000;
    else unpriced.add(`${g.provider}/${g.model}`);
  }

  return {
    ai: {
      perDay: keys.map((day) => perDay.get(day)!),
      tokens,
      errorRatio: calls > 0 ? round(errors / calls, 4) : 0,
      estimatedCostUsd: prices ? round(cost, 6) : null,
      unpriced: [...unpriced].sort(),
    },
    demo: { generationsPerDay: keys.map((day) => ({ day, count: demo.get(day) ?? 0 })) },
  };
}

async function compute(days: number, now: Date): Promise<AdminMetrics> {
  const { start, keys } = windowOf(days, now);
  const [acc, coh, ai] = await Promise.all([
    accounts(now),
    cohort(start, now, keys),
    aiCalls(start, now, keys),
  ]);
  return {
    generatedAt: now.toISOString(),
    days,
    users: {
      total: acc.total,
      verified: acc.verified,
      byPlan: acc.byPlan,
      newPerDay: coh.newPerDay,
    },
    funnel: coh.funnel,
    billing: { paying: acc.paying, mrrUsdEstimate: acc.mrrUsdEstimate },
    ai: ai.ai,
    demo: ai.demo,
  };
}

// One entry per window at most (7, 30, 90): the cache cannot grow. The promise is stored, so concurrent requests
// share one computation instead of each running the aggregations.
const cache = new Map<number, { at: number; value: Promise<AdminMetrics> }>();

export function resetAdminMetricsCache(): void {
  cache.clear();
}

export const isMetricsWindow = (days: number): boolean =>
  (ADMIN_METRICS_DAYS as readonly number[]).includes(days);

/** The metrics of the last `days` days (7, 30 or 90), from a 60 s cache. */
export function getAdminMetrics(days: number, now: Date = new Date()): Promise<AdminMetrics> {
  if (!isMetricsWindow(days)) return Promise.reject(new RangeError('days must be 7, 30 or 90'));
  const hit = cache.get(days);
  if (hit && Math.abs(now.getTime() - hit.at) < METRICS_CACHE_TTL_MS) return hit.value;
  const value = compute(days, now);
  const entry = { at: now.getTime(), value };
  cache.set(days, entry);
  // A failure is not cached: the next request tries again
  value.catch(() => {
    if (cache.get(days) === entry) cache.delete(days);
  });
  return value;
}
