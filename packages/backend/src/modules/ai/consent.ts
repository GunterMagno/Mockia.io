import { Types } from 'mongoose';
import { ErrorCode } from '@mockia/shared';
import { AppError } from '../../middlewares/errorHandler.js';
import { UserModel } from '../../models/User.js';
import { AiGenerationModel } from '../../models/AiGeneration.js';
import { AiFeedbackModel } from '../../models/AiFeedback.js';

export interface AiConsentState {
  granted: boolean;
  /** When the current choice was made (the grant, or the withdrawal). Kept for older readers. */
  at: Date;
  /** When the consent was given (kept after a withdrawal: proof of the consent the stored data relied on). */
  grantedAt?: Date | null;
  /** When it was withdrawn; absent / null while the consent stands. */
  withdrawnAt?: Date | null;
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
 *  - granted: stores the moment of the grant (granting again while granted keeps it); returns the state. Granting after
 *    a withdrawal is a NEW consent: new grantedAt, no withdrawnAt.
 *  - withdrawn: flips the flag FIRST (so a generation that is being stored right now sees it and removes itself, see
 *    persistGeneration) and then hard-deletes every stored example. The grant time is kept (`grantedAt`, proof of the
 *    consent the data relied on) and the withdrawal time is added (`withdrawnAt`).
 *  `at` always means "when the current choice was made" (compat with older readers and rows: for a legacy
 *  { granted: true, at } row, `at` is the grant time).
 * @throws AppError 404 when the account no longer exists
 */
export async function setAiTrainingConsent(userId: string, granted: boolean): Promise<AiConsentState> {
  const user = await UserModel.findById(userId).select('aiTrainingConsent').lean();
  if (!user) throw new AppError('User not found', ErrorCode.NOT_FOUND, 404);
  const current = user.aiTrainingConsent;

  if (granted && current?.granted === true) {
    return { granted: true, at: current.at, grantedAt: current.grantedAt ?? current.at, withdrawnAt: null };
  }

  const now = new Date();
  const state: AiConsentState = granted
    ? { granted: true, at: now, grantedAt: now, withdrawnAt: null }
    : {
        granted: false,
        at: now,
        // The grant this withdrawal ends (legacy rows: `at` of a granted row); null if there never was one
        grantedAt: current?.grantedAt ?? (current?.granted === true ? current.at : null),
        withdrawnAt: now,
      };
  await UserModel.updateOne({ _id: userId }, { $set: { aiTrainingConsent: state } });
  if (!granted) await eraseAiTrainingData(userId);
  return state;
}
