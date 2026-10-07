import { Schema, model, Document } from 'mongoose';
import { SUPPORTED_LOCALES, type Locale } from '@mockia/shared';

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
  /** The subscription ends at currentPeriodEnd (cancelled from the customer portal). */
  cancelAtPeriodEnd: boolean;
  /** End of the current billing period, mirrored from the Stripe subscription. */
  currentPeriodEnd?: Date | null;
  /**
   * When the user proved control of the inbox (verification link or password reset link).
   * Unset = unverified; AI generation and billing require it when REQUIRE_EMAIL_VERIFICATION is on.
   */
  emailVerifiedAt?: Date | null;
  /** Interface language chosen by the user. Unset until the client saves one. */
  locale?: Locale;
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
    cancelAtPeriodEnd: { type: Boolean, default: false },
    currentPeriodEnd: { type: Date, default: null },
    emailVerifiedAt: { type: Date, default: null },
    locale: { type: String, enum: SUPPORTED_LOCALES },
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
