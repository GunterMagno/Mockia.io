import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../index.js';
import { UserModel } from '../models/User.js';
import { AuthTokenModel } from '../models/AuthToken.js';
import { RefreshSessionModel } from '../models/RefreshSession.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { createAuthToken } from '../modules/auth/passwordReset.js';
import * as mailer from '../services/mailer.js';
import { getTestOutbox, clearTestOutbox } from '../services/mailer.js';
import { isEmailVerificationRequired } from '../middlewares/requireVerifiedEmail.js';
import { backfillEmailVerified } from '../modules/auth/backfillEmailVerified.js';

const PASSWORD = 'verify-me-password-1';

async function createUser(email: string, verified = false) {
  const user = await UserModel.create({
    email,
    username: email.split('@')[0],
    passwordHash: await bcrypt.hash(PASSWORD, 12),
    emailVerifiedAt: verified ? new Date() : null,
  });
  const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return { id: user._id.toString(), auth: { Authorization: `Bearer ${login.body.data.tokens.accessToken as string}` } };
}

const linkToken = (to: string) => new URL(getTestOutbox().filter((m) => m.to === to).pop()!.link).searchParams.get('token')!;

describe('Email verification', () => {
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    await connectDB();
  });

  beforeEach(async () => {
    process.env = { ...savedEnv };
    await UserModel.deleteMany({});
    await AuthTokenModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
    clearTestOutbox();
  });

  afterAll(async () => {
    process.env = savedEnv;
    await UserModel.deleteMany({});
    await AuthTokenModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
    await disconnectDB();
  });

  describe('register sends a verification email', () => {
    it('201 and a verify email with a /verify-email link; the user starts unverified', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'new@example.com', password: PASSWORD, username: 'newbie', locale: 'es' });
      expect(res.status).toBe(201);
      expect(res.body.data.emailVerifiedAt ?? null).toBeNull();

      const mails = getTestOutbox();
      expect(mails).toHaveLength(1);
      expect(mails[0]).toMatchObject({ to: 'new@example.com', template: 'verify', locale: 'es' });
      expect(mails[0].link).toContain('/verify-email?token=');
      const stored = await AuthTokenModel.find({});
      expect(stored).toHaveLength(1);
      expect(stored[0].purpose).toBe('verify');
      const ttlH = (stored[0].expiresAt.getTime() - stored[0].createdAt.getTime()) / 3_600_000;
      expect(ttlH).toBeGreaterThan(23.9);
      expect(ttlH).toBeLessThan(24.1);
    });

    it('registration still succeeds when the mailer fails', async () => {
      const spy = jest.spyOn(mailer, 'sendMail').mockRejectedValue(new Error('smtp down'));
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const res = await request(app)
          .post('/api/auth/register')
          .send({ email: 'fail@example.com', password: PASSWORD, username: 'failer' });
        expect(res.status).toBe(201);
        expect(await UserModel.countDocuments({ email: 'fail@example.com' })).toBe(1);
      } finally {
        spy.mockRestore();
        errSpy.mockRestore();
      }
    });
  });

  describe('POST /verify', () => {
    it('confirms the email, once', async () => {
      const { id } = await createUser('v1@example.com');
      const token = await createAuthToken(id, 'verify', 60 * 24);

      const ok = await request(app).post('/api/auth/verify').send({ token });
      expect(ok.status).toBe(200);
      expect((await UserModel.findById(id))!.emailVerifiedAt).toBeInstanceOf(Date);

      const again = await request(app).post('/api/auth/verify').send({ token });
      expect(again.status).toBe(400);
      expect(again.body.error.message).toBe('Invalid or expired token');
    });

    it('an expired verification token fails', async () => {
      const { id } = await createUser('v2@example.com');
      const token = await createAuthToken(id, 'verify', 60 * 24);
      await AuthTokenModel.updateOne({ userId: id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await request(app).post('/api/auth/verify').send({ token })).status).toBe(400);
      expect((await UserModel.findById(id))!.emailVerifiedAt).toBeFalsy();
    });

    it('a reset token cannot verify an email', async () => {
      const { id } = await createUser('v3@example.com');
      const token = await createAuthToken(id, 'reset', 30);
      expect((await request(app).post('/api/auth/verify').send({ token })).status).toBe(400);
    });

    it('requires a token', async () => {
      expect((await request(app).post('/api/auth/verify').send({})).status).toBe(400);
    });

    it('/me and the profile expose emailVerifiedAt', async () => {
      const { id, auth } = await createUser('v4@example.com');
      const before = await request(app).get('/api/auth/me').set(auth);
      expect(before.body.user.emailVerifiedAt ?? null).toBeNull();
      await request(app).post('/api/auth/verify').send({ token: await createAuthToken(id, 'verify', 60) });
      const after = await request(app).get('/api/auth/me').set(auth);
      expect(typeof after.body.user.emailVerifiedAt).toBe('string');
      const login = await request(app).post('/api/auth/login').send({ email: 'v4@example.com', password: PASSWORD });
      expect(typeof login.body.data.user.emailVerifiedAt).toBe('string');
    });
  });

  describe('POST /verify/resend', () => {
    it('requires authentication', async () => {
      expect((await request(app).post('/api/auth/verify/resend').send({})).status).toBe(401);
    });

    it('sends a new verification email to an unverified user', async () => {
      const { auth } = await createUser('r1@example.com');
      const res = await request(app).post('/api/auth/verify/resend').set(auth).send({ locale: 'zh' });
      expect(res.status).toBe(202);
      expect(getTestOutbox()).toHaveLength(1);
      expect(getTestOutbox()[0]).toMatchObject({ to: 'r1@example.com', template: 'verify', locale: 'zh' });
      // the link works
      const verify = await request(app).post('/api/auth/verify').send({ token: linkToken('r1@example.com') });
      expect(verify.status).toBe(200);
    });

    it('is a no-op for an already verified user', async () => {
      const { auth } = await createUser('r2@example.com', true);
      const res = await request(app).post('/api/auth/verify/resend').set(auth).send({});
      expect(res.status).toBe(202);
      expect(getTestOutbox()).toHaveLength(0);
      expect(await AuthTokenModel.countDocuments({})).toBe(0);
    });

    it('is rate limited per user', async () => {
      const { auth } = await createUser('r3@example.com');
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) {
        statuses.push((await request(app).post('/api/auth/verify/resend').set(auth).send({})).status);
      }
      expect(statuses.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
      expect(statuses.slice(5)).toEqual([429, 429]);
    });
  });

  describe('requireVerifiedEmail (REQUIRE_EMAIL_VERIFICATION)', () => {
    it('is on by default only in production', () => {
      expect(isEmailVerificationRequired({ NODE_ENV: 'production' })).toBe(true);
      expect(isEmailVerificationRequired({ NODE_ENV: 'development' })).toBe(false);
      expect(isEmailVerificationRequired({ NODE_ENV: 'test' })).toBe(false);
      expect(isEmailVerificationRequired({})).toBe(false);
    });

    it('the variable overrides the default in both directions', () => {
      expect(isEmailVerificationRequired({ NODE_ENV: 'production', REQUIRE_EMAIL_VERIFICATION: 'false' })).toBe(false);
      expect(isEmailVerificationRequired({ NODE_ENV: 'development', REQUIRE_EMAIL_VERIFICATION: 'true' })).toBe(true);
      expect(isEmailVerificationRequired({ NODE_ENV: 'development', REQUIRE_EMAIL_VERIFICATION: ' TRUE ' })).toBe(true);
      // anything that is not an explicit true/false falls back to the default
      expect(isEmailVerificationRequired({ NODE_ENV: 'production', REQUIRE_EMAIL_VERIFICATION: 'maybe' })).toBe(true);
    });

    const gated: Array<[string, string]> = [
      ['post', '/api/ai/generate-mock-api-spec'],
      ['post', '/api/ai/generate-and-save'],
      ['post', '/api/billing/checkout'],
    ];

    it.each(gated)('enforced: an unverified user gets 403 EMAIL_NOT_VERIFIED on %s %s', async (method, path) => {
      process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
      const { auth } = await createUser('gate1@example.com');
      const res = await (request(app) as any)[method](path).set(auth).send({ plan: 'pro' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      expect(res.body.error.message).toMatch(/verif/i);
    });

    it.each(gated)('enforced: a verified user is let through on %s %s', async (method, path) => {
      process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
      const { auth } = await createUser('gate2@example.com', true);
      const res = await (request(app) as any)[method](path).set(auth).send({ plan: 'pro' });
      expect(res.body?.error?.code).not.toBe('EMAIL_NOT_VERIFIED');
    });

    it('not enforced (default in test): an unverified user is not blocked', async () => {
      delete process.env.REQUIRE_EMAIL_VERIFICATION;
      const { auth } = await createUser('gate3@example.com');
      const res = await request(app).post('/api/billing/checkout').set(auth).send({ plan: 'pro' });
      expect(res.body?.error?.code).not.toBe('EMAIL_NOT_VERIFIED');
    });

    it('verifying the email lifts the block', async () => {
      process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
      const { id, auth } = await createUser('gate4@example.com');
      expect((await request(app).post('/api/billing/checkout').set(auth).send({ plan: 'pro' })).status).toBe(403);
      await request(app).post('/api/auth/verify').send({ token: await createAuthToken(id, 'verify', 60) });
      const res = await request(app).post('/api/billing/checkout').set(auth).send({ plan: 'pro' });
      expect(res.body?.error?.code).not.toBe('EMAIL_NOT_VERIFIED');
    });

    // Cancelling must never be harder than subscribing: an unverified legacy subscriber (the backfill script is not
    // runnable from the production image) still reaches the Stripe portal to cancel or fix the card.
    it('does not gate the billing portal', async () => {
      process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
      const { auth } = await createUser('gate6@example.com');
      const res = await request(app).post('/api/billing/portal').set(auth).send({});
      expect(res.body?.error?.code).not.toBe('EMAIL_NOT_VERIFIED');
      expect(res.status).not.toBe(403);
    });

    it('does not gate the AI health probe or the billing overview', async () => {
      process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
      const { auth } = await createUser('gate5@example.com');
      const overview = await request(app).get('/api/billing/me').set(auth);
      expect(overview.status).toBe(200);
    });
  });

  describe('backfillEmailVerified', () => {
    it('marks every unverified user as verified and leaves the existing dates alone', async () => {
      const when = new Date('2025-01-01T00:00:00Z');
      await UserModel.create({ email: 'b1@example.com', username: 'b1', passwordHash: 'x' });
      await UserModel.create({ email: 'b2@example.com', username: 'b2', passwordHash: 'x', emailVerifiedAt: when });
      await UserModel.collection.insertOne({ email: 'b3@example.com', username: 'b3', passwordHash: 'x' }); // legacy: no field at all

      const modified = await backfillEmailVerified();
      expect(modified).toBe(2);
      const users = await UserModel.find({}).sort({ email: 1 });
      expect(users.every((u) => u.emailVerifiedAt instanceof Date)).toBe(true);
      expect(users[1].emailVerifiedAt!.toISOString()).toBe(when.toISOString());
      expect(await backfillEmailVerified()).toBe(0);
    });
  });

  describe('test outbox endpoint', () => {
    it('GET /api/__test__/outbox lists the captured emails and DELETE clears them (never mounted in production)', async () => {
      await request(app).post('/api/auth/register').send({ email: 'o@example.com', password: PASSWORD, username: 'outbox' });
      const list = await request(app).get('/api/__test__/outbox');
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({ to: 'o@example.com', template: 'verify' });
      expect((await request(app).delete('/api/__test__/outbox')).status).toBe(204);
      expect((await request(app).get('/api/__test__/outbox')).body.data).toEqual([]);
    });
  });
});
