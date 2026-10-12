/**
 * Sealing of the API keys users bring (decision D10).
 *
 * AES-256-GCM from node:crypto. The keyring lives in the environment, `BYOK_KEYS="id:base64(32 bytes),id2:..."`: the
 * FIRST entry is the active one (used to seal); the others only open older records until they are re-sealed. Every
 * sealing uses a fresh random 12-byte IV and a 16-byte tag. The AAD (the caller passes `userId|credId|baseUrl`) is
 * mandatory and non-empty: a ciphertext copied to another user, credential or host fails to open.
 *
 * Keyring lifetime: `seal`/`open`/`needsRotation` read the keyring from `process.env` ON EVERY CALL when none is passed
 * (a few base64 decodes: negligible next to a network call to an AI provider). Nothing is cached, so tests and a
 * rotation can change `BYOK_KEYS` without restarting, and no key lingers in a module-level variable. Callers that seal
 * or open many records in a row (the rotation script) load it once and pass it in.
 *
 * Errors are `ByokCryptoError` with a FIXED message per code: they never carry the plaintext, the AAD, the ciphertext,
 * key material, a key id, or any part of the `BYOK_KEYS` value, so they are safe to log and to put in an assertion.
 * A tampered record and a wrong AAD fail identically.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SealedSecret {
  v: 1;
  /** Id of the key that sealed it (a name, not secret). */
  kid: string;
  /** base64 of the 12-byte IV */
  iv: string;
  /** base64 of the 16-byte GCM tag */
  tag: string;
  /** base64 of the ciphertext */
  ct: string;
}

export type Keyring = { active: string; keys: ReadonlyMap<string, Buffer> };

export type ByokCryptoErrorCode =
  | 'keyring_invalid' // BYOK_KEYS missing or malformed
  | 'invalid_input' // plaintext / AAD / record not shaped as expected
  | 'unknown_key' // the record names a key that is not in the keyring
  | 'decrypt_failed'; // wrong AAD, wrong key or altered record

const MESSAGES: Record<ByokCryptoErrorCode, string> = {
  keyring_invalid: 'BYOK keyring is missing or invalid',
  invalid_input: 'BYOK crypto: invalid input',
  unknown_key: 'BYOK crypto: key id not in the keyring',
  decrypt_failed: 'BYOK crypto: could not decrypt the secret',
};

/** More specific, still value-free, reasons for `keyring_invalid` (an entry position or a rule, never a value). */
export class ByokCryptoError extends Error {
  readonly code: ByokCryptoErrorCode;

  constructor(code: ByokCryptoErrorCode, detail?: string) {
    super(detail ? `${MESSAGES[code]} (${detail})` : MESSAGES[code]);
    this.name = 'ByokCryptoError';
    this.code = code;
  }
}

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_PLAINTEXT_BYTES = 8192;
const KEY_ID = /^[a-z0-9_-]{1,16}$/;
const DEFAULT_KEY_ID = 'k1';

/** Decodes canonical base64 (what `Buffer#toString('base64')` writes); anything else is rejected. */
function decodeBase64(value: unknown): Buffer | null {
  if (typeof value !== 'string' || value === '') return null;
  const buf = Buffer.from(value, 'base64');
  return buf.toString('base64') === value ? buf : null;
}

/**
 * Parses `BYOK_KEYS`. Throws `keyring_invalid` when it is empty or any entry is wrong; the message says which rule
 * failed and the position of the entry (1-based), never what was written. The result is frozen.
 */
export function loadKeyring(env: NodeJS.ProcessEnv = process.env): Keyring {
  const raw = (env.BYOK_KEYS ?? '').trim();
  if (raw === '') {
    throw new ByokCryptoError('keyring_invalid', 'BYOK_KEYS is empty');
  }

  const keys = new Map<string, Buffer>();
  let active = '';
  raw.split(',').forEach((chunk, index) => {
    const position = `entry ${index + 1}`;
    const entry = chunk.trim();
    const parts = entry.split(':');
    if (parts.length !== 2) {
      throw new ByokCryptoError('keyring_invalid', `${position} must look like id:base64`);
    }
    const [id, encoded] = parts.map((p) => p.trim()) as [string, string];
    if (!KEY_ID.test(id)) {
      throw new ByokCryptoError('keyring_invalid', `${position}: id must match [a-z0-9_-]{1,16}`);
    }
    if (keys.has(id)) {
      throw new ByokCryptoError('keyring_invalid', `${position}: duplicate id`);
    }
    const key = decodeBase64(encoded);
    if (!key || key.length !== KEY_BYTES) {
      throw new ByokCryptoError(
        'keyring_invalid',
        `${position}: key must be base64 of exactly ${KEY_BYTES} bytes`
      );
    }
    if (index === 0) active = id;
    keys.set(id, key);
  });

  return Object.freeze({ active, keys });
}

/** A new random keyring entry `<id>:<base64 of 32 random bytes>` (for `npm run byok:genkey`). */
export function generateKeyEntry(id: string = DEFAULT_KEY_ID): string {
  if (!KEY_ID.test(id)) {
    throw new ByokCryptoError('keyring_invalid', 'id must match [a-z0-9_-]{1,16}');
  }
  return `${id}:${randomBytes(KEY_BYTES).toString('base64')}`;
}

function aadBuffer(aad: unknown): Buffer {
  if (typeof aad !== 'string' || aad === '') throw new ByokCryptoError('invalid_input');
  return Buffer.from(aad, 'utf8');
}

/** Seals `plain` with the active key. `aad` must be a non-empty string identifying who/what/where it belongs to. */
export function seal(plain: string, aad: string, ring: Keyring = loadKeyring()): SealedSecret {
  if (typeof plain !== 'string' || plain === '') throw new ByokCryptoError('invalid_input');
  const data = Buffer.from(plain, 'utf8');
  if (data.length > MAX_PLAINTEXT_BYTES) throw new ByokCryptoError('invalid_input');
  const aadBytes = aadBuffer(aad);

  const key = ring.keys.get(ring.active);
  if (!key) throw new ByokCryptoError('keyring_invalid');

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadBytes);
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  return {
    v: 1,
    kid: ring.active,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  };
}

/** Opens a sealed secret. Throws `ByokCryptoError`; the message never contains the secret, the AAD or the record. */
export function open(sealed: SealedSecret, aad: string, ring: Keyring = loadKeyring()): string {
  const aadBytes = aadBuffer(aad);
  if (typeof sealed !== 'object' || sealed === null || sealed.v !== 1) {
    throw new ByokCryptoError('invalid_input');
  }
  const iv = decodeBase64(sealed.iv);
  const tag = decodeBase64(sealed.tag);
  const ct = decodeBase64(sealed.ct);
  if (typeof sealed.kid !== 'string' || !iv || iv.length !== IV_BYTES) {
    throw new ByokCryptoError('invalid_input');
  }
  if (!tag || tag.length !== TAG_BYTES || !ct) throw new ByokCryptoError('invalid_input');

  // `keys` is a Map: "__proto__" or "constructor" are plain unknown ids
  const key = ring.keys.get(sealed.kid);
  if (!key) throw new ByokCryptoError('unknown_key');

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aadBytes);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    // The underlying error is dropped on purpose: one message for a wrong AAD, a wrong key and a tampered record
    throw new ByokCryptoError('decrypt_failed');
  }
}

/** Whether the record was sealed with something other than the active key (an old key, or one that left the ring). */
export function needsRotation(sealed: SealedSecret, ring: Keyring = loadKeyring()): boolean {
  return sealed.kid !== ring.active;
}
