/**
 * One-off: marks every existing user as email-verified.
 *
 * Run it once BEFORE enabling email verification (REQUIRE_EMAIL_VERIFICATION=true, or NODE_ENV=production where it is
 * the default), otherwise accounts created before the feature cannot use AI generation or billing.
 *
 *   npm run backfill:email-verified -w @mockia/backend
 *   MONGODB_URI=mongodb://... npm run backfill:email-verified -w @mockia/backend
 *
 * Idempotent: users that already have a verification date are left alone.
 */
import 'dotenv/config'; // first import: connection.ts reads MONGODB_URI when it is evaluated
import { connectDB, disconnectDB } from '../src/config/connection.js';
import { backfillEmailVerified } from '../src/modules/auth/backfillEmailVerified.js';

async function main(): Promise<void> {
  await connectDB();
  const modified = await backfillEmailVerified();
  console.log(`[Backfill] ${modified} user(s) marked as email-verified.`);
  await disconnectDB();
  // disconnectDB() leaves the reconnect listener of config/connection.ts armed: it would reopen the connection and keep the process alive
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[Backfill] Failed:', err);
  await disconnectDB().catch(() => undefined);
  process.exit(1);
});
