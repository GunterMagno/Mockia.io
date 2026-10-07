import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@mockia/shared';
import { RefreshSessionModel } from '../../models/RefreshSession.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { REFRESH_TOKEN_TTL_SECONDS } from '../../services/jwt.service.js';

/**
 * Server-side state of refresh tokens: rotation, reuse detection and revocation.
 *
 * Every login opens a family. Each refresh marks the presented token as used and issues a child in the same family.
 * A used token presented again is either two tabs racing (inside the grace window: tolerated) or a leaked token
 * (outside it: the whole family is revoked, which also logs out whoever holds the newest token).
 */

/** Reusing a used token within this window of its first use is treated as a concurrent-tab race, not theft. */
export const REUSE_GRACE_MS = 10_000;
const SESSION_TTL_MS = REFRESH_TOKEN_TTL_SECONDS * 1000;
const MAX_UA_LENGTH = 256;

export interface SessionMeta {
  ip?: string;
  ua?: string;
}

export interface SessionRef {
  jti: string;
  familyId: string;
}

export interface RotatedSession extends SessionRef {
  userId: string;
  /** "Remember me" choice of the login, inherited from the parent so it survives every rotation. */
  persistent: boolean;
}

/** Public shape of a live session (the family id stays internal). */
export interface ActiveSessionInfo {
  /** jti of the live refresh token of that login. */
  id: string;
  createdAt: Date;
  ip?: string;
  ua?: string;
  /** True for the login the request's refresh cookie belongs to (false for every row when the request has none). */
  current: boolean;
}

function unauthorized(): AppError {
  return new AppError('Invalid or expired refresh token', ErrorCode.UNAUTHORIZED, 401);
}

async function insertSession(
  userId: string,
  familyId: string,
  meta: SessionMeta,
  persistent: boolean
): Promise<SessionRef> {
  const jti = randomUUID();
  await RefreshSessionModel.create({
    jti,
    familyId,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    persistent,
    ip: meta.ip,
    ua: meta.ua?.slice(0, MAX_UA_LENGTH),
  });
  return { jti, familyId };
}

/**
 * Starts a new family (a login) and returns its first refresh session.
 *
 * @param persistent - the user ticked "remember me": the cookie will outlive the browser session (see cookie.ts)
 */
export async function createSession(userId: string, meta: SessionMeta, persistent = false): Promise<SessionRef> {
  return insertSession(userId, randomUUID(), meta, persistent);
}

/**
 * Exchanges a refresh session for a new one in the same family.
 *
 * @param jti - jti claim of the presented refresh token (already signature-verified by the caller)
 * @param meta - ip/user agent of the client making the refresh (stored on the child)
 * @throws AppError 401 if the session is unknown, expired, revoked, or reused outside the grace window
 *   (in that case the whole family is revoked first)
 */
export async function rotateSession(jti: string, meta: SessionMeta = {}): Promise<RotatedSession> {
  const now = new Date();

  // Atomic claim: of N simultaneous refreshes with the same token exactly one gets the live session here.
  let parent = await RefreshSessionModel.findOneAndUpdate(
    { jti, usedAt: null, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } }
  );

  if (!parent) {
    const existing = await RefreshSessionModel.findOne({ jti });
    // Unknown, revoked (this includes revoked families) or expired
    if (!existing || existing.revokedAt || existing.expiresAt <= now) throw unauthorized();
    // Not used yet, so the claim only failed because it raced with a revoke/expiry: treat as invalid
    if (!existing.usedAt) throw unauthorized();

    if (now.getTime() - existing.usedAt.getTime() > REUSE_GRACE_MS) {
      await revokeFamily(existing.familyId);
      throw unauthorized();
    }
    // Inside the grace window: a concurrent tab already rotated this token. Give this caller its own child.
    parent = existing;
  }

  const familyId = parent.familyId;
  const userId = parent.userId.toString();
  const persistent = parent.persistent === true;
  const child = await insertSession(userId, familyId, meta, persistent);

  // A revocation that ran between the claim and the insert did not see the child: close that gap.
  const familyRevoked = await RefreshSessionModel.exists({ familyId, revokedAt: { $ne: null } });
  if (familyRevoked) {
    await revokeFamily(familyId);
    throw unauthorized();
  }

  return { jti: child.jti, familyId, userId, persistent };
}

/** Revokes every session of one login chain. Idempotent. */
export async function revokeFamily(familyId: string): Promise<void> {
  await RefreshSessionModel.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

/** Revokes the family a refresh token belongs to, found by its jti. Unknown jti is a no-op. */
export async function revokeFamilyByJti(jti: string): Promise<void> {
  const session = await RefreshSessionModel.findOne({ jti }).select('familyId');
  if (session) await revokeFamily(session.familyId);
}

/** Revokes every session of the user (logout everywhere, password change/reset). Idempotent. */
export async function revokeAllForUser(userId: string): Promise<void> {
  await RefreshSessionModel.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

/**
 * Live sessions of a user, one per login (the newest live token of each family), newest first.
 * Used tokens, revoked and expired sessions are not listed.
 *
 * @param currentJti - jti of the refresh token the calling browser holds (its cookie): the login that token belongs
 *   to is flagged `current`. A token of another user's session never matches.
 */
export async function listActiveSessions(userId: string, currentJti?: string): Promise<ActiveSessionInfo[]> {
  const currentFamilyId = currentJti
    ? (await RefreshSessionModel.findOne({ jti: currentJti, userId }).select('familyId'))?.familyId
    : undefined;
  const live = await RefreshSessionModel.find({
    userId,
    usedAt: null,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  // Concurrent tabs inside the grace window leave several live children in one family: keep the newest.
  const seenFamilies = new Set<string>();
  const sessions: ActiveSessionInfo[] = [];
  for (const s of live) {
    if (seenFamilies.has(s.familyId)) continue;
    seenFamilies.add(s.familyId);
    sessions.push({
      id: s.jti,
      createdAt: s.createdAt,
      ip: s.ip,
      ua: s.ua,
      current: currentFamilyId !== undefined && s.familyId === currentFamilyId,
    });
  }
  return sessions;
}
