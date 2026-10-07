import { Schema, model, Document, Types } from 'mongoose';

/** What a single-use emailed token is good for. */
export type AuthTokenPurpose = 'verify' | 'reset';

/**
 * A single-use token sent by email (email verification, password reset).
 *
 * Only the SHA-256 hash of the token is stored: a leaked database cannot be used to reset anybody's password.
 * The raw token exists only in the email link (see modules/auth/passwordReset.ts).
 */
interface AuthTokenDocument extends Document {
  /** sha256(token) as hex. The token is 32 random bytes, so a plain hash is enough (no salt or slow hash needed). */
  tokenHash: string;
  userId: Types.ObjectId;
  purpose: AuthTokenPurpose;
  /** Hard expiry; Mongo deletes the document shortly after (TTL index). */
  expiresAt: Date;
  /** Set when the token was consumed. A used token never works again. */
  usedAt?: Date | null;
  createdAt: Date;
}

const authTokenSchema = new Schema<AuthTokenDocument>(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    purpose: { type: String, enum: ['verify', 'reset'], required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  {
    // createdAt only: tokens are never edited in place, only marked used.
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// TTL: Mongo removes each token at its expiresAt (expireAfterSeconds: 0 = "at the date stored in the field").
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthTokenModel = model<AuthTokenDocument>('AuthToken', authTokenSchema);

export type { AuthTokenDocument };
