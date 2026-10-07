import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../index.js';
import { UserModel } from '../models/User.js';
import { RefreshSessionModel } from '../models/RefreshSession.js';
import { connectDB, disconnectDB } from '../config/connection.js';

const PASSWORD = 'locale-test-password-1';
const EMAIL = 'locale@example.com';

async function login() {
  const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
  return {
    body: res.body,
    auth: { Authorization: `Bearer ${res.body.data.tokens.accessToken as string}` },
  };
}

describe('Users - saved language (PATCH /api/users/me/preferences)', () => {
  beforeAll(async () => {
    await connectDB();
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
    await UserModel.create({ email: EMAIL, username: 'localeuser', passwordHash: await bcrypt.hash(PASSWORD, 12) });
  });

  afterAll(async () => {
    await UserModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
    await disconnectDB();
  });

  it('saves "es" and answers it', async () => {
    const { auth } = await login();
    const res = await request(app).patch('/api/users/me/preferences').set(auth).send({ locale: 'es' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locale: 'es' });
    expect((await UserModel.findOne({ email: EMAIL }))?.locale).toBe('es');
  });

  it.each(['en', 'zh'])('accepts "%s" and can change an already saved value', async (locale) => {
    const { auth } = await login();
    await request(app).patch('/api/users/me/preferences').set(auth).send({ locale: 'es' });
    const res = await request(app).patch('/api/users/me/preferences').set(auth).send({ locale });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locale });
    expect((await UserModel.findOne({ email: EMAIL }))?.locale).toBe(locale);
  });

  it.each([
    ['unsupported language', { locale: 'fr' }],
    ['wrong case', { locale: 'ES' }],
    ['empty body', {}],
    ['non-string', { locale: 3 }],
    ['null', { locale: null }],
  ])('400 for %s and nothing is stored', async (_name, body) => {
    const { auth } = await login();
    const res = await request(app).patch('/api/users/me/preferences').set(auth).send(body);
    expect(res.status).toBe(400);
    expect((await UserModel.findOne({ email: EMAIL }))?.locale ?? null).toBeNull();
  });

  it('401 without a token', async () => {
    const res = await request(app).patch('/api/users/me/preferences').send({ locale: 'es' });
    expect(res.status).toBe(401);
  });

  it('only touches the caller (another user keeps their language)', async () => {
    await UserModel.create({ email: 'other@example.com', username: 'other', passwordHash: 'x', locale: 'zh' });
    const { auth } = await login();
    await request(app).patch('/api/users/me/preferences').set(auth).send({ locale: 'es' });
    expect((await UserModel.findOne({ email: 'other@example.com' }))?.locale).toBe('zh');
  });

  it('login returns the saved language in user.locale; absent when never saved', async () => {
    const first = await login();
    expect(first.body.data.user).not.toHaveProperty('locale');

    await request(app).patch('/api/users/me/preferences').set(first.auth).send({ locale: 'zh' });
    const second = await login();
    expect(second.body.data.user.locale).toBe('zh');
  });

  it('refresh and profile also carry user.locale', async () => {
    const agent = request.agent(app);
    const loginRes = await agent.post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
    const auth = { Authorization: `Bearer ${loginRes.body.data.tokens.accessToken as string}` };
    await agent.patch('/api/users/me/preferences').set(auth).send({ locale: 'es' });

    const refreshed = await agent.post('/api/auth/refresh').set('X-Requested-With', 'mockia');
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.user.locale).toBe('es');

    const profile = await agent
      .get('/api/users/profile')
      .set({ Authorization: `Bearer ${refreshed.body.data.accessToken as string}` });
    expect(profile.body.locale).toBe('es');
  });
});
