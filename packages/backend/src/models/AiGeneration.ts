import { Schema, model, Types } from 'mongoose';

/**
 * One AI generation (prompts as sent + raw model output) kept ONLY for users who gave explicit consent to use their
 * generations to improve Mockia's AI (User.aiTrainingConsent). Without consent nothing of the content is persisted.
 *
 * It is personal data: it can quote fragments of the user's repository. It is deleted when the consent is withdrawn,
 * when the account is deleted, and by the TTL index on `expiresAt` (AI_GENERATION_RETENTION_DAYS, default 180).
 * Never log any of these fields.
 */
interface AiGenerationDocument {
  /** Random UUID handed to the client with the generation; the client sends it back with its feedback. */
  generationId: string;
  userId: Types.ObjectId;
  /** System and user messages exactly as they were sent to the model. */
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  /** The model's raw text answer. */
  output: string;
  /** The answer parsed and passed the production validator. */
  parsedOk: boolean;
  provider: string;
  model: string;
  createdAt: Date;
  /** TTL: the document is removed by MongoDB at this moment. */
  expiresAt: Date;
}

const aiGenerationSchema = new Schema<AiGenerationDocument>(
  {
    generationId: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    messages: {
      type: [
        new Schema(
          {
            role: { type: String, enum: ['system', 'user', 'assistant'], required: true },
            content: { type: String, required: true },
          },
          { _id: false }
        ),
      ],
      required: true,
    },
    output: { type: String, required: true },
    parsedOk: { type: Boolean, required: true },
    provider: { type: String, required: true },
    model: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

aiGenerationSchema.index({ generationId: 1 }, { unique: true });
aiGenerationSchema.index({ userId: 1 });
aiGenerationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AiGenerationModel = model<AiGenerationDocument>('AiGeneration', aiGenerationSchema);

export type { AiGenerationDocument };
