/**
 * Who is an administrator (the owner of the deployment).
 *
 * Decision D2: a list of addresses in the environment (ADMIN_EMAILS, comma separated), with no role stored in the
 * database, so no write to a User document can ever grant it. Empty or unset (the default) means nobody. The address
 * must also be VERIFIED (see middlewares/requireAdmin.ts), or registering with somebody else's address would be enough.
 */

/** Pragmatic address check (one @, no spaces, a dotted domain, at most 254 chars): anything else never grants access. */
const EMAIL = /^[^\s@,*]+@[^\s@,*]+\.[^\s@,*]+$/;
const MAX_EMAIL_LENGTH = 254;

function entriesOf(env: NodeJS.ProcessEnv): string[] {
  return (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function isEmailAddress(value: string): boolean {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL.test(value);
}

/** The administrator addresses: lowercase, trimmed, de-duplicated. Entries that are not an address are ignored. */
export function getAdminEmails(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  return new Set(entriesOf(env).filter(isEmailAddress));
}

/**
 * How many entries of ADMIN_EMAILS are not an email address. A count, never the entries: assertProdConfig reports it
 * without echoing what the owner typed.
 */
export function invalidAdminEmailCount(env: NodeJS.ProcessEnv = process.env): number {
  return entriesOf(env).filter((entry) => !isEmailAddress(entry)).length;
}

/** Whether `email` (any case) is listed. */
export function isAdminEmail(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return getAdminEmails(env).has(email.trim().toLowerCase());
}
