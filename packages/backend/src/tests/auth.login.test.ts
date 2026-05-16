import request from 'supertest';
import app from '../index.js';
import { UserModel } from '../models/User.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import bcrypt from 'bcrypt';

describe('Auth - Login (POST /api/auth/login)', () => {
  beforeAll(async () => {
    try {
      await connectDB();
      await UserModel.deleteMany({});

      // Create a test user
      const hashedPassword = await bcrypt.hash('testpassword123', 10);
      await UserModel.create({
        email: 'testlogin@example.com',
        username: 'testloginuser',
        passwordHash: hashedPassword,
      });
    } catch (error) {
      console.error('Error in beforeAll:', error);
    }
  });

  afterAll(async () => {
    try {
      await UserModel.deleteMany({});
      await disconnectDB();
    } catch (error) {
      console.error('Error in afterAll:', error);
    }
  });

  it('should login with valid credentials (200)', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send({
        email: 'testlogin@example.com',
        password: 'testpassword123',
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('data');
    expect(response.body.data).toHaveProperty('user');
    expect(response.body.data).toHaveProperty('tokens');
    expect(response.body.data.user).toHaveProperty('id');
    expect(response.body.data.user).toHaveProperty('email', 'testlogin@example.com');
    expect(response.body.data.user).toHaveProperty('username', 'testloginuser');
    expect(response.body.data.tokens).toHaveProperty('accessToken');
    expect(response.body.data.tokens).toHaveProperty('refreshToken');
    // Ensure password is NOT returned
    expect(response.body.data.user).not.toHaveProperty('password');
    expect(response.body.data.user).not.toHaveProperty('passwordHash');
  });

  it('should return 401 with incorrect password', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send({
        email: 'testlogin@example.com',
        password: 'wrongpassword',
      });

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body.error).toHaveProperty('code', 'UNAUTHORIZED');
  });

  it('should return 401 with non-existent email', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send({
        email: 'nonexistent@example.com',
        password: 'testpassword123',
      });

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body.error).toHaveProperty('code', 'UNAUTHORIZED');
  });

  it('should return 400 with missing email', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send({
        password: 'testpassword123',
      });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('should return 400 with missing password', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send({
        email: 'testlogin@example.com',
      });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('should return 401 with non-existent email/username format', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send({
        email: 'notemail',
        password: 'testpassword123',
      });

    expect(response.status).toBe(401);
    expect(response.body.error).toHaveProperty('code', 'UNAUTHORIZED');
  });

  it('should return tokens that are valid JWTs', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send({
        email: 'testlogin@example.com',
        password: 'testpassword123',
      });

    const { accessToken, refreshToken } = response.body.data.tokens;

    // Basic JWT format check (3 parts separated by dots)
    expect(accessToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(refreshToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});
