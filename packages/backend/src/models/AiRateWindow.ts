import { Schema, model, Types } from 'mongoose';

/**
 * Per-user AI call counter for one fixed one-minute window (see modules/ai/aiRateLimit.ts).
 * One document per (user, minute bucket); `count` only grows through an atomic $inc, and a TTL index removes the
 * buckets a couple of minutes after they end, so the collection stays tiny.
 */
interface AiRateWindowDocument {
  userId: Types.ObjectId;
  windowStart: Date;
  count: number;
  expireAt: Date;
}

const aiRateWindowSchema = new Schema<AiRateWindowDocument>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  windowStart: { type: Date, required: true },
  count: { type: Number, required: true, default: 0, min: 0 },
  expireAt: { type: Date, required: true },
});

aiRateWindowSchema.index({ userId: 1, windowStart: 1 }, { unique: true });
aiRateWindowSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const AiRateWindowModel = model<AiRateWindowDocument>('AiRateWindow', aiRateWindowSchema);

export type { AiRateWindowDocument };
