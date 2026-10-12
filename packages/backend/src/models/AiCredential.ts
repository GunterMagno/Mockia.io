import { Schema, model, Types } from 'mongoose';
import {
  AI_CREDENTIAL_LABEL_MAX,
  AI_CREDENTIAL_MODEL_MAX,
  AI_PROVIDER_PRESET_IDS,
} from '@mockia/shared';
import type { AiCredentialError, AiCredentialPreset } from '@mockia/shared';
import type { SealedSecret } from '../modules/byok/crypto.js';

/**
 * An AI provider key that a user brought (BYOK, decisions D7-D10).
 *
 * The key itself is never stored: `sealed` holds it encrypted with AES-256-GCM (modules/byok/crypto.ts) under an AAD of
 * `userId|_id|baseUrl`, so the record only opens for this user, this credential and this host. `last4` is the only
 * trace of the key in the clear (enough for the owner to recognise it in a list). Only its owner may read or change
 * it, and the API never returns `sealed`.
 *
 * `baseUrl` is fixed by the preset (or, with BYOK_ALLOW_CUSTOM_URLS, validated against the SSRF policy) and cannot be
 * edited afterwards: changing it would invalidate the AAD of the sealed key.
 */
export interface AiCredentialDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  label: string;
  preset: AiCredentialPreset;
  baseUrl: string;
  model: string;
  sealed: SealedSecret;
  last4: string;
  lastUsedAt?: Date;
  lastError?: AiCredentialError;
  createdAt: Date;
  updatedAt: Date;
}

const sealedSchema = new Schema<SealedSecret>(
  {
    v: { type: Number, enum: [1], required: true },
    kid: { type: String, required: true, maxlength: 16 },
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    ct: { type: String, required: true },
  },
  { _id: false }
);

const aiCredentialSchema = new Schema<AiCredentialDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    label: { type: String, required: true, trim: true, maxlength: AI_CREDENTIAL_LABEL_MAX },
    preset: { type: String, required: true, enum: [...AI_PROVIDER_PRESET_IDS, 'custom'] },
    baseUrl: { type: String, required: true, maxlength: 300 },
    model: { type: String, required: true, maxlength: AI_CREDENTIAL_MODEL_MAX },
    sealed: { type: sealedSchema, required: true },
    last4: { type: String, required: true, minlength: 4, maxlength: 4 },
    lastUsedAt: { type: Date },
    lastError: { type: String, enum: ['rejected', 'unreachable'] },
  },
  { timestamps: true }
);

// One label per user (also what stops two racing requests from storing the same name); listing is by user
aiCredentialSchema.index({ userId: 1, label: 1 }, { unique: true });

export const AiCredentialModel = model<AiCredentialDocument>('AiCredential', aiCredentialSchema);
