import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../index.js';
import { UserModel } from '../models/User.js';
import { RefreshSessionModel } from '../models/RefreshSession.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { getAdminEmails, invalidAdminEmailCount } from '../config/admin.js';
import { assertProdConfig } from '../config/assertProdConfig.js';

/**
 * Task O2 (decision D2): the owner is identified by ADMIN_EMAILS (an environment list), never by a field in the
 * database, and only with a VERIFIED address. Review Focus 4: an unverified owner address, a normal user or nobody
 * calling /api/admin/* gets refused, and nothing in any answer tells who the administrators are.
 */

const PASSWORD = 'admin-test-password-1';
const OWNER = 'owner@example.com';

async function createUser(email: string, verified: boolean) {
  const user = await UserModel.create({
    email,
    username: email.split('@')[0],
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    emailVerifiedAt: verified ? new Date() : null,
  });
  const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(login.status).toBe(200);
  return {
    id: user._id.toString(),
    auth: { Authorization: `Bearer ${login.body.data.tokens.accessToken as string}` },
  };
}

describe('getAdminEmails', () => {
  it('lowercases, trims and de-duplicates the list', () => {
    const set = getAdminEmails({ ADMIN_EMAILS: ' Owner@Example.com , b@x.io,owner@example.com ' });
    expect([...set].sort()).toEqual(['b@x.io', 'owner@example.com']);
  });

  it.each([undefined, '', '   ', ' , '])('an unset or empty list (%p) is empty', (value) => {
    expect(getAdminEmails({ ADMIN_EMAILS: value }).size).toBe(0);
  });

  it('ignores entries that are not an email address (they never grant anything) and counts them', () => {
    const env = { ADMIN_EMAILS: 'ok@example.com, not-an-email, @x.io, a@b, two words@x.io' };
    expect([...getAdminEmails(env)]).toEqual(['ok@example.com']);
    expect(invalidAdminEmailCount(env)).toBe(4);
    expect(invalidAdminEmailCount({ ADMIN_EMAILS: 'ok@example.com' })).toBe(0);
    expect(invalidAdminEmailCount({})).toBe(0);
  });

  it('a wildcard-like or oversized entry is not an address', () => {
    expect(getAdminEmails({ ADMIN_EMAILS: '*, *@example.com' }).size).toBe(0);
    expect(getAdminEmails({ ADMIN_EMAILS: `${'a'.repeat(300)}@example.com` }).size).toBe(0);
  });
});

