import { Schema, model, Document } from 'mongoose';

/**
 * Internal interface for user document in MongoDB
 * Extends Mongoose Document to access instance methods and properties
 */
interface UserDocument extends Document {
  email: string;
  username: string;
  passwordHash: string;
  /** Subscription tier. Effective tier also depends on billingStatus (see modules/billing/plans.ts). */
  plan: 'free' | 'pro' | 'team';
  /** Mirrors Stripe subscription state. Anything but 'active' degrades to the free tier. */
  billingStatus: 'active' | 'past_due' | 'canceled';
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  /** Last Stripe event applied (id + created time): guards against replays and out-of-order webhooks. */
  stripeLastEventId?: string;
  stripeEventAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * User schema
 * Defines the structure and validations of the document in MongoDB
 */
const userSchema = new Schema<UserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    plan: {
      type: String,
      enum: ['free', 'pro', 'team'],
      default: 'free',
    },
    billingStatus: {
      type: String,
      enum: ['active', 'past_due', 'canceled'],
      default: 'active',
    },
    stripeCustomerId: { type: String, index: true, sparse: true },
    stripeSubscriptionId: { type: String },
    stripeLastEventId: { type: String },
    stripeEventAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

/**
 * User model for CRUD operations in MongoDB
 * Will be mapped to API types in the service layer
 */
export const UserModel = model<UserDocument>('User', userSchema);

export type { UserDocument };
