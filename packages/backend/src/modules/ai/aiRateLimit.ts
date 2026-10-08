/**
 * Per-user limiter for AI generation calls, backed by Mongo so it survives restarts and is shared by every instance.
 *
 * Fixed one-minute windows: each (user, minute) is one document bumped with an atomic upsert + $inc, so concurrent
 * requests are counted exactly and users never share a bucket. (A fixed window lets a user burst up to twice the limit
 * across a minute boundary; that is acceptable for a cost guard and keeps it to one round trip.)
 */

import { Types } from 'mongoose';
import { AiRateWindowModel } from '../../models/AiRateWindow.js';
import { getAiRatePerMinute } from '../../config/ai.js';

export const AI_RATE_WINDOW_MS = 60_000;

export interface AiQuotaResult {
  allowed: boolean;
  /** Calls made in the current window, this one included (also when it was rejected). */
  count: number;
  limit: number;
  /** Whole seconds until the window ends (value for the Retry-After header). */
  retryAfterSeconds: number;
}

const DUPLICATE_KEY = 11000;

export async function consumeAiQuota(
  userId: string,
  options: { limit?: number; now?: () => number } = {}
): Promise<AiQuotaResult> {
  const limit = options.limit ?? getAiRatePerMinute();
  const nowMs = (options.now ?? Date.now)();
  const start = Math.floor(nowMs / AI_RATE_WINDOW_MS) * AI_RATE_WINDOW_MS;
  const filter = { userId: new Types.ObjectId(userId), windowStart: new Date(start) };
  const update = {
    $inc: { count: 1 },
    $setOnInsert: { expireAt: new Date(start + 3 * AI_RATE_WINDOW_MS) },
  };

  // Make sure the unique (userId, windowStart) index exists before racing upserts against each other.
  await AiRateWindowModel.init();

  let doc;
  for (let attempt = 0; ; attempt++) {
    try {
      doc = await AiRateWindowModel.findOneAndUpdate(filter, update, { upsert: true, new: true }).lean();
      break;
    } catch (err) {
      // Two first calls of the window raced to insert the bucket: the loser retries as a plain $inc.
      if ((err as { code?: number }).code === DUPLICATE_KEY && attempt < 3) continue;
      throw err;
    }
  }

  const count = doc?.count ?? 1;
  return {
    allowed: count <= limit,
    count,
    limit,
    retryAfterSeconds: Math.max(1, Math.ceil((start + AI_RATE_WINDOW_MS - nowMs) / 1000)),
  };
}