describe('/api/admin', () => {
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    await connectDB();
  });

  beforeEach(async () => {
    process.env = { ...savedEnv, ADMIN_EMAILS: OWNER };
    await UserModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
  });

  afterAll(async () => {
    process.env = savedEnv;
    await UserModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
    await disconnectDB();
  });

  it('(a) a listed and verified address is an administrator and reaches a protected route', async () => {
    const { auth } = await createUser(OWNER, true);
    const me = await request(app).get('/api/admin/me').set(auth);
    expect(me.status).toBe(200);
    expect(me.body.data).toEqual({ isAdmin: true });
    const guarded = await request(app).get('/api/admin/metrics').set(auth);
    expect(guarded.status).toBe(200);
  });

  it('(b) a listed address that is NOT verified is refused (registering with someone else address gives nothing)', async () => {
    const { auth } = await createUser(OWNER, false);
    const guarded = await request(app).get('/api/admin/metrics').set(auth);
    expect(guarded.status).toBe(403);
    expect(guarded.body.error.code).toBe('FORBIDDEN');
    const me = await request(app).get('/api/admin/me').set(auth);
    expect(me.status).toBe(200);
    expect(me.body.data).toEqual({ isAdmin: false });
  });

  it('(b2) verification is required even when REQUIRE_EMAIL_VERIFICATION=false', async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
    const { auth } = await createUser(OWNER, false);
    expect((await request(app).get('/api/admin/metrics').set(auth)).status).toBe(403);
  });

  it('(c) a normal user is refused', async () => {
    const { auth } = await createUser('someone@example.com', true);
    const guarded = await request(app).get('/api/admin/metrics').set(auth);
    expect(guarded.status).toBe(403);
    expect(guarded.body.error.code).toBe('FORBIDDEN');
  });

  it('(c2) with ADMIN_EMAILS unset or empty nobody is an administrator', async () => {
    const { auth } = await createUser(OWNER, true);
    for (const value of [undefined, '']) {
      if (value === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = value;
      expect((await request(app).get('/api/admin/metrics').set(auth)).status).toBe(403);
      expect((await request(app).get('/api/admin/me').set(auth)).body.data).toEqual({
        isAdmin: false,
      });
    }
  });

  it('(c3) every path under /api/admin is guarded, including ones that do not exist (no hint about what exists)', async () => {
    const { auth } = await createUser('someone@example.com', true);
    for (const p of ['/api/admin/metrics', '/api/admin/ping', '/api/admin/nope', '/api/admin/']) {
      expect((await request(app).get(p).set(auth)).status).toBe(403);
    }
    for (const method of ['post', 'put', 'delete'] as const) {
      expect((await request(app)[method]('/api/admin/metrics').set(auth)).status).toBe(403);
    }
  });

  it('(d) without a session it is 401 (also /me)', async () => {
    expect((await request(app).get('/api/admin/me')).status).toBe(401);
    expect((await request(app).get('/api/admin/metrics')).status).toBe(401);
    expect(
      (await request(app).get('/api/admin/metrics').set('Authorization', 'Bearer garbage')).status
    ).toBe(401);
  });

  it('(d2) a valid token of a deleted account is 401, not an administrator', async () => {
    const { id, auth } = await createUser(OWNER, true);
    await UserModel.deleteOne({ _id: id });
    expect((await request(app).get('/api/admin/metrics').set(auth)).status).toBe(401);
    expect((await request(app).get('/api/admin/me').set(auth)).status).toBe(401);
  });

  it('(e) the list does not distinguish upper and lower case', async () => {
    process.env.ADMIN_EMAILS = '  OWNER@Example.COM ';
    const { auth } = await createUser(OWNER, true);
    expect((await request(app).get('/api/admin/metrics').set(auth)).status).toBe(200);
    expect((await request(app).get('/api/admin/me').set(auth)).body.data).toEqual({
      isAdmin: true,
    });
  });

  it('(f) /me of a non-administrator is { isAdmin: false } with no hint about who the administrators are', async () => {
    const { auth } = await createUser('someone@example.com', true);
    const res = await request(app).get('/api/admin/me').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ isAdmin: false });
    expect(JSON.stringify(res.body)).not.toContain('owner');
    expect(JSON.stringify(res.headers)).not.toContain('owner');
    // the refusal of a guarded route does not name them either, and it is the same for "not listed" and "not verified"
    const refused = await request(app).get('/api/admin/metrics').set(auth);
    const unverified = await createUser('late@example.com', false);
    process.env.ADMIN_EMAILS = 'late@example.com';
    const refusedUnverified = await request(app).get('/api/admin/metrics').set(unverified.auth);
    expect(refused.status).toBe(403);
    expect(refusedUnverified.status).toBe(403);
    expect(refusedUnverified.body.error).toEqual(refused.body.error);
    expect(JSON.stringify(refused.body)).not.toContain('owner');
  });

  it('(f2) /me is not cached by anyone', async () => {
    const { auth } = await createUser(OWNER, true);
    const res = await request(app).get('/api/admin/me').set(auth);
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  it('(f3) a User document cannot grant it: nothing in the model decides', async () => {
    const { id, auth } = await createUser('someone@example.com', true);
    // an attacker-controlled write to the user (profile fields, even raw) changes nothing
    await UserModel.collection.updateOne(
      { _id: new (await import('mongoose')).Types.ObjectId(id) },
      { $set: { role: 'admin', isAdmin: true } }
    );
    expect((await request(app).get('/api/admin/metrics').set(auth)).status).toBe(403);
  });
});

describe('assertProdConfig and ADMIN_EMAILS', () => {
  const validProd = (): NodeJS.ProcessEnv => ({
    NODE_ENV: 'production',
    CORS_ORIGIN: 'https://app.mockia.io',
    MONGODB_URI: 'mongodb://mockia:s3cr3t-Pr0d-pass@mongo:27017/mockia?authSource=admin',
    APP_URL: 'https://app.mockia.io',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
  });

  it('(g) accepts an unset, empty or valid list', () => {
    expect(() => assertProdConfig(validProd())).not.toThrow();
    expect(() => assertProdConfig({ ...validProd(), ADMIN_EMAILS: '' })).not.toThrow();
    expect(() =>
      assertProdConfig({ ...validProd(), ADMIN_EMAILS: 'Owner@example.com, b@x.io' })
    ).not.toThrow();
  });

  it('(g) rejects an entry that is not an email address, naming the variable but never echoing the value', () => {
    const secretish = 'hunter2-not-an-email';
    let message = '';
    try {
      assertProdConfig({ ...validProd(), ADMIN_EMAILS: `owner@example.com, ${secretish}` });
    } catch (err) {
      message = String(err);
    }
    expect(message).toMatch(/ADMIN_EMAILS/);
    expect(message).not.toContain(secretish);
    expect(message).not.toContain('owner@example.com');
  });

  it('(g) rejects a wildcard', () => {
    expect(() => assertProdConfig({ ...validProd(), ADMIN_EMAILS: '*' })).toThrow(/ADMIN_EMAILS/);
  });

  it('outside production it never throws', () => {
    expect(() =>
      assertProdConfig({ NODE_ENV: 'development', ADMIN_EMAILS: 'garbage' })
    ).not.toThrow();
  });
});
