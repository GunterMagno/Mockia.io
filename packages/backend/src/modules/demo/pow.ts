import crypto from 'crypto';
import { DemoSpentChallengeModel } from '../../models/DemoSpentChallenge.js';
import { demoKey, getDemoConfig } from './config.js';

/**
 * Proof of work (hashcash) for the demo. The server hands out a signed challenge; the browser must find a nonce such
 * that SHA-256(challenge ":" nonce) starts with `bits` zero bits, then send both back. This is a cost barrier for
 * scripts, not an identity check: the per-IP and global budgets (budget.ts) are the real defence.
 *
 * challenge = base64url(JSON {id, bits, exp}) "." base64url(HMAC-SHA256(demo-pow key, first part)). The signature
 * covers the difficulty, so a client cannot lower it. A solved challenge is spent atomically (unique _id), which
 * is what stops one solution from being used for many generations.
 */

/** Life of a challenge. Shorter than the 10 min TTL of the spent-id collection (see DemoSpentChallenge). */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGE_LENGTH = 512;
const MAX_NONCE_LENGTH = 64;
const NONCE_FORMAT = /^[A-Za-z0-9_-]+$/;

export type ProofFailure = 'malformed' | 'bad_signature' | 'expired' | 'insufficient_work' | 'replayed';
export type ProofResult = { ok: true } | { ok: false; reason: ProofFailure };

const sign = (payloadPart: string): Buffer => crypto.createHmac('sha256', demoKey('demo-pow')).update(payloadPart).digest();

export function issueChallenge(now: Date = new Date()): { challenge: string; bits: number; expiresAt: string } {
  const { powBits } = getDemoConfig();
  const exp = now.getTime() + CHALLENGE_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ id: crypto.randomBytes(16).toString('hex'), bits: powBits, exp })).toString('base64url');
  return { challenge: `${payload}.${sign(payload).toString('base64url')}`, bits: powBits, expiresAt: new Date(exp).toISOString() };
}

/** Number of leading zero bits of a digest. */
function leadingZeroBits(digest: Buffer): number {
  let zeros = 0;
  for (const byte of digest) {
    if (byte === 0) {
      zeros += 8;
      continue;
    }
    return zeros + Math.clz32(byte) - 24;
  }
  return zeros;
}

interface Payload {
  id: string;
  bits: number;
  exp: number;
}

function parsePayload(part: string): Payload | null {
  try {
    const data = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    if (typeof data?.id !== 'string' || !/^[0-9a-f]{32}$/.test(data.id)) return null;
    if (!Number.isInteger(data.bits) || data.bits < 1 || data.bits > 64) return null;
    if (!Number.isFinite(data.exp)) return null;
    return { id: data.id, bits: data.bits, exp: data.exp };
  } catch {
    return null;
  }
}

/** What a successful pure check hands to the steps that follow: the id the challenge is spent under. */
export type ProofCheck = { ok: true; id: string } | { ok: false; reason: Exclude<ProofFailure, 'replayed'> };

/**
 * The part of the verification that needs no database: shape, signature, expiry and the work itself. It costs a few
 * hashes and writes nothing, so the service runs it BEFORE it touches the budget: a request that does not carry a real
 * solution (the whole of the cheap abuse: forged, expired, unsolved) can then neither write a counter nor hold a unit of
 * the demo-wide budget, whatever address it claims to come from.
 */
export function checkProof(challenge: unknown, nonce: unknown, now: Date = new Date()): ProofCheck {
  if (typeof challenge !== 'string' || typeof nonce !== 'string') return { ok: false, reason: 'malformed' };
  if (challenge.length > MAX_CHALLENGE_LENGTH || nonce.length === 0 || nonce.length > MAX_NONCE_LENGTH || !NONCE_FORMAT.test(nonce)) {
    return { ok: false, reason: 'malformed' };
  }
  const parts = challenge.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };

  const given = Buffer.from(parts[1], 'base64url');
  const expected = sign(parts[0]);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: 'bad_signature' };

  const payload = parsePayload(parts[0]);
  if (!payload) return { ok: false, reason: 'malformed' };
  if (now.getTime() > payload.exp) return { ok: false, reason: 'expired' };

  const digest = crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest();
  if (leadingZeroBits(digest) < payload.bits) return { ok: false, reason: 'insufficient_work' };
  return { ok: true, id: payload.id };
}

/** Read-only: has this challenge already been spent? (A replay is refused here without any write.) */
export async function isChallengeSpent(id: string): Promise<boolean> {
  return (await DemoSpentChallengeModel.exists({ _id: id })) !== null;
}

/** Spends a challenge atomically (unique _id): exactly one of any number of simultaneous callers gets `true`. */
export async function spendChallenge(id: string, now: Date = new Date()): Promise<boolean> {
  try {
    await DemoSpentChallengeModel.create({ _id: id, createdAt: now });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}

export async function verifyProof(challenge: unknown, nonce: unknown, now: Date = new Date()): Promise<ProofResult> {
  const checked = checkProof(challenge, nonce, now);
  if (!checked.ok) return checked;
  // Spending is the last step, so a wrong nonce does not burn a challenge the client could still solve
  return (await spendChallenge(checked.id, now)) ? { ok: true } : { ok: false, reason: 'replayed' };
}
