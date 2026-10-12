/**
 * Prints ONE new random keyring entry, `<id>:<base64 of 32 bytes>`, to copy into the BYOK_KEYS environment variable
 * (Render dashboard, the .env of the server, ...). Nothing else is written to stdout; it touches no file or database.
 *
 *   npm run byok:genkey -w @mockia/backend --silent        -> k1:<base64>
 *   npm run byok:genkey -w @mockia/backend --silent -- k2  -> k2:<base64>
 *
 * (`--silent` hides npm's own banner lines so that only the key is printed.)
 *
 * Rotation: put the NEW entry FIRST in BYOK_KEYS and keep the old one after it (`k2:<new>,k1:<old>`), restart, run the
 * rotation script, and drop the old entry once nothing is sealed with it.
 *
 * This is a secret. Do not paste it in chats, tickets, commits or CI logs.
 */
import { generateKeyEntry } from '../src/modules/byok/crypto.js';

try {
  process.stdout.write(`${generateKeyEntry(process.argv[2])}\n`);
} catch {
  // The message of ByokCryptoError is fixed and value-free; the argument is not echoed either
  process.stderr.write('byok:genkey: the id must match [a-z0-9_-]{1,16}\n');
  process.exit(1);
}
