import request from 'supertest';
import bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import app from '../index.js';
import { UserModel } from '../models/User.js';
import { AuthTokenModel } from '../models/AuthToken.js';
import { RefreshSessionModel } from '../models/RefreshSession.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { createAuthToken, consumeAuthToken } from '../modules/auth/passwordReset.js';
import { getTestOutbox, clearTestOutbox } from '../services/mailer.js';
import { CSRF_HEADERS, RT_COOKIE, refreshTokenOf } from './authCookieHelpers.js';

const EMAIL = 'resetme@example.com';
const OLD_PASSWORD = 'old-password-123';
const NEW_PASSWORD = 'brand-new-password-456';

/** Raw token of the last email sent to `to` (the link carries it as ?token=). */
function tokenFromOutbox(to: string): string {
  const mails = getTestOutbox().filter((m) => m.to === to);
  expect(mails.length).toBeGreaterThan(0);
  const link = mails[mails.length - 1].link;
  const token = new URL(link).searchParams.get('token');
  expect(token).toBeTruthy();
  return token!;
}

describe('Auth - password reset (POST /api/auth/forgot, /api/auth/reset)', () => {
  let userId: string;

  beforeAll(async () => {
    await connectDB();
    await AuthTokenModel.init();
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await AuthTokenModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
    clearTestOutbox();
    const user = await UserModel.create({
      email: EMAIL,
      username: 'resetuser',
      passwordHash: await bcrypt.hash(OLD_PASSWORD, 12),
    });
    userId = user._id.toString();
  });

  afterAll(async () => {
    await UserModel.deleteMany({});
    await AuthTokenModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
    await disconnectDB();
  });

  describe('POST /forgot', () => {
    it('unknown email: 202, the same body as a known email, and no email is sent', async () => {
      const unknown = await request(app).post('/api/auth/forgot').send({ email: 'nobody@example.com' });
      const known = await request(app).post('/api/auth/forgot').send({ email: EMAIL });

      expect(unknown.status).toBe(202);
      expect(known.status).toBe(202);
      expect(unknown.body.success).toBe(true);
      // Same body (timestamp aside): nothing tells the caller whether the account exists
      const strip = ({ timestamp, ...rest }: Record<string, unknown>) => rest;
      expect(strip(unknown.body)).toEqual(strip(known.body));

      expect(getTestOutbox().filter((m) => m.to === 'nobody@example.com')).toHaveLength(0);
      expect(await AuthTokenModel.countDocuments({})).toBe(1); // only the known user got a token
    });

    it('known email: sends one reset email whose link carries a token stored only as its sha256', async () => {
      const res = await request(app).post('/api/auth/forgot').send({ email: EMAIL.toUpperCase() });
      expect(res.status).toBe(202);

      const mails = getTestOutbox();
      expect(mails).toHaveLength(1);
      expect(mails[0]).toMatchObject({ to: EMAIL, template: 'reset' });
      const raw = tokenFromOutbox(EMAIL);
      expect(mails[0].link).toContain('/reset-password?token=');

      const stored = await AuthTokenModel.find({ userId });
      expect(stored).toHaveLength(1);
      expect(stored[0].purpose).toBe('reset');
      expect(stored[0].tokenHash).toBe(createHash('sha256').update(raw).digest('hex'));
      expect(JSON.stringify(stored[0].toObject())).not.toContain(raw);
      // 30 minutes of life
      const ttlMin = (stored[0].expiresAt.getTime() - stored[0].createdAt.getTime()) / 60_000;
      expect(ttlMin).toBeGreaterThan(29.9);
      expect(ttlMin).toBeLessThan(30.1);
    });

    it('uses the locale of the request for the email (es) and falls back to en for an unknown one', async () => {
      await request(app).post('/api/auth/forgot').send({ email: EMAIL, locale: 'es' });
      expect(getTestOutbox()[0].locale).toBe('es');
      await AuthTokenModel.deleteMany({}); // skip the per-account cooldown
      clearTestOutbox();
      await request(app).post('/api/auth/forgot').send({ email: EMAIL, locale: 'xx' });
      expect(getTestOutbox()[0].locale).toBe('en');
    });

    it('a second request right after the first does not send another email (per-account cooldown)', async () => {
      await request(app).post('/api/auth/forgot').send({ email: EMAIL });
      const again = await request(app).post('/api/auth/forgot').send({ email: EMAIL });
      expect(again.status).toBe(202);
      expect(getTestOutbox()).toHaveLength(1);
    });

    it('a new reset token invalidates the older unused reset link', async () => {
      const first = await createAuthToken(userId, 'reset', 30);
      await createAuthToken(userId, 'reset', 30);
      await expect(consumeAuthToken(first, 'reset')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects a body without a valid email with 400', async () => {
      expect((await request(app).post('/api/auth/forgot').send({})).status).toBe(400);
      expect((await request(app).post('/api/auth/forgot').send({ email: 'nope' })).status).toBe(400);
    });
  });

  describe('POST /reset', () => {
    it('sets the new password, revokes every session, and the old refresh cookie stops working', async () => {
      const loginRes = await request(app).post('/api/auth/login').send({ email: EMAIL, password: OLD_PASSWORD });
      expect(loginRes.status).toBe(200);
      const oldRefresh = refreshTokenOf(loginRes)!;
      const refresh = (token: string) =>
        request(app).post('/api/auth/refresh').set(CSRF_HEADERS).set('Cookie', `${RT_COOKIE}=${token}`);

      const secondLogin = await request(app).post('/api/auth/login').send({ email: EMAIL, password: OLD_PASSWORD });
      const otherDevice = refreshTokenOf(secondLogin)!;

      await request(app).post('/api/auth/forgot').send({ email: EMAIL });
      const token = tokenFromOutbox(EMAIL);
      const res = await request(app).post('/api/auth/reset').send({ token, password: NEW_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Every session of the user is gone
      expect(await RefreshSessionModel.countDocuments({ userId, revokedAt: { $exists: false } })).toBe(0);
      expect((await refresh(oldRefresh)).status).toBe(401);
      expect((await refresh(otherDevice)).status).toBe(401);

      // New password works, old one does not
      expect((await request(app).post('/api/auth/login').send({ email: EMAIL, password: OLD_PASSWORD })).status).toBe(401);
      expect((await request(app).post('/api/auth/login').send({ email: EMAIL, password: NEW_PASSWORD })).status).toBe(200);
    });

    it('stores the new password with bcrypt cost 12', async () => {
      const token = await createAuthToken(userId, 'reset', 30);
      await request(app).post('/api/auth/reset').send({ token, password: NEW_PASSWORD });
      const user = await UserModel.findById(userId);
      expect(user!.passwordHash).toMatch(/^\$2[aby]\$12\$/);
      expect(await bcrypt.compare(NEW_PASSWORD, user!.passwordHash)).toBe(true);
    });

    it('also marks the email as verified (the user proved control of the inbox)', async () => {
      expect((await UserModel.findById(userId))!.emailVerifiedAt).toBeFalsy();
      const token = await createAuthToken(userId, 'reset', 30);
      await request(app).post('/api/auth/reset').send({ token, password: NEW_PASSWORD });
      expect((await UserModel.findById(userId))!.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('an expired token (older than its 30 minutes) fails and leaves the password alone', async () => {
      const token = await createAuthToken(userId, 'reset', 30);
      // Thirty-one minutes later
      await AuthTokenModel.updateOne({ userId }, { $set: { expiresAt: new Date(Date.now() - 60_000) } });

      const res = await request(app).post('/api/auth/reset').send({ token, password: NEW_PASSWORD });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Invalid or expired token');
      expect((await request(app).post('/api/auth/login').send({ email: EMAIL, password: OLD_PASSWORD })).status).toBe(200);
    });

    it('a token cannot be used twice', async () => {
      const token = await createAuthToken(userId, 'reset', 30);
      const first = await request(app).post('/api/auth/reset').send({ token, password: NEW_PASSWORD });
      expect(first.status).toBe(200);
      const second = await request(app).post('/api/auth/reset').send({ token, password: 'another-password-789' });
      expect(second.status).toBe(400);
      expect(second.body.error.message).toBe('Invalid or expired token');
      // The first password is still the current one
      expect((await request(app).post('/api/auth/login').send({ email: EMAIL, password: NEW_PASSWORD })).status).toBe(200);
    });

    it('two simultaneous uses of one token: exactly one wins', async () => {
      const token = await createAuthToken(userId, 'reset', 30);
      const results = await Promise.all([
        request(app).post('/api/auth/reset').send({ token, password: NEW_PASSWORD }),
        request(app).post('/api/auth/reset').send({ token, password: 'racing-password-789' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    });

    it('an unknown token gives the same generic 400', async () => {
      const res = await request(app).post('/api/auth/reset').send({ token: 'x'.repeat(43), password: NEW_PASSWORD });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Invalid or expired token');
    });

    it('a verification token cannot reset a password', async () => {
      const token = await createAuthToken(userId, 'verify', 60);
      const res = await request(app).post('/api/auth/reset').send({ token, password: NEW_PASSWORD });
      expect(res.status).toBe(400);
    });

    it('a weak password is rejected with 400 and does NOT burn the token', async () => {
      const token = await createAuthToken(userId, 'reset', 30);
      const weak = await request(app).post('/api/auth/reset').send({ token, password: 'short123' });
      expect(weak.status).toBe(400);
      expect(weak.body.error.code).toBe('VALIDATION_ERROR');
      const ok = await request(app).post('/api/auth/reset').send({ token, password: NEW_PASSWORD });
      expect(ok.status).toBe(200);
    });

    it('accepts 128 characters and rejects 129', async () => {
      const t1 = await createAuthToken(userId, 'reset', 30);
      expect((await request(app).post('/api/auth/reset').send({ token: t1, password: 'a'.repeat(129) })).status).toBe(400);
      expect((await request(app).post('/api/auth/reset').send({ token: t1, password: 'a'.repeat(128) })).status).toBe(200);
    });

    it('requires both token and password', async () => {
      expect((await request(app).post('/api/auth/reset').send({ password: NEW_PASSWORD })).status).toBe(400);
      expect((await request(app).post('/api/auth/reset').send({ token: 'abc' })).status).toBe(400);
    });
  });

  describe('createAuthToken / consumeAuthToken', () => {
    it('hands out 32 random bytes as base64url and consumes them once, returning the user id', async () => {
      const raw = await createAuthToken(userId, 'verify', 60);
      expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(await consumeAuthToken(raw, 'verify')).toBe(userId);
      await expect(consumeAuthToken(raw, 'verify')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('two tokens never collide', async () => {
      const a = await createAuthToken(userId, 'verify', 60);
      const b = await createAuthToken(userId, 'verify', 60);
      expect(a).not.toBe(b);
    });

    it('has a TTL index on expiresAt', async () => {
      const indexes = await AuthTokenModel.collection.indexes();
      expect(indexes.find((i) => i.key.expiresAt === 1)?.expireAfterSeconds).toBe(0);
    });
  });
});
