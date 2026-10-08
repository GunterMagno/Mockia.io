import { Types } from 'mongoose';
import { ErrorCode } from '@mockia/shared';
import { AppError } from '../../middlewares/errorHandler.js';
import { UserModel } from '../../models/User.js';
import { AiGenerationModel } from '../../models/AiGeneration.js';
import { AiFeedbackModel } from '../../models/AiFeedback.js';

export interface AiConsentState {
  granted: boolean;
  at: Date;
}

/** Whether the user currently allows their AI generations to be stored for improving the model. Unknown user = no. */
export async function hasAiTrainingConsent(userId: string): Promise<boolean> {
  const user = await UserModel.findById(userId).select('aiTrainingConsent').lean();
  return user?.aiTrainingConsent?.granted === true;
}

/**
 * Erases everything the user contributed to the training data: stored generations and every feedback row (verdict-only
 * rows included, so withdrawing leaves nothing of the feature behind). Hard delete, no soft-delete flag.
 */
export async function eraseAiTrainingData(userId: string): Promise<void> {
  const uid = new Types.ObjectId(userId);
  await AiGenerationModel.deleteMany({ userId: uid });
  await AiFeedbackModel.deleteMany({ userId: uid });
}

/**
 * Records the user's choice.
 *  - granted: stores the moment of the first grant (granting again keeps it); returns the state.
 *  - withdrawn: flips the flag FIRST (so a generation that is being stored right now sees it and removes itself, see
 *    persistGeneration) and then hard-deletes every stored example. Returns the state with the withdrawal moment.
 * @throws AppError 404 when the account no longer exists
 */
export async function setAiTrainingConsent(userId: string, granted: boolean): Promise<AiConsentState> {
  const user = await UserModel.findById(userId).select('aiTrainingConsent').lean();
  if (!user) throw new AppError('User not found', ErrorCode.NOT_FOUND, 404);

  if (granted && user.aiTrainingConsent?.granted === true) return user.aiTrainingConsent;

  const state: AiConsentState = { granted, at: new Date() };
  await UserModel.updateOne({ _id: userId }, { $set: { aiTrainingConsent: state } });
  if (!granted) await eraseAiTrainingData(userId);
  return state;
}
