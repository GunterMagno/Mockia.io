/**
 * Light in-memory flood limiter of the demo mock router: fixed window per key, no I/O. It exists because the
 * per-visitor daily budget only counts requests that are SERVED; unknown ids, OPTIONS and exhausted mocks would
 * otherwise cost a Mongo query (or at least CPU) each, for free. Keys are pseudonyms, never addresses.
 *
 * State lives in one process (like the generation concurrency cap): with N instances the effective limit is N times
 * higher, which is fine for a flood guard - the exact limits are the atomic counters in Mongo.
 * The map is bounded: when it reaches `maxKeys`, expired windows are dropped first and, if it is still full, the
 * oldest key is evicted (its visitor just gets a fresh window), so an attacker cannot grow memory.
 */

export interface FloodLimiterOptions {
  windowMs: number;
  /** Requests allowed per key and window. */
  max: number;
  /** Hard cap on tracked keys. */
  maxKeys: number;
  now: () => number;
}

export interface FloodVerdict {
  ok: boolean;
  /** Seconds until the key's window ends (only meaningful when refused). */
  retryAfterSeconds: number;
}

export function createFloodLimiter(opts: FloodLimiterOptions) {
  const windows = new Map<string, { start: number; count: number }>();

  const dropExpired = (t: number) => {
    for (const [key, w] of windows) if (t - w.start >= opts.windowMs) windows.delete(key);
  };

  return {
    hit(key: string): FloodVerdict {
      const t = opts.now();
      let w = windows.get(key);
      if (w && t - w.start >= opts.windowMs) {
        windows.delete(key);
        w = undefined;
      }
      if (!w) {
        if (windows.size >= opts.maxKeys) {
          dropExpired(t);
          // Map iterates in insertion order: the first key is the oldest window
          while (windows.size >= opts.maxKeys) windows.delete(windows.keys().next().value as string);
        }
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      if (w.count >= opts.max) {
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((w.start + opts.windowMs - t) / 1000)) };
      }
      w.count++;
      return { ok: true, retryAfterSeconds: 0 };
    },
    size: () => windows.size,
    clear: () => windows.clear(),
  };
}
