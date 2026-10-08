import { UsageModel } from '../../models/Usage.js';

/**
 * Monthly mock-request meter per project owner, persisted in Mongo (collection `usages`).
 *
 * The hot path (every public mock call) never waits on a write: increments accumulate in memory and a
 * timer flushes them with $inc every FLUSH_MS. The persisted total is re-read at most every SYNC_MS per
 * owner, so several instances converge on the shared count and a restart no longer resets the quota.
 *
 * ponytail: with N instances an owner can overshoot the limit by what the other instances served since
 * their last flush/sync (seconds of traffic). Fine for a commercial soft limit; use a single atomic
 * counter (Redis INCR / findOneAndUpdate with $lt) if it ever has to be exact.
 */

const SYNC_MS = 30_000;
const FLUSH_MS = 5_000;

/** Billing period key: UTC month 'YYYY-MM'. */
export const periodOf = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** First instant of the next UTC month: when the monthly counter starts again. */
export const nextPeriodStart = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));

interface Entry {
  ownerId: string;
  period: string;
  /** Last total read from / confirmed by Mongo. */
  persisted: number;
  /** Increments being written right now. */
  inFlight: number;
  /** Increments not yet written. */
  pending: number;
  syncedAt: number;
  /** Bumped by every confirmed flush, so a slower concurrent read cannot overwrite a newer total. */
  version: number;
  loading?: Promise<void>;
}

const entries = new Map<string, Entry>();
let flushTimer: NodeJS.Timeout | null = null;
let flushing: Promise<void> | null = null;

const keyOf = (ownerId: string, period: string) => `${ownerId}:${period}`;

async function load(entry: Entry, nowMs: number): Promise<void> {
  const version = entry.version;
  try {
    const doc = await UsageModel.findOne({ ownerId: entry.ownerId, period: entry.period }).select('requests').lean();
    if (entry.version === version) entry.persisted = doc?.requests ?? 0;
  } catch (err) {
    // Fail open: keep counting in memory with the last known total.
    console.error('[Usage] could not read usage, using the local count:', err);
  }
  entry.syncedAt = nowMs;
}

async function entryFor(ownerId: string, period: string, nowMs: number): Promise<Entry> {
  const key = keyOf(ownerId, period);
  let entry = entries.get(key);
  if (!entry) {
    entry = { ownerId, period, persisted: 0, inFlight: 0, pending: 0, syncedAt: 0, version: 0 };
    entries.set(key, entry);
  }
  if (nowMs - entry.syncedAt >= SYNC_MS) {
    const current = entry;
    current.loading ??= load(current, nowMs).finally(() => {
      current.loading = undefined;
    });
    await current.loading;
  }
  return entry;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushUsage();
  }, FLUSH_MS);
  flushTimer.unref();
}

/** Requests counted so far this period (persisted + in flight + pending), without consuming anything. */
export async function peekQuota(
  ownerId: string,
  limit: number,
  now = new Date()
): Promise<{ allowed: boolean; used: number }> {
  const entry = await entryFor(ownerId, periodOf(now), now.getTime());
  const used = entry.persisted + entry.inFlight + entry.pending;
  return { allowed: used < limit, used };
}

/** Counts one served request for `ownerId`; returns the new total of the period. Never touches Mongo itself. */
export function recordRequest(ownerId: string, now = new Date()): number {
  const period = periodOf(now);
  const key = keyOf(ownerId, period);
  let entry = entries.get(key);
  if (!entry) {
    entry = { ownerId, period, persisted: 0, inFlight: 0, pending: 0, syncedAt: 0, version: 0 };
    entries.set(key, entry);
  }
  entry.pending += 1;
  scheduleFlush();
  return entry.persisted + entry.inFlight + entry.pending;
}

/**
 * Consumes one request for `ownerId` if the owner is under `limit` this month.
 * Rejected requests are not counted.
 */
export async function consumeQuota(
  ownerId: string,
  limit: number,
  now = new Date()
): Promise<{ allowed: boolean; used: number }> {
  const { allowed, used } = await peekQuota(ownerId, limit, now);
  if (!allowed) return { allowed, used };
  return { allowed, used: recordRequest(ownerId, now) };
}

/** Requests counted this month for `ownerId` (persisted total plus what this process has not written yet). */
export async function getMonthlyUsage(ownerId: string, now = new Date()): Promise<number> {
  const period = periodOf(now);
  const doc = await UsageModel.findOne({ ownerId, period }).select('requests').lean();
  const local = entries.get(keyOf(ownerId, period));
  return (doc?.requests ?? 0) + (local ? local.pending : 0);
}

/** Writes pending increments to Mongo. Safe to call at any time (e.g. on shutdown); calls do not overlap. */
export function flushUsage(): Promise<void> {
  flushing ??= (async () => {
    const current = periodOf(new Date());
    for (const [key, entry] of entries) {
      if (entry.pending > 0 && entry.inFlight === 0) {
        const amount = entry.pending;
        entry.pending = 0;
        entry.inFlight = amount;
        try {
          const doc = await UsageModel.findOneAndUpdate(
            { ownerId: entry.ownerId, period: entry.period },
            { $inc: { requests: amount } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          )
            .select('requests')
            .lean();
          entry.persisted = doc?.requests ?? entry.persisted + amount;
          entry.version += 1;
          entry.syncedAt = Date.now();
        } catch (err) {
          entry.pending += amount; // retried on the next flush
          console.error('[Usage] flush failed, will retry:', err);
        } finally {
          entry.inFlight = 0;
        }
      }
      // Old months with nothing left to write are dropped so the map stays bounded.
      if (entry.period !== current && entry.pending === 0 && entry.inFlight === 0) entries.delete(key);
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/**
 * Drops every in-memory counter of an owner (account deletion): pending increments are discarded, and a flush that is
 * already writing is awaited, so nothing recreates a Usage row after the caller deletes the owner's rows.
 */
export async function forgetOwnerUsage(ownerId: string): Promise<void> {
  const drop = () => {
    for (const [key, entry] of entries) if (entry.ownerId === ownerId) entries.delete(key);
  };
  drop();
  if (flushing) await flushing.catch(() => undefined);
  drop();
}

/** Test helper: forget local state and stop the flush timer. */
export function resetUsage(): void {
  entries.clear();
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
}
