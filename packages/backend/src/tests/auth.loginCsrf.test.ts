import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../index.js';
import { UserModel } from '../models/User.js';
import { RefreshSessionModel } from '../models/RefreshSession.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { refreshSetCookie } from './authCookieHelpers.js';

/**
 * Login CSRF: a cross-site HTML form can POST application/x-www-form-urlencoded (or text/plain, multipart) without a
 * CORS preflight, and SameSite=Lax cookies are set on top-level POST navigations. If /auth/login accepted such a
 * body, an attacker could plant their own session in the victim's browser. The credential endpoints only accept JSON
 * (which a form cannot send), so the browser always has to go through a preflight that the CORS allow-list rejects.
 */
describe('Auth - credential endpoints only accept JSON (login CSRF)', () => {
  const EMAIL = 'csrf@example.com';
  const PASSWORD = 'csrfpassword123';
  let errorSpy: jest.SpyInstance;

  beforeAll(async () => {
    await connectDB();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
    await UserModel.create({ email: EMAIL, username: 'csrfuser', passwordHash: await bcrypt.hash(PASSWORD, 10) });
  });

  afterAll(async () => {
    errorSpy.mockRestore();
    await UserModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
    await disconnectDB();
  });

  it('rejects an urlencoded login with 415 and sets no cookie', async () => {
    const res = await request(app).post('/api/auth/login').type('form').send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(415);
    expect(refreshSetCookie(res)).toBeUndefined();
    expect(res.body.data?.tokens).toBeUndefined();
    expect(await RefreshSessionModel.countDocuments({})).toBe(0);
  });

  it('rejects a text/plain login (the other preflight-free form encoding) with 415', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ email: EMAIL, password: PASSWORD }));
    expect(res.status).toBe(415);
    expect(refreshSetCookie(res)).toBeUndefined();
  });

  it('rejects urlencoded register, forgot and reset with 415', async () => {
    const register = await request(app)
      .post('/api/auth/register')
      .type('form')
      .send({ email: 'new@example.com', username: 'newuser', password: 'newpassword123' });
    expect(register.status).toBe(415);
    expect(refreshSetCookie(register)).toBeUndefined();
    expect(await UserModel.countDocuments({ email: 'new@example.com' })).toBe(0);

    const forgot = await request(app).post('/api/auth/forgot').type('form').send({ email: EMAIL });
    expect(forgot.status).toBe(415);

    const reset = await request(app).post('/api/auth/reset').type('form').send({ token: 'x', password: 'whatever12345' });
    expect(reset.status).toBe(415);
  });

  it('still accepts a JSON login (200 + refresh cookie)', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(refreshSetCookie(res)).toBeDefined();
  });

  it('accepts JSON with a charset parameter', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json; charset=utf-8')
      .send(JSON.stringify({ email: EMAIL, password: PASSWORD }));
    expect(res.status).toBe(200);
  });
});
