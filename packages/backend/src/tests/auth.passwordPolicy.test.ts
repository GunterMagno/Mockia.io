import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../index.js';
import { UserModel } from '../models/User.js';
import { RefreshSessionModel } from '../models/RefreshSession.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { BCRYPT_COST, bcryptCostOf } from '../services/password.service.js';

describe('Password policy and bcrypt cost', () => {
  beforeAll(async () => {
    await connectDB();
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
  });

  afterAll(async () => {
    await UserModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
    await disconnectDB();
  });

  describe('bcryptCostOf', () => {
    it.each([
      ['$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234', 10],
      ['$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234', 12],
      ['$2y$04$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234', 4],
    ])('%s -> %i', (hash, cost) => {
      expect(bcryptCostOf(hash)).toBe(cost);
    });

    it('is NaN-free: garbage has no cost', () => {
      expect(bcryptCostOf('not a hash')).toBeUndefined();
      expect(bcryptCostOf('')).toBeUndefined();
    });

    it('the configured cost is 12', () => {
      expect(BCRYPT_COST).toBe(12);
    });
  });

  describe('register', () => {
    const register = (password: string, email = 'policy@example.com') =>
      request(app).post('/api/auth/register').send({ email, password, username: 'policyuser' });

    it('rejects 9 characters', async () => {
      const res = await register('abcdefghi');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts 10 and 128, rejects 129', async () => {
      expect((await register('abcdefghij', 'a@example.com')).status).toBe(201);
      expect((await register('x'.repeat(128), 'b@example.com')).status).toBe(201);
      expect((await register('x'.repeat(129), 'c@example.com')).status).toBe(400);
    });

    it('hashes the password with cost 12', async () => {
      await register('abcdefghij');
      const user = await UserModel.findOne({ email: 'policy@example.com' });
      expect(bcryptCostOf(user!.passwordHash)).toBe(12);
    });
  });

  describe('change-password', () => {
    it('requires at least 10 characters for the new password and stores it with cost 12', async () => {
      await UserModel.create({
        email: 'change@example.com',
        username: 'changeuser',
        passwordHash: await bcrypt.hash('current-password-1', 12),
      });
      const login = await request(app).post('/api/auth/login').send({ email: 'change@example.com', password: 'current-password-1' });
      const auth = { Authorization: `Bearer ${login.body.data.tokens.accessToken}` };

      const short = await request(app)
        .post('/api/users/change-password')
        .set(auth)
        .send({ currentPassword: 'current-password-1', newPassword: 'ninechars' });
      expect(short.status).toBe(400);

      const ok = await request(app)
        .post('/api/users/change-password')
        .set(auth)
        .send({ currentPassword: 'current-password-1', newPassword: 'tenchars-ok' });
      expect(ok.status).toBe(204);
      const user = await UserModel.findOne({ email: 'change@example.com' });
      expect(bcryptCostOf(user!.passwordHash)).toBe(12);
    });
  });

  describe('login', () => {
    it('does NOT enforce the length policy: an existing 6-character password still logs in', async () => {
      await UserModel.create({ email: 'old@example.com', username: 'olduser', passwordHash: await bcrypt.hash('abc123', 12) });
      const res = await request(app).post('/api/auth/login').send({ email: 'old@example.com', password: 'abc123' });
      expect(res.status).toBe(200);
    });

    it('transparently re-hashes a cost-10 hash to cost 12 on a successful login', async () => {
      const user = await UserModel.create({
        email: 'rehash@example.com',
        username: 'rehashuser',
        passwordHash: await bcrypt.hash('legacy-password-1', 10),
      });
      expect(bcryptCostOf(user.passwordHash)).toBe(10);

      const res = await request(app).post('/api/auth/login').send({ email: 'rehash@example.com', password: 'legacy-password-1' });
      expect(res.status).toBe(200);

      const after = await UserModel.findById(user._id);
      expect(bcryptCostOf(after!.passwordHash)).toBe(12);
      expect(await bcrypt.compare('legacy-password-1', after!.passwordHash)).toBe(true);

      // and the next login keeps working (and keeps the same cost-12 hash)
      const again = await request(app).post('/api/auth/login').send({ email: 'rehash@example.com', password: 'legacy-password-1' });
      expect(again.status).toBe(200);
      expect((await UserModel.findById(user._id))!.passwordHash).toBe(after!.passwordHash);
    });

    it('a failed login never re-hashes', async () => {
      const user = await UserModel.create({
        email: 'nohash@example.com',
        username: 'nohashuser',
        passwordHash: await bcrypt.hash('legacy-password-1', 10),
      });
      const res = await request(app).post('/api/auth/login').send({ email: 'nohash@example.com', password: 'wrong-password-1' });
      expect(res.status).toBe(401);
      expect((await UserModel.findById(user._id))!.passwordHash).toBe(user.passwordHash);
    });

    it('a hash that is already cost 12 is left untouched', async () => {
      const user = await UserModel.create({
        email: 'fresh@example.com',
        username: 'freshuser',
        passwordHash: await bcrypt.hash('fresh-password-1', 12),
      });
      await request(app).post('/api/auth/login').send({ email: 'fresh@example.com', password: 'fresh-password-1' });
      expect((await UserModel.findById(user._id))!.passwordHash).toBe(user.passwordHash);
    });

    it('does not overwrite a password changed while the re-hash was in flight', async () => {
      // The re-hash is conditional on the hash that was verified: simulate the race by changing it first
      const user = await UserModel.create({
        email: 'race@example.com',
        username: 'raceuser',
        passwordHash: await bcrypt.hash('legacy-password-1', 10),
      });
      const { rehashIfOutdated } = await import('../services/password.service.js');
      const newer = await bcrypt.hash('changed-password-2', 12);
      await UserModel.updateOne({ _id: user._id }, { $set: { passwordHash: newer } });
      await rehashIfOutdated(user._id.toString(), 'legacy-password-1', user.passwordHash);
      expect((await UserModel.findById(user._id))!.passwordHash).toBe(newer);
    });
  });
});
