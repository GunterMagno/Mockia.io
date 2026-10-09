import { Schema, model } from 'mongoose';

/**
 * Proof-of-work challenges already redeemed. The challenge id is the _id, so the unique index makes "spend it" an
 * atomic insert: the second redemption of the same challenge fails with a duplicate-key error. The TTL (10 min) is
 * longer than a challenge's life (5 min), so an id is never forgotten while its challenge could still verify.
 */
export interface DemoSpentChallengeDocument {
  _id: string;
  createdAt: Date;
}

const spentSchema = new Schema<DemoSpentChallengeDocument>({
  _id: { type: String, required: true },
  createdAt: { type: Date, required: true, default: () => new Date(), expires: 600 },
});

export const DemoSpentChallengeModel = model<DemoSpentChallengeDocument>('DemoSpentChallenge', spentSchema);
