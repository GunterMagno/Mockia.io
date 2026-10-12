/**
 * Re-seals every stored AI key with the ACTIVE key of the keyring (the first entry of BYOK_KEYS).
 *
 *   npm run byok:rotate -w @mockia/backend -- --dry-run   # only count what would change
 *   npm run byok:rotate -w @mockia/backend                # do it
 *
 * Rotation, step by step:
 *   1. npm run byok:genkey -w @mockia/backend --silent -- k2     (prints a new entry, e.g. k2:<base64>)
 *   2. BYOK_KEYS="k2:<new>,k1:<old>"   (new FIRST, old kept so existing records still open); restart the server
 *   3. run this script (--dry-run first if you want to see the counts)
 *   4. when `unknownKey=0` and `failed=0`, and a second run shows `rotated=0`, remove the old entry from BYOK_KEYS
 *
 * It prints COUNTS only (never keys, ids or plaintext). It is idempotent. Records sealed with a key id that is not in
 * the keyring (`unknownKey`) and records that do not open (`failed`) are left untouched and make the exit code 1, so a
 * pipeline notices that the old key is not yet safe to drop.
 *
 * Environment: BYOK_KEYS (required) and MONGODB_URI, as for the server (a .env in packages/backend is read).
 */
import 'dotenv/config'; // first import: connection.ts reads MONGODB_URI when it is evaluated
import { connectDB, disconnectDB } from '../src/config/connection.js';
import { loadKeyring, ByokCryptoError } from '../src/modules/byok/crypto.js';
import { rotateCredentials } from '../src/modules/byok/rotate.js';

async function main(): Promise<number> {
  const dryRun = process.argv.slice(2).includes('--dry-run');

  // Loaded ONCE, before touching the database; a bad keyring stops here with a message that never quotes the value
  let ring;
  try {
    ring = loadKeyring();
  } catch (err) {
    const detail = err instanceof ByokCryptoError ? err.message : 'BYOK keyring is invalid';
    process.stderr.write(`[byok:rotate] ${detail}\n`);
    return 1;
  }

  await connectDB();
  const r = await rotateCredentials({ ring, dryRun });
  console.log(
    `[byok:rotate] total=${r.total} rotated=${r.rotated} alreadyCurrent=${r.alreadyCurrent} unknownKey=${r.unknownKey} failed=${r.failed} skipped=${r.skipped}`
  );
  if (dryRun) console.log('[byok:rotate] dry run: nothing was written');
  if (r.unknownKey > 0 || r.failed > 0) {
    console.log(
      '[byok:rotate] some records were NOT rotated (unknownKey: their key is not in BYOK_KEYS; failed: they do not open). Do not drop the old key yet.'
    );
    return 1;
  }
  return 0;
}

main()
  .then(async (code) => {
    await disconnectDB().catch(() => undefined);
    // disconnectDB() leaves the reconnect listener of config/connection.ts armed: exit explicitly
    process.exit(code);
  })
  .catch(async () => {
    // No error object: a driver message can contain the connection string
    console.error('[byok:rotate] Failed (database or unexpected error)');
    await disconnectDB().catch(() => undefined);
    process.exit(1);
  });
