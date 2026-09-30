import { Schema, model, Document, Types } from 'mongoose';

/**
 * Monthly usage counter per project owner (billing quota).
 * One document per owner and UTC month ('YYYY-MM'); `requests` only grows through $inc.
 */
interface UsageDocument extends Document {
  ownerId: Types.ObjectId;
  period: string;
  requests: number;
  createdAt: Date;
  updatedAt: Date;
}

const usageSchema = new Schema<UsageDocument>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    requests: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true }
);

usageSchema.index({ ownerId: 1, period: 1 }, { unique: true });

export const UsageModel = model<UsageDocument>('Usage', usageSchema);

export type { UsageDocument };
