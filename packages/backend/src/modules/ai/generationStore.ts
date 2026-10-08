import crypto from 'crypto';
import { Types } from 'mongoose';
import { AiGenerationModel } from '../../models/AiGeneration.js';
import { getAiGenerationRetentionDays } from '../../config/ai.js';
import { describeError } from '../../utils/safeErrorLog.js';
import { hasAiTrainingConsent } from './consent.js';
import type { ChatMessage } from './providers/types.js';

/** A fresh random id for one generation; it is handed to the client whether or not the content gets stored. */
export function newGenerationId(): string {
  return crypto.randomUUID();
}

export interface GenerationToStore {
  generationId: string;
  userId: string;
  /** The messages exactly as sent to the model. */
  messages: ChatMessage[];
  /** The model's raw text answer. */
  output: string;
  parsedOk: boolean;
  provider: string;
  model: string;
}

/**
 * Stores a generation ONLY when the user's consent is granted right now. Without consent nothing about the content is
 * written. Best effort: a failure here must never break the generation the user already paid for, so errors are logged
 * by class only (never the content) and swallowed. Returns whether the content was stored.
 *
 * Race with a withdrawal: the consent is checked before the write and once more after it; if the user withdrew in
 * between, the document just written is removed again (the withdrawal flips the flag before it erases).
 */
export async function persistGeneration(g: GenerationToStore): Promise<boolean> {
  try {
    if (!(await hasAiTrainingConsent(g.userId))) return false;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + getAiGenerationRetentionDays() * 86_400_000);
    await AiGenerationModel.create({
      generationId: g.generationId,
      userId: new Types.ObjectId(g.userId),
      messages: g.messages.map((m) => ({ role: m.role, content: m.content })),
      output: g.output,
      parsedOk: g.parsedOk,
      provider: g.provider,
      model: g.model,
      createdAt,
      expiresAt,
    });
    if (!(await hasAiTrainingConsent(g.userId))) {
      await AiGenerationModel.deleteOne({ generationId: g.generationId });
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`[AI] Could not store a consented generation (${describeError(error)})`);
    return false;
  }
}
