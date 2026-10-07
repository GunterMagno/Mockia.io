import request from 'supertest';
import jsonwebtoken from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import app from '../index.js';
import { UserModel } from '../models/User.js';
import { RefreshSessionModel } from '../models/RefreshSession.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { CSRF_HEADERS, RT_COOKIE, cookieAttributes, refreshSetCookie, refreshTokenOf } from './authCookieHelpers.js';

const EMAIL = 'cookie@example.com';
const PASSWORD = 'cookiepass123';
const WEEK_SECONDS = 7 * 24 * 3600;

const jtiOf = (token: string) => (jsonwebtoken.decode(token) as { jti: string }).jti;

const login = (body: Record<string, unknown> = {}) =>
  request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD, ...body });

const refreshWith = (token: string) =>
  request(app).post('/api/auth/refresh').set(CSRF_HEADERS).set('Cookie', `${RT_COOKIE}=${token}`);

const logoutWith = (token: string) =>
  request(app).post('/api/auth/logout').set(CSRF_HEADERS).set('Cookie', `${RT_COOKIE}=${token}`);

/** A cleared cookie: empty value, same Path/HttpOnly/SameSite as when it was set, already expired. */
function expectCleared(res: request.Response): void {
  const line = refreshSetCookie(res);
  expect(line).toBeDefined();
  expect(refreshTokenOf(res)).toBe('');
  const attrs = cookieAttributes(line!);
  expect(attrs['path']).toBe('/api/auth');
  expect(attrs['httponly']).toBe(true);
  expect(attrs['samesite']).toBe('Lax');
  expect(new Date(attrs['expires'] as string).getTime()).toBeLessThan(Date.now());
}

