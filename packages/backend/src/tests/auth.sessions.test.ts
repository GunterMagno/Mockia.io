import request from 'supertest';
import jsonwebtoken from 'jsonwebtoken';
import app from '../index.js';
import { UserModel } from '../models/User.js';
import { RefreshSessionModel } from '../models/RefreshSession.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { rotateSession, revokeFamily, createSession } from '../modules/auth/sessions.js';
import { AppError } from '../middlewares/errorHandler.js';
import bcrypt from 'bcrypt';

const EMAIL = 'sessions@example.com';
const PASSWORD = 'sessionpass123';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

async function login(): Promise<Tokens> {
  const res = await request(app).post('/api/auth/login').set('User-Agent', 'jest-agent').send({ email: EMAIL, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data.tokens;
}

const refresh = (refreshToken: string) =>
  request(app).post('/api/auth/refresh').set('User-Agent', 'jest-agent').send({ refreshToken });
const jtiOf = (token: string) => (jsonwebtoken.decode(token) as { jti: string }).jti;

describe('Auth - sessions with rotated, revocable refresh tokens', () => {
  let userId: string;

  beforeAll(async () => {
    await connectDB();
    await RefreshSessionModel.init(); // build the TTL index before the first assertion on it
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
    const user = await UserModel.create({
      email: EMAIL,
      username: 'sessionsuser',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    });
    userId = user._id.toString();
  });

  afterAll(async () => {
    await UserModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
    await disconnectDB();
  });

  describe('tokens', () => {
    it('login issues a 15 min access token and a refresh token carrying sub + jti backed by a stored session', async () => {
      const { accessToken, refreshToken } = await login();

      const access = jsonwebtoken.decode(accessToken) as { sub: string; iat: number; exp: number; jti?: string };
      expect(access.sub).toBe(userId);
      expect(access.exp - access.iat).toBe(15 * 60);
      expect(access.jti).toBeUndefined();

      const refreshPayload = jsonwebtoken.decode(refreshToken) as { sub: string; jti: string; iat: number; exp: number };
      expect(refreshPayload.sub).toBe(userId);
      expect(refreshPayload.jti).toEqual(expect.any(String));
      expect(refreshPayload.exp - refreshPayload.iat).toBe(7 * 24 * 3600);

      const session = await RefreshSessionModel.findOne({ jti: refreshPayload.jti });
      expect(session).not.toBeNull();
      expect(session!.userId.toString()).toBe(userId);
      expect(session!.usedAt).toBeUndefined();
      expect(session!.revokedAt).toBeUndefined();
      const ttlMs = session!.expiresAt.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(7 * 24 * 3600 * 1000 - 60_000);
      expect(ttlMs).toBeLessThanOrEqual(7 * 24 * 3600 * 1000);
    });

    it('stores ip and user agent of the login on the session (truncated)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('User-Agent', 'x'.repeat(1000))
        .send({ email: EMAIL, password: PASSWORD });
      const session = await RefreshSessionModel.findOne({ jti: jtiOf(res.body.data.tokens.refreshToken) });
      expect(session!.ip).toEqual(expect.any(String));
      expect(session!.ua).toHaveLength(256);
    });

    it('has a TTL index on expiresAt with expireAfterSeconds 0', async () => {
      const indexes = await RefreshSessionModel.collection.indexes();
      const ttl = indexes.find((i) => i.key && (i.key as Record<string, number>).expiresAt === 1);
      expect(ttl).toBeDefined();
      expect(ttl!.expireAfterSeconds).toBe(0);
    });

    it('rejects a refresh JWT without jti (legacy token) and an access token used as refresh', async () => {
      const legacy = jsonwebtoken.sign({ sub: userId }, process.env.JWT_REFRESH_SECRET!, { algorithm: 'HS256', expiresIn: '7d' });
      expect((await refresh(legacy)).status).toBe(401);

      const { accessToken } = await login();
      expect((await refresh(accessToken)).status).toBe(401);
    });
  });

  describe('rotation (POST /api/auth/refresh)', () => {
    it('(a) a valid refresh returns a new pair and marks the previous token as used', async () => {
      const first = await login();

      const res = await refresh(first.refreshToken);
      expect(res.status).toBe(200);
      const second: Tokens = res.body.data;
      expect(second.accessToken).toEqual(expect.any(String));
      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(jtiOf(second.refreshToken)).not.toBe(jtiOf(first.refreshToken));

      const parent = await RefreshSessionModel.findOne({ jti: jtiOf(first.refreshToken) });
      const child = await RefreshSessionModel.findOne({ jti: jtiOf(second.refreshToken) });
      expect(parent!.usedAt).toBeInstanceOf(Date);
      expect(parent!.revokedAt).toBeUndefined();
      expect(child!.familyId).toBe(parent!.familyId);
      expect(child!.usedAt).toBeUndefined();

      // The new refresh token keeps working (chain)
      expect((await refresh(second.refreshToken)).status).toBe(200);
    });

    it('(b) reusing a used token after the 10 s grace revokes the whole family, including the newest token', async () => {
      const first = await login();
      const second: Tokens = (await refresh(first.refreshToken)).body.data;

      // Make the first token "used" 11 s ago
      await RefreshSessionModel.updateOne({ jti: jtiOf(first.refreshToken) }, { usedAt: new Date(Date.now() - 11_000) });

      const reuse = await refresh(first.refreshToken);
      expect(reuse.status).toBe(401);
      expect(reuse.body.error).toHaveProperty('code', 'UNAUTHORIZED');

      // The legitimate holder of the newest token is cut off too
      expect((await refresh(second.refreshToken)).status).toBe(401);

      const family = await RefreshSessionModel.find({ userId });
      expect(family.length).toBe(2);
      expect(family.every((s) => s.revokedAt instanceof Date)).toBe(true);
    });

    it('(c) reusing a used token within the 10 s grace does not revoke: it issues another child (concurrent tabs)', async () => {
      const first = await login();
      const second: Tokens = (await refresh(first.refreshToken)).body.data;

      const again = await refresh(first.refreshToken);
      expect(again.status).toBe(200);
      const third: Tokens = again.body.data;
      expect(jtiOf(third.refreshToken)).not.toBe(jtiOf(second.refreshToken));

      const family = await RefreshSessionModel.find({ userId });
      expect(family.length).toBe(3);
      expect(family.some((s) => s.revokedAt)).toBe(false);
      // Both children are live
      expect((await refresh(second.refreshToken)).status).toBe(200);
      expect((await refresh(third.refreshToken)).status).toBe(200);
    });

    it('two simultaneous refreshes with the same token both succeed with distinct children', async () => {
      const first = await login();
      const [r1, r2] = await Promise.all([refresh(first.refreshToken), refresh(first.refreshToken)]);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(jtiOf(r1.body.data.refreshToken)).not.toBe(jtiOf(r2.body.data.refreshToken));
      expect(await RefreshSessionModel.countDocuments({ userId, revokedAt: { $exists: true } })).toBe(0);
    });

    it('rejects an unknown jti, an expired session and a revoked session with a generic 401', async () => {
      const first = await login();
      const refreshSecret = process.env.JWT_REFRESH_SECRET!;

      const unknown = jsonwebtoken.sign({ sub: userId }, refreshSecret, { algorithm: 'HS256', expiresIn: '7d', jwtid: 'does-not-exist' });
      const unknownRes = await refresh(unknown);
      expect(unknownRes.status).toBe(401);
      expect(unknownRes.body.error).toHaveProperty('code', 'UNAUTHORIZED');

      await RefreshSessionModel.updateOne({ jti: jtiOf(first.refreshToken) }, { expiresAt: new Date(Date.now() - 1000) });
      expect((await refresh(first.refreshToken)).status).toBe(401);

      const second = await login();
      await RefreshSessionModel.updateOne({ jti: jtiOf(second.refreshToken) }, { revokedAt: new Date() });
      const revoked = await refresh(second.refreshToken);
      expect(revoked.status).toBe(401);
      expect(revoked.body.error.message).toBe(unknownRes.body.error.message);
    });

    it('rejects a refresh for a deleted user and revokes their sessions', async () => {
      const first = await login();
      await UserModel.deleteMany({});
      expect((await refresh(first.refreshToken)).status).toBe(401);
      expect(await RefreshSessionModel.countDocuments({ revokedAt: { $exists: false } })).toBe(0);
    });
  });

  describe('sessions.ts', () => {
    it('rotateSession returns the child and its user; a revoked family fails', async () => {
      const { jti, familyId } = await createSession(userId, { ip: '1.2.3.4', ua: 'jest' });
      const child = await rotateSession(jti);
      expect(child.familyId).toBe(familyId);
      expect(child.userId).toBe(userId);
      expect(child.jti).not.toBe(jti);

      await revokeFamily(familyId);
      await expect(rotateSession(child.jti)).rejects.toBeInstanceOf(AppError);
      await expect(rotateSession(child.jti)).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
    });

    it('a revocation that lands between claiming the parent and inserting the child leaves no live token', async () => {
      const { jti, familyId } = await createSession(userId, {});
      // Simulate the race: the family is revoked right before the child is inserted, so the revocation cannot see it
      const realCreate = RefreshSessionModel.create.bind(RefreshSessionModel);
      const spy = jest.spyOn(RefreshSessionModel, 'create').mockImplementationOnce((async (doc: object) => {
        await RefreshSessionModel.updateMany({ familyId }, { revokedAt: new Date() });
        return realCreate(doc as never);
      }) as never);
      await expect(rotateSession(jti)).rejects.toMatchObject({ statusCode: 401 });
      spy.mockRestore();
      expect(await RefreshSessionModel.countDocuments({ familyId })).toBe(2);
      expect(await RefreshSessionModel.countDocuments({ familyId, revokedAt: { $exists: false } })).toBe(0);
    });
  });

  describe('logout (POST /api/auth/logout)', () => {
    it('(d) invalidates the refresh token and is idempotent (always 204)', async () => {
      const { refreshToken } = await login();

      const out = await request(app).post('/api/auth/logout').send({ refreshToken });
      expect(out.status).toBe(204);
      expect((await refresh(refreshToken)).status).toBe(401);

      expect((await request(app).post('/api/auth/logout').send({ refreshToken })).status).toBe(204);
      expect((await request(app).post('/api/auth/logout').send({ refreshToken: 'garbage' })).status).toBe(204);
      expect((await request(app).post('/api/auth/logout').send({})).status).toBe(204);
    });

    it('revokes the whole family, even when called with an older (already used) token', async () => {
      const first = await login();
      const second: Tokens = (await refresh(first.refreshToken)).body.data;

      expect((await request(app).post('/api/auth/logout').send({ refreshToken: first.refreshToken })).status).toBe(204);
      expect((await refresh(second.refreshToken)).status).toBe(401);
    });

    it('does not touch other sessions of the same user', async () => {
      const a = await login();
      const b = await login();
      await request(app).post('/api/auth/logout').send({ refreshToken: a.refreshToken });
      expect((await refresh(b.refreshToken)).status).toBe(200);
    });
  });

  describe('logout-all and session list', () => {
    it('requires authentication', async () => {
      expect((await request(app).post('/api/auth/logout-all')).status).toBe(401);
      expect((await request(app).get('/api/auth/sessions')).status).toBe(401);
    });

    it('GET /sessions lists one live row per family without exposing the family id', async () => {
      const a = await login();
      const b = await login();
      const rotated: Tokens = (await refresh(a.refreshToken)).body.data;

      const res = await request(app)
        .get('/api/auth/sessions')
        .set('Authorization', `Bearer ${b.accessToken}`);
      expect(res.status).toBe(200);
      const rows = res.body.data as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([jtiOf(b.refreshToken), jtiOf(rotated.refreshToken)]));
      expect(ids).not.toContain(jtiOf(a.refreshToken)); // used parent is not listed
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(['createdAt', 'current', 'id', 'ip', 'ua']);
        expect(row.current).toBe(false);
        expect(row.ua).toBe('jest-agent');
      }
    });

    it('GET /sessions does not list revoked or expired sessions, nor other users', async () => {
      const a = await login();
      const b = await login();
      const c = await login();
      await RefreshSessionModel.updateOne({ jti: jtiOf(b.refreshToken) }, { revokedAt: new Date() });
      await RefreshSessionModel.updateOne({ jti: jtiOf(c.refreshToken) }, { expiresAt: new Date(Date.now() - 1000) });
      await RefreshSessionModel.create({
        jti: 'other-user-session',
        familyId: 'other-family',
        userId: '64b000000000000000000000',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const res = await request(app).get('/api/auth/sessions').set('Authorization', `Bearer ${a.accessToken}`);
      expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([jtiOf(a.refreshToken)]);
    });

    it('logout-all revokes every session of the user and answers 204', async () => {
      const a = await login();
      const b = await login();

      const out = await request(app).post('/api/auth/logout-all').set('Authorization', `Bearer ${a.accessToken}`);
      expect(out.status).toBe(204);
      expect((await refresh(a.refreshToken)).status).toBe(401);
      expect((await refresh(b.refreshToken)).status).toBe(401);

      const list = await request(app).get('/api/auth/sessions').set('Authorization', `Bearer ${a.accessToken}`);
      expect(list.body.data).toEqual([]);
    });
  });

  describe('password change', () => {
    it('(e) changing the password revokes every refresh session of the user', async () => {
      const a = await login();
      const b = await login();

      const res = await request(app)
        .post('/api/users/change-password')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ currentPassword: PASSWORD, newPassword: 'brandnewpass456' });
      expect(res.status).toBe(204);

      expect((await refresh(a.refreshToken)).status).toBe(401);
      expect((await refresh(b.refreshToken)).status).toBe(401);
      expect(await RefreshSessionModel.countDocuments({ userId, revokedAt: { $exists: false } })).toBe(0);
    });

    it('a rejected password change (wrong current password) leaves the sessions alone', async () => {
      const a = await login();
      const res = await request(app)
        .post('/api/users/change-password')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ currentPassword: 'wrong-password', newPassword: 'brandnewpass456' });
      expect(res.status).toBe(400);
      expect((await refresh(a.refreshToken)).status).toBe(200);
    });
  });
});
