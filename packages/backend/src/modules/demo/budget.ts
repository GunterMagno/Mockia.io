import { DemoBudgetModel } from '../../models/DemoBudget.js';
import { getDemoConfig } from './config.js';
import { utcDay } from './ipHash.js';

/**
 * Spending limits of the public demo, all enforced by the server.
 *
 * Daily counters: one conditional $inc on DemoBudget (UTC day, scope, key, kind). The filter `count: {$not: {$gte: limit}}`
 * plus the unique index make the check-and-increment a single atomic operation: when the counter is at its limit the
 * upsert tries to insert a duplicate and fails with E11000, which is the refusal signal. Concurrent callers therefore
 * can never exceed the limit, whatever the number of processes.
 *
 * Concurrency: how many generations run at once is held in memory, per process (documented limit: with N instances
 * the effective cap is N times the configured one; the daily counters above remain exact).
 */

const RETENTION_MS = 48 * 60 * 60 * 1000;
const MAX_RETRIES = 5;

export type BudgetKind = 'generation' | 'mockRequest';
export type BudgetResult = { ok: true } | { ok: false; scope: 'ip' | 'global' };

/** Adds 1 to a counter unless it is already at `limit`. Returns whether it was added. */
async function increment(day: string, scope: 'ip' | 'global', key: string, kind: BudgetKind, limit: number): Promise<boolean> {
  if (limit <= 0) return false;
  const identity = { day, scope, key, kind };
  const expiresAt = new Date(Date.parse(`${day}T00:00:00Z`) + RETENTION_MS + 24 * 60 * 60 * 1000);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await DemoBudgetModel.findOneAndUpdate(
        { ...identity, count: { $not: { $gte: limit } } },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
        { upsert: true, new: true },
      );
      return true;
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      // Duplicate: either the counter is at its limit (refuse) or two first calls raced to create it (retry)
      const row = await DemoBudgetModel.findOne(identity).lean();
      if (row && row.count >= limit) return false;
    }
  }
  return false;
}

/** Takes one unit back from a counter, never below zero (a single conditional $inc: atomic). */
async function decrement(day: string, scope: 'ip' | 'global', key: string, kind: BudgetKind): Promise<void> {
  await DemoBudgetModel.updateOne({ day, scope, key, kind, count: { $gt: 0 } }, { $inc: { count: -1 } }).catch(() => undefined);
}

/** Takes the visitor's unit back (a refused global slot must not leave the visitor charged). */
const refund = (day: string, key: string, kind: BudgetKind): Promise<void> => decrement(day, 'ip', key, kind);

/**
 * Spends one unit of the visitor's daily allowance and, for generations, of the demo's global one. The visitor's own
 * limit is checked first so a single address cannot drain the global budget; if the global one is exhausted the
 * visitor's unit is given back.
 */
export async function tryConsumeDemoBudget(ipHash: string, kind: BudgetKind, now: Date = new Date()): Promise<BudgetResult> {
  const cfg = getDemoConfig();
  const day = utcDay(now);
  const perIp = kind === 'generation' ? cfg.perIpGenerationsPerDay : cfg.ipMockRequestsPerDay;

  if (!(await increment(day, 'ip', ipHash, kind, perIp))) return { ok: false, scope: 'ip' };
  if (kind === 'generation' && !(await increment(day, 'global', 'global', kind, cfg.dailyGenerations))) {
    await refund(day, ipHash, kind);
    return { ok: false, scope: 'global' };
  }
  return { ok: true };
}

/**
 * Gives back ONE unit that tryConsumeDemoBudget took, on the same UTC day it was taken (pass the same `now`): the
 * visitor's and, for generations, the demo's global one. Each counter goes down with one conditional $inc, so it can
 * never go below zero; the caller must call it at most once per successful consume (the service guards that).
 *
 * Only for work that never reached the model: a refund after the model answered would turn failures into free calls.
 */
export async function refundDemoBudget(ipHash: string, kind: BudgetKind, now: Date = new Date()): Promise<void> {
  const day = utcDay(now);
  await decrement(day, 'ip', ipHash, kind);
  if (kind === 'generation') await decrement(day, 'global', 'global', kind);
}

/**
 * Generations left today (the visitor's and the demo's), read-only. Callers decide what to reveal: the status route
 * only ever tells a visitor their own number and whether the demo has anything left, never the global counters.
 */
export async function peekDemoBudget(ipHash: string, now: Date = new Date()): Promise<{ ipLeft: number; globalLeft: number }> {
  const cfg = getDemoConfig();
  const day = utcDay(now);
  const [ip, global] = await Promise.all([
    DemoBudgetModel.findOne({ day, scope: 'ip', key: ipHash, kind: 'generation' }).lean(),
    DemoBudgetModel.findOne({ day, scope: 'global', key: 'global', kind: 'generation' }).lean(),
  ]);
  return {
    ipLeft: Math.max(0, cfg.perIpGenerationsPerDay - (ip?.count ?? 0)),
    globalLeft: Math.max(0, cfg.dailyGenerations - (global?.count ?? 0)),
  };
}

/** Whether the demo as a whole still has generations left today (global counter only, read-only, no visitor involved). */
export async function peekGlobalDemoBudget(now: Date = new Date()): Promise<number> {
  const global = await DemoBudgetModel.findOne({ day: utcDay(now), scope: 'global', key: 'global', kind: 'generation' }).lean();
  return Math.max(0, getDemoConfig().dailyGenerations - (global?.count ?? 0));
}

const running = new Map<string, number>();
let runningTotal = 0;

/** Reserves a generation slot for this visitor, or returns null when the visitor or the whole demo is at capacity. */
export function acquireGenerationSlot(ipHash: string): (() => void) | null {
  const cfg = getDemoConfig();
  if (runningTotal >= cfg.maxConcurrent) return null;
  if ((running.get(ipHash) ?? 0) >= cfg.maxConcurrentPerIp) return null;
  running.set(ipHash, (running.get(ipHash) ?? 0) + 1);
  runningTotal++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    runningTotal--;
    const left = (running.get(ipHash) ?? 1) - 1;
    if (left <= 0) running.delete(ipHash);
    else running.set(ipHash, left);
  };
}
