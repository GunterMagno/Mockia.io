import { Types } from 'mongoose';
import { ErrorCode } from '@mockia/shared';
import { AppError } from '../../middlewares/errorHandler.js';
import { AiGenerationModel } from '../../models/AiGeneration.js';
import { AiFeedbackModel } from '../../models/AiFeedback.js';
import { getAiGenerationRetentionDays } from '../../config/ai.js';
import { validateGeneratedApi } from './llmOutputValidator.js';
import { hasAiTrainingConsent } from './consent.js';

export type FeedbackVerdict = 'good' | 'bad';

/**
 * Records a thumbs up/down on a generation.
 *
 *  - Without consent (RULING R14): NOTHING is persisted, not even the verdict. The caller gets the same success answer
 *    (the route already validated the request), so the UI behaves identically; votes are only kept for users who opted in.
 *  - With consent but no stored generation (it was generated before they consented): only `{ userId, generationId,
 *    verdict, provider: null, model: null }`; the correction is dropped. Provider and model never come from the client.
 *  - With consent and a stored generation of the SAME user: also links it (provider/model copied from the stored
 *    generation) and keeps `correctedOutput`, after running it through the production validator (invalid -> 400, nothing
 *    changes).
 *  - A generation that exists but belongs to someone else -> 404 and nothing is stored or revealed.
 *  - Idempotent per (user, generation): the later feedback replaces the earlier one entirely (a correction given before
 *    disappears if the new feedback has none).
 *
 * @throws AppError 404 foreign generation, 400 invalid correction
 */
export async function recordFeedback(
  userId: string,
  generationId: string,
  verdict: FeedbackVerdict,
  correctedOutput?: unknown
): Promise<void> {
  const uid = new Types.ObjectId(userId);
  const generation = await AiGenerationModel.findOne({ generationId }).select('userId provider model').lean();
  if (generation && generation.userId.toString() !== userId) {
    // Not theirs: nothing is written and nothing about it is revealed
    throw new AppError('Generation not found', ErrorCode.NOT_FOUND, 404);
  }

  // R14: no consent, no trace (and nothing to reveal: the answer is the same success)
  if (!(await hasAiTrainingConsent(userId))) return;
  const keepContent = Boolean(generation) && correctedOutput !== undefined && correctedOutput !== null;

  let validated: unknown;
  if (keepContent) {
    try {
      // The validator heals its argument in place: give it a copy and keep what the user actually wrote
      validated = JSON.parse(JSON.stringify(correctedOutput));
      validateGeneratedApi(JSON.parse(JSON.stringify(correctedOutput)));
    } catch {
      throw new AppError('correctedOutput is not a valid API specification', ErrorCode.VALIDATION_ERROR, 400);
    }
  }

  const now = new Date();
  const set: Record<string, unknown> = {
    verdict,
    provider: generation ? generation.provider : null,
    model: generation ? generation.model : null,
    expiresAt: new Date(now.getTime() + getAiGenerationRetentionDays() * 86_400_000),
  };
  const update: Record<string, unknown> = { $set: set, $setOnInsert: { userId: uid, generationId } };
  if (keepContent) set.correctedOutput = validated;
  else update.$unset = { correctedOutput: '' };

  await AiFeedbackModel.findOneAndUpdate({ userId: uid, generationId }, update, { upsert: true, setDefaultsOnInsert: true });

  // The user may have withdrawn while this was being written: do not leave anything behind
  if (!(await hasAiTrainingConsent(userId))) {
    await AiFeedbackModel.deleteOne({ userId: uid, generationId });
  }
}
