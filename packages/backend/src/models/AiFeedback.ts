import { Schema, model, Types } from 'mongoose';

/**
 * Thumbs up / down on a generation. Accepted from every user, but it carries NO content unless the user consented and
 * the generation was stored: then `correctedOutput` (the spec the user wanted, already passed through the production
 * validator) is kept too. `provider`/`model` come from the stored generation, never from the client (null otherwise).
 *
 * One row per (userId, generationId): later feedback replaces the earlier one. Deleted when the consent is withdrawn,
 * when the account is deleted, and by the TTL index on `expiresAt`.
 */
interface AiFeedbackDocument {
  userId: Types.ObjectId;
  generationId: string;
  verdict: 'good' | 'bad';
  provider: string | null;
  model: string | null;
  /** Only with consent and a stored generation of the same user. */
  correctedOutput?: unknown;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

const aiFeedbackSchema = new Schema<AiFeedbackDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    generationId: { type: String, required: true },
    verdict: { type: String, enum: ['good', 'bad'], required: true },
    provider: { type: String, default: null },
    model: { type: String, default: null },
    correctedOutput: { type: Schema.Types.Mixed },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, minimize: false }
);

aiFeedbackSchema.index({ userId: 1, generationId: 1 }, { unique: true });
aiFeedbackSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AiFeedbackModel = model<AiFeedbackDocument>('AiFeedback', aiFeedbackSchema);

export type { AiFeedbackDocument };
