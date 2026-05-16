import request from 'supertest';
import app from '../index.js';
import { UserModel } from '../models/User.js';
import { connectDB, disconnectDB } from '../config/connection.js';

describe('Auth - Registration (POST /api/auth/register)', () => {
  beforeAll(async () => {
    try {
      await connectDB();
      // Clear users collection before tests
      await UserModel.deleteMany({});
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

  it('should register a new user successfully (201)', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send({
        email: 'newuser@example.com',
        password: 'password123',
        username: 'newuser',
      });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('data');
    expect(response.body.data).toHaveProperty('id');
    expect(response.body.data).toHaveProperty('email', 'newuser@example.com');
    expect(response.body.data).toHaveProperty('username', 'newuser');
    expect(response.body.data).toHaveProperty('createdAt');
    expect(response.body.data).toHaveProperty('updatedAt');
    // Ensure password is NOT returned
    expect(response.body.data).not.toHaveProperty('password');
    expect(response.body.data).not.toHaveProperty('passwordHash');
  });

  it('should return 409 when email already exists', async () => {
    // First registration
    await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send({
        email: 'duplicate@example.com',
        password: 'password123',
        username: 'user1',
      });

    // Second attempt with same email
    const response = await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send({
        email: 'duplicate@example.com',
        password: 'differentpassword',
        username: 'user2',
      });

    expect(response.status).toBe(409);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body.error).toHaveProperty('code', 'CONFLICT');
  });

  it('should return 400 with empty email', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send({
        email: '',
        password: 'password123',
        username: 'testuser',
      });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('should return 400 with invalid email format', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send({
        email: 'notanemail',
        password: 'password123',
        username: 'testuser',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('should return 400 with short password (< 8 chars)', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send({
        email: 'test@example.com',
        password: 'short',
        username: 'testuser',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('should return 400 with empty username', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send({
        email: 'test@example.com',
        password: 'password123',
        username: '',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('should return 400 with username < 2 characters', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send({
        email: 'test@example.com',
        password: 'password123',
        username: 'a',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });
});
