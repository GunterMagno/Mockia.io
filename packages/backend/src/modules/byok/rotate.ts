import { AiCredentialModel } from '../../models/AiCredential.js';
import { loadKeyring, needsRotation, open, seal, type Keyring } from './crypto.js';
import { credentialAad } from './service.js';

/**
 * Key rotation for the sealed AI keys of the users (ruling Q-R6; used by `npm run byok:rotate`).
 *
 * Flow for the owner: put a NEW key first in BYOK_KEYS and keep the old one after it (`k2:<new>,k1:<old>`), restart, run
 * the rotation, and drop the old entry once nothing is left sealed with it.
 *
 * Properties, all pinned by tests/byok.rotate.test.ts:
 *  - the keyring is loaded ONCE and passed to every seal/open;
 *  - the AAD of each record is derived from the record itself (`userId|_id|baseUrl`), never supplied by the caller;
 *  - idempotent: records already on the active key are not touched;
 *  - a record whose key id is not in the keyring cannot be opened: it is counted apart (`unknownKey`) and left as it is;
 *  - a record that does not open (altered, or copied to another user or host) is counted as `failed` and left as it is;
 *  - the write is a compare-and-swap on the sealed record read: if the user replaced the key meanwhile, theirs wins
 *    (`skipped`) and the next run picks it up if it still needs it;
 *  - nothing but counts leaves this function: no key, no plaintext, no id, no error text.
 */
export interface RotateResult {
  dryRun: boolean;
  /** Credentials looked at */
  total: number;
  /** Re-sealed with the active key (with `dryRun`: how many would be) */
  rotated: number;
  /** Already on the active key */
  alreadyCurrent: number;
  /** Sealed with a key id that is not in the keyring: cannot be rotated */
  unknownKey: number;
  /** Did not open with the key it names (altered, or moved to another user/host) */
  failed: number;
  /** Changed by somebody else while the rotation ran: left for the next run */
  skipped: number;
}

export interface RotateOptions {
  /** The keyring to use. Default: loaded once from BYOK_KEYS. */
  ring?: Keyring;
  /** Count what would be rotated without writing anything. */
  dryRun?: boolean;
  /** Documents the database cursor fetches at a time. */
  batchSize?: number;
}

export async function rotateCredentials(options: RotateOptions = {}): Promise<RotateResult> {
  const ring = options.ring ?? loadKeyring();
  const dryRun = options.dryRun === true;
  const result: RotateResult = {
    dryRun,
    total: 0,
    rotated: 0,
    alreadyCurrent: 0,
    unknownKey: 0,
    failed: 0,
    skipped: 0,
  };

  const cursor = AiCredentialModel.find({})
    .select('userId baseUrl sealed')
    .sort({ _id: 1 })
    .lean()
    .cursor({ batchSize: options.batchSize ?? 100 });

  for await (const cred of cursor) {
    result.total += 1;
    const { sealed } = cred;

    if (!ring.keys.has(sealed.kid)) {
      result.unknownKey += 1;
      continue;
    }
    if (!needsRotation(sealed, ring)) {
      result.alreadyCurrent += 1;
      continue;
    }

    const aad = credentialAad(cred.userId.toString(), cred._id.toString(), cred.baseUrl);
    let resealed;
    try {
      resealed = seal(open(sealed, aad, ring), aad, ring);
    } catch {
      result.failed += 1;
      continue;
    }

    if (dryRun) {
      result.rotated += 1;
      continue;
    }

    // Compare-and-swap on the exact record that was read; a rotation is not an edit, so updatedAt stays as it is
    const written = await AiCredentialModel.updateOne(
      { _id: cred._id, 'sealed.kid': sealed.kid, 'sealed.iv': sealed.iv, 'sealed.ct': sealed.ct },
      { $set: { sealed: resealed } },
      { timestamps: false }
    );
    if (written.modifiedCount === 1) result.rotated += 1;
    else result.skipped += 1;
  }

  return result;
}
