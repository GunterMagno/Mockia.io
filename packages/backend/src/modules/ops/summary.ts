import { getConnectionStatus } from '../../config/connection.js';
import { AiCallModel } from '../../models/AiCall.js';
import { DemoBudgetModel } from '../../models/DemoBudget.js';
import { getLlmStatus, type LlmStatusEntry } from '../ai/providers/index.js';
import { getDemoConfig } from '../demo/config.js';
import { pseudonymizeIp, utcDay } from '../demo/ipHash.js';

/**
 * The operations summary the owner's monitors read (GET /api/ops/summary). It carries counts, ratios and the names of
 * AI providers: no email, user id, IP, project, prompt or key. The one value derived from a request is the caller's own
 * daily IP pseudonym (see `callerPseudonym`).
 */

export const LAST_WINDOW_MS = 60 * 60 * 1000;

export interface OpsSummary {
  generatedAt: string;
  db: { ok: boolean };
  demo: { enabled: boolean; generationsToday: number; dailyLimit: number; usedRatio: number };
  ai: {
    last60m: {
      calls: number;
      /** Calls whose outcome is not 'ok': invalid, truncated, timeout, refused and error all count. */
      errors: number;
      errorRatio: number;
      byScope: Record<string, { calls: number; errors: number }>;
    };
    breakers: Record<string, LlmStatusEntry>;
  };
  caller: { pseudonym: string | null };
}

/** 4 decimals: enough for thresholds like 0.5 or 0.8, and stable to compare. */
const ratio = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : 0;

/**
 * The caller's pseudonym for today (HMAC of the UTC day and the address seen by the server, the same function the demo's
 * limits use), or null when DEMO_HMAC_SECRET is not set. Comparing the pseudonyms of two requests sent from outside with
 * different X-Forwarded-For values tells whether that header can be forged, i.e. whether TRUST_PROXY is too high.
 */
export function callerPseudonym(ip: string | undefined, env: NodeJS.ProcessEnv = process.env) {
  if (!ip || !(env.DEMO_HMAC_SECRET ?? '').trim()) return null;
  return pseudonymizeIp(ip);
}

async function aiLast60m(now: Date): Promise<OpsSummary['ai']['last60m']> {
  const rows = await AiCallModel.aggregate<{
    _id: { scope: string; ok: boolean };
    n: number;
  }>([
    { $match: { at: { $gte: new Date(now.getTime() - LAST_WINDOW_MS), $lte: now } } },
    { $group: { _id: { scope: '$scope', ok: { $eq: ['$outcome', 'ok'] } }, n: { $sum: 1 } } },
  ]);
  const byScope: Record<string, { calls: number; errors: number }> = {};
  let calls = 0;
  let errors = 0;
  for (const { _id, n } of rows) {
    const entry = (byScope[_id.scope] ??= { calls: 0, errors: 0 });
    entry.calls += n;
    calls += n;
    if (!_id.ok) {
      entry.errors += n;
      errors += n;
    }
  }
  return { calls, errors, errorRatio: ratio(errors, calls), byScope };
}

async function demoToday(now: Date): Promise<OpsSummary['demo']> {
  const cfg = getDemoConfig();
  const row = await DemoBudgetModel.findOne({
    day: utcDay(now),
    scope: 'global',
    key: 'global',
    kind: 'generation',
  }).lean();
  const generationsToday = row?.count ?? 0;
  return {
    enabled: cfg.enabled,
    generationsToday,
    dailyLimit: cfg.dailyGenerations,
    usedRatio: Math.min(1, ratio(generationsToday, cfg.dailyGenerations)),
  };
}

/**
 * Builds the summary. When the database cannot be read, `db.ok` is false and the figures that live in it are zero: the
 * monitor reads `db.ok` first, and a missing figure must not look like an alarm of its own.
 */
export async function buildOpsSummary(
  ip: string | undefined,
  now: Date = new Date()
): Promise<OpsSummary> {
  const empty: Pick<OpsSummary, 'demo' | 'ai'> = {
    demo: {
      enabled: getDemoConfig().enabled,
      generationsToday: 0,
      dailyLimit: getDemoConfig().dailyGenerations,
      usedRatio: 0,
    },
    ai: {
      last60m: { calls: 0, errors: 0, errorRatio: 0, byScope: {} },
      breakers: getLlmStatus(),
    },
  };
  let dbOk = getConnectionStatus().isConnected;
  let { demo, ai } = empty;
  if (dbOk) {
    try {
      const [d, last60m] = await Promise.all([demoToday(now), aiLast60m(now)]);
      demo = d;
      ai = { last60m, breakers: getLlmStatus() };
    } catch {
      dbOk = false;
    }
  }
  return {
    generatedAt: now.toISOString(),
    db: { ok: dbOk },
    demo,
    ai,
    caller: { pseudonym: callerPseudonym(ip) },
  };
}
