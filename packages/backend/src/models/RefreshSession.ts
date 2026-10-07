import { Schema, model, Document, Types } from 'mongoose';

/**
 * One refresh token issued to a client.
 *
 * Every login starts a "family" (familyId); each rotation adds a child session to the same family and marks the
 * parent as used. Presenting an already-used token outside the grace window means the token leaked, so the whole
 * family is revoked (see modules/auth/sessions.ts).
 */
interface RefreshSessionDocument extends Document {
  /** Unique id of this refresh token (the `jti` claim of the JWT). */
  jti: string;
  /** Chain of rotations that started at one login. */
  familyId: string;
  userId: Types.ObjectId;
  /** Set when the token was exchanged for a new one. */
  usedAt?: Date;
  /** Set on logout, password change or reuse detection. */
  revokedAt?: Date;
  /** Hard expiry; Mongo deletes the document shortly after (TTL index). */
  expiresAt: Date;
  /**
   * The user asked to be remembered at login: the cookie that carries this token outlives the browser session
   * (Max-Age 7 d). Inherited by every child of the family so the choice survives rotation.
   */
  persistent: boolean;
  ip?: string;
  ua?: string;
  createdAt: Date;
}

const refreshSessionSchema = new Schema<RefreshSessionDocument>(
  {
    jti: { type: String, required: true, unique: true },
    familyId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    usedAt: { type: Date },
    revokedAt: { type: Date },
    expiresAt: { type: Date, required: true },
    persistent: { type: Boolean, default: false },
    ip: { type: String },
    ua: { type: String },
  },
  {
    // createdAt only: sessions are never edited in place, only marked used/revoked.
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// TTL: Mongo removes each session at its expiresAt (expireAfterSeconds: 0 = "at the date stored in the field").
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshSessionModel = model<RefreshSessionDocument>('RefreshSession', refreshSessionSchema);

export type { RefreshSessionDocument };