describe('Auth - refresh token in an HttpOnly cookie', () => {
  let userId: string;
  const savedEnv = { NODE_ENV: process.env.NODE_ENV, COOKIE_SAMESITE: process.env.COOKIE_SAMESITE };

  let errorSpy: jest.SpyInstance;

  beforeAll(async () => {
    await connectDB();
    // The error handler logs every expected 401/403/500 of these tests; keep the output readable
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
    const user = await UserModel.create({
      email: EMAIL,
      username: 'cookieuser',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    });
    userId = user._id.toString();
  });

  afterEach(() => {
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    if (savedEnv.COOKIE_SAMESITE === undefined) delete process.env.COOKIE_SAMESITE;
    else process.env.COOKIE_SAMESITE = savedEnv.COOKIE_SAMESITE;
  });

  afterAll(async () => {
    await UserModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
    errorSpy.mockRestore();
    await disconnectDB();
  });

  describe('login', () => {
    it('sets the mockia_rt cookie: HttpOnly, SameSite=Lax, Path=/api/auth, not Secure outside production', async () => {
      const res = await login();
      expect(res.status).toBe(200);

      const line = refreshSetCookie(res);
      expect(line).toBeDefined();
      const attrs = cookieAttributes(line!);
      expect(attrs['httponly']).toBe(true);
      expect(attrs['samesite']).toBe('Lax');
      expect(attrs['path']).toBe('/api/auth');
      expect(attrs['secure']).toBeUndefined();

      // The cookie value is the refresh JWT backed by a stored session of that user
      const token = refreshTokenOf(res)!;
      const session = await RefreshSessionModel.findOne({ jti: jtiOf(token) });
      expect(session!.userId.toString()).toBe(userId);
    });

    it('no longer puts the refresh token in the JSON body', async () => {
      const res = await login();
      const token = refreshTokenOf(res)!;

      expect(res.body.data.tokens).not.toHaveProperty('refreshToken');
      expect(Object.keys(res.body.data.tokens)).toEqual(['accessToken']);
      expect(JSON.stringify(res.body)).not.toContain(token);
    });

    it('is a session cookie (no Max-Age / Expires) unless "remember" is true', async () => {
      for (const body of [{}, { remember: false }]) {
        const attrs = cookieAttributes(refreshSetCookie(await login(body))!);
        expect(attrs['max-age']).toBeUndefined();
        expect(attrs['expires']).toBeUndefined();
      }

      const remembered = await login({ remember: true });
      const attrs = cookieAttributes(refreshSetCookie(remembered)!);
      expect(attrs['max-age']).toBe(String(WEEK_SECONDS));
      expect(attrs['expires']).toBeDefined();
    });

    it('stores the remember choice on the session', async () => {
      const kept = await login({ remember: true });
      const dropped = await login({ remember: false });
      const omitted = await login();
      expect((await RefreshSessionModel.findOne({ jti: jtiOf(refreshTokenOf(kept)!) }))!.persistent).toBe(true);
      expect((await RefreshSessionModel.findOne({ jti: jtiOf(refreshTokenOf(dropped)!) }))!.persistent).toBe(false);
      expect((await RefreshSessionModel.findOne({ jti: jtiOf(refreshTokenOf(omitted)!) }))!.persistent).toBe(false);
    });

    it('rejects a non-boolean "remember" with a validation error', async () => {
      const res = await login({ remember: 'maybe' });
      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(refreshSetCookie(res)).toBeUndefined();
    });

    it('does not set a cookie when the credentials are wrong', async () => {
      const res = await login({ password: 'wrong-password' });
      expect(res.status).toBe(401);
      expect(refreshSetCookie(res)).toBeUndefined();
    });

    it('marks the cookie Secure in production', async () => {
      process.env.NODE_ENV = 'production';
      const res = await login();
      expect(res.status).toBe(200);
      expect(cookieAttributes(refreshSetCookie(res)!)['secure']).toBe(true);
    });

    it('takes SameSite from COOKIE_SAMESITE (lax default, strict, none forces Secure, unknown falls back to Lax)', async () => {
      process.env.COOKIE_SAMESITE = 'strict';
      let attrs = cookieAttributes(refreshSetCookie(await login())!);
      expect(attrs['samesite']).toBe('Strict');
      expect(attrs['secure']).toBeUndefined();

      process.env.COOKIE_SAMESITE = 'none';
      attrs = cookieAttributes(refreshSetCookie(await login())!);
      expect(attrs['samesite']).toBe('None');
      expect(attrs['secure']).toBe(true);

      process.env.COOKIE_SAMESITE = 'NONE-OF-THE-ABOVE';
      attrs = cookieAttributes(refreshSetCookie(await login())!);
      expect(attrs['samesite']).toBe('Lax');

      process.env.COOKIE_SAMESITE = ' Lax ';
      attrs = cookieAttributes(refreshSetCookie(await login())!);
      expect(attrs['samesite']).toBe('Lax');
    });
  });

  describe('refresh (POST /api/auth/refresh)', () => {
    it('answers 403 FORBIDDEN without the X-Requested-With header, without consuming the token', async () => {
      const token = refreshTokenOf(await login())!;

      const res = await request(app).post('/api/auth/refresh').set('Cookie', `${RT_COOKIE}=${token}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toHaveProperty('code', 'FORBIDDEN');
      expect(refreshSetCookie(res)).toBeUndefined();
      expect((await RefreshSessionModel.findOne({ jti: jtiOf(token) }))!.usedAt).toBeUndefined();
    });

    it('answers 403 when X-Requested-With has another value', async () => {
      const token = refreshTokenOf(await login())!;
      for (const value of ['XMLHttpRequest', 'Mockia', '']) {
        const res = await request(app)
          .post('/api/auth/refresh')
          .set('X-Requested-With', value)
          .set('Cookie', `${RT_COOKIE}=${token}`);
        expect(res.status).toBe(403);
      }
    });

    it('rotates the session from the cookie: new access token + user in the body, new refresh token in a new cookie', async () => {
      const first = refreshTokenOf(await login())!;

      const res = await refreshWith(first);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        accessToken: expect.any(String),
        user: expect.objectContaining({ id: userId, email: EMAIL, username: 'cookieuser' }),
      });
      expect(res.body.data).not.toHaveProperty('refreshToken');
      expect(res.body.data.user).not.toHaveProperty('passwordHash');

      const second = refreshTokenOf(res)!;
      expect(second).not.toBe(first);
      expect(JSON.stringify(res.body)).not.toContain(second);
      const attrs = cookieAttributes(refreshSetCookie(res)!);
      expect(attrs['httponly']).toBe(true);
      expect(attrs['path']).toBe('/api/auth');
      expect((await RefreshSessionModel.findOne({ jti: jtiOf(first) }))!.usedAt).toBeInstanceOf(Date);
      expect(await RefreshSessionModel.findOne({ jti: jtiOf(second) })).not.toBeNull();
    });

    it('keeps the remember choice across rotations (persistent cookie stays persistent, session cookie stays session)', async () => {
      let remembered = refreshTokenOf(await login({ remember: true }))!;
      let transient = refreshTokenOf(await login({ remember: false }))!;

      for (let i = 0; i < 2; i++) {
        const r = await refreshWith(remembered);
        expect(r.status).toBe(200);
        expect(cookieAttributes(refreshSetCookie(r)!)['max-age']).toBe(String(WEEK_SECONDS));
        remembered = refreshTokenOf(r)!;
        expect((await RefreshSessionModel.findOne({ jti: jtiOf(remembered) }))!.persistent).toBe(true);

        const t = await refreshWith(transient);
        expect(t.status).toBe(200);
        const attrs = cookieAttributes(refreshSetCookie(t)!);
        expect(attrs['max-age']).toBeUndefined();
        expect(attrs['expires']).toBeUndefined();
        transient = refreshTokenOf(t)!;
        expect((await RefreshSessionModel.findOne({ jti: jtiOf(transient) }))!.persistent).toBe(false);
      }
    });

    it('without a cookie answers 401 and clears the cookie', async () => {
      const res = await request(app).post('/api/auth/refresh').set(CSRF_HEADERS);
      expect(res.status).toBe(401);
      expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
      expectCleared(res);
    });

    it('does not accept the refresh token in the body (no fallback)', async () => {
      const token = refreshTokenOf(await login())!;
      const res = await request(app).post('/api/auth/refresh').set(CSRF_HEADERS).send({ refreshToken: token });
      expect(res.status).toBe(401);
      expectCleared(res);
      expect((await RefreshSessionModel.findOne({ jti: jtiOf(token) }))!.usedAt).toBeUndefined();
    });

    it('with an invalid, tampered or foreign-typed cookie answers 401 and clears it', async () => {
      const valid = refreshTokenOf(await login())!;
      const tampered = `${valid.slice(0, -2)}xx`;
      const accessAsRefresh = (await login()).body.data.tokens.accessToken as string;

      for (const bad of ['garbage', tampered, accessAsRefresh]) {
        const res = await refreshWith(bad);
        expect(res.status).toBe(401);
        expectCleared(res);
      }
    });

    it('treats a JSON-looking cookie value as an invalid token (401), not a server error', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .set(CSRF_HEADERS)
        .set('Cookie', `${RT_COOKIE}=j:${encodeURIComponent('{"a":1}')}`);
      expect(res.status).toBe(401);
      expectCleared(res);
    });

    it('a token reused after the grace window revokes the family and clears the cookie', async () => {
      const first = refreshTokenOf(await login())!;
      const second = refreshTokenOf(await refreshWith(first))!;
      await RefreshSessionModel.updateOne({ jti: jtiOf(first) }, { usedAt: new Date(Date.now() - 11_000) });

      const reuse = await refreshWith(first);
      expect(reuse.status).toBe(401);
      expectCleared(reuse);
      expect((await refreshWith(second)).status).toBe(401);
    });

    it('does not clear the cookie on a server error (the user may still have a valid session)', async () => {
      const token = refreshTokenOf(await login())!;
      const spy = jest.spyOn(RefreshSessionModel, 'findOneAndUpdate').mockImplementationOnce((() => {
        throw new Error('database unavailable');
      }) as never);
      try {
        const res = await refreshWith(token);
        expect(res.status).toBe(500);
        expect(refreshSetCookie(res)).toBeUndefined();
      } finally {
        spy.mockRestore();
      }
      // Nothing was consumed: the same cookie still works
      expect((await refreshWith(token)).status).toBe(200);
    });
  });

  describe('logout (POST /api/auth/logout)', () => {
    it('answers 403 without the X-Requested-With header and leaves the session untouched', async () => {
      const token = refreshTokenOf(await login())!;

      const res = await request(app).post('/api/auth/logout').set('Cookie', `${RT_COOKIE}=${token}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toHaveProperty('code', 'FORBIDDEN');
      expect(refreshSetCookie(res)).toBeUndefined();
      expect((await refreshWith(token)).status).toBe(200);
    });

    it('revokes the session of the cookie, answers 204 and clears the cookie', async () => {
      const token = refreshTokenOf(await login())!;

      const res = await logoutWith(token);
      expect(res.status).toBe(204);
      expectCleared(res);
      expect((await refreshWith(token)).status).toBe(401);
    });

    it('is idempotent: 204 + cleared cookie with no cookie, an invalid one or an already revoked one', async () => {
      const token = refreshTokenOf(await login())!;
      await logoutWith(token);

      for (const res of [
        await request(app).post('/api/auth/logout').set(CSRF_HEADERS),
        await logoutWith('garbage'),
        await logoutWith(token),
      ]) {
        expect(res.status).toBe(204);
        expectCleared(res);
      }
    });

    it('ignores a refresh token sent in the body (cookie only)', async () => {
      const token = refreshTokenOf(await login())!;
      const res = await request(app).post('/api/auth/logout').set(CSRF_HEADERS).send({ refreshToken: token });
      expect(res.status).toBe(204);
      expect((await refreshWith(token)).status).toBe(200);
    });

    it('clears the cookie even when revoking the session fails', async () => {
      const token = refreshTokenOf(await login())!;
      const spy = jest.spyOn(RefreshSessionModel, 'findOne').mockImplementationOnce((() => {
        throw new Error('database unavailable');
      }) as never);
      try {
        const res = await logoutWith(token);
        expect(res.status).toBe(500);
        expectCleared(res);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('session list', () => {
    it('flags as current the session of the cookie the request carries', async () => {
      const a = await login();
      const b = await login();
      const tokenA = refreshTokenOf(a)!;
      const accessB = b.body.data.tokens.accessToken as string;

      const asB = await request(app)
        .get('/api/auth/sessions')
        .set('Authorization', `Bearer ${accessB}`)
        .set('Cookie', `${RT_COOKIE}=${refreshTokenOf(b)!}`);
      const current = asB.body.data.filter((s: { current: boolean }) => s.current);
      expect(current).toHaveLength(1);
      expect(current[0].id).toBe(jtiOf(refreshTokenOf(b)!));

      // Without the cookie nothing is current (e.g. an API client using only the Bearer token)
      const noCookie = await request(app).get('/api/auth/sessions').set('Authorization', `Bearer ${accessB}`);
      expect(noCookie.body.data.every((s: { current: boolean }) => s.current === false)).toBe(true);

      // A cookie of another session of the same user marks that one, and still after it rotated
      const rotatedA = refreshTokenOf(await refreshWith(tokenA))!;
      const asA = await request(app)
        .get('/api/auth/sessions')
        .set('Authorization', `Bearer ${accessB}`)
        .set('Cookie', `${RT_COOKIE}=${rotatedA}`);
      expect(asA.body.data.filter((s: { current: boolean }) => s.current).map((s: { id: string }) => s.id)).toEqual([
        jtiOf(rotatedA),
      ]);
    });

    it('never flags as current the sessions of another user, even with a stolen cookie', async () => {
      const other = await UserModel.create({
        email: 'other-cookie@example.com',
        username: 'othercookie',
        passwordHash: await bcrypt.hash(PASSWORD, 10),
      });
      const otherLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: other.email, password: PASSWORD });
      const mine = await login();

      const res = await request(app)
        .get('/api/auth/sessions')
        .set('Authorization', `Bearer ${mine.body.data.tokens.accessToken}`)
        .set('Cookie', `${RT_COOKIE}=${refreshTokenOf(otherLogin)!}`);
      expect(res.status).toBe(200);
      expect(res.body.data.every((s: { current: boolean }) => s.current === false)).toBe(true);
    });
  });

  describe('browser-like flow (cookie jar)', () => {
    it('login -> refresh -> logout works with the cookie alone, no tokens in bodies', async () => {
      const agent = request.agent(app);

      const loggedIn = await agent.post('/api/auth/login').send({ email: EMAIL, password: PASSWORD, remember: true });
      expect(loggedIn.status).toBe(200);

      const refreshed = await agent.post('/api/auth/refresh').set(CSRF_HEADERS);
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.data.accessToken).toEqual(expect.any(String));

      const me = await agent.get('/api/auth/me').set('Authorization', `Bearer ${refreshed.body.data.accessToken}`);
      expect(me.status).toBe(200);
      expect(me.body.user).toHaveProperty('email', EMAIL);

      expect((await agent.post('/api/auth/logout').set(CSRF_HEADERS)).status).toBe(204);
      const after = await agent.post('/api/auth/refresh').set(CSRF_HEADERS);
      expect(after.status).toBe(401);
    });
  });

  describe('CORS', () => {
    it('allows the X-Requested-With header (with credentials) for the configured origin', async () => {
      const res = await request(app)
        .options('/api/auth/refresh')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'x-requested-with');
      expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('x-requested-with');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });
  });
});
