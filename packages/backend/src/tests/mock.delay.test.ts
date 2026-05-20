import request from 'supertest';
import app from '../index.js';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { EndpointModel, MockAPIModel, ResponseModel } from '../models/MockAPI.js';
import { EndpointConfigModel } from '../models/EndpointConfig.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import bcrypt from 'bcrypt';

describe('Mock Router Delay and Status Code Interceptors', () => {
  let accessToken: string;
  let userId: string;
  let projectId: string;
  let projectSlug: string;
  let apiKey: string;
  let endpointId: string;

  beforeAll(async () => {
    await connectDB();
    await UserModel.deleteMany({});
    await ProjectModel.deleteMany({});
    await MockAPIModel.deleteMany({});
    await EndpointModel.deleteMany({});
    await ResponseModel.deleteMany({});
    await EndpointConfigModel.deleteMany({});

    // 1. Create a test user
    const hashedPassword = await bcrypt.hash('testpassword123', 10);
    const user = await UserModel.create({
      email: 'testdelay@example.com',
      username: 'testdelayuser',
      passwordHash: hashedPassword,
    });
    userId = user._id.toString();

    // 2. Log in
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'testdelay@example.com',
        password: 'testpassword123',
      });
    accessToken = loginRes.body.data.tokens.accessToken;

    // 3. Create project
    apiKey = 'test-api-key-12345';
    const project = await ProjectModel.create({
      title: 'Delay Test Project',
      description: 'Project for testing mock delays',
      slug: 'delay-test-project',
      ownerId: user._id,
      members: [{ userId: user._id, role: 'owner' as any, addedAt: new Date() }],
      apiKey,
      isArchived: false,
    });
    projectId = project._id.toString();
    projectSlug = project.slug;

    // 4. Create an endpoint
    const createRes = await request(app)
      .post(`/api/endpoints/${projectSlug}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ path: '/test-delay', method: 'GET', description: 'Test delay endpoint' });
    endpointId = createRes.body.data._id;
  });

  afterAll(async () => {
    await UserModel.deleteMany({});
    await ProjectModel.deleteMany({});
    await MockAPIModel.deleteMany({});
    await EndpointModel.deleteMany({});
    await ResponseModel.deleteMany({});
    await EndpointConfigModel.deleteMany({});
    await disconnectDB();
  });

  it('should apply the configured delay', async () => {
    // 1. Update the endpoint to have a 1000ms delay
    const updateRes = await request(app)
      .put(`/api/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        delay_ms: 1000,
        responseBody: { ok: true }
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.delay_ms).toBe(1000);

    // 2. Call the mock proxy endpoint and measure time
    const start = Date.now();
    const mockRes = await request(app)
      .get(`/api/mock/${projectSlug}/test-delay`)
      .set('x-mockia-api-key', apiKey);
    const duration = Date.now() - start;

    expect(mockRes.status).toBe(200);
    expect(mockRes.body).toEqual({ ok: true });
    expect(duration).toBeGreaterThanOrEqual(950); // Should be around 1000ms
  });

  it('should return matching error JSON or explicit response when status code is forced', async () => {
    // 1. Force a 500 status code
    await request(app)
      .put(`/api/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        force_status_code: 500,
      });

    // 2. Call the mock proxy endpoint and verify it returns dynamic 500 error body
    const mockRes500 = await request(app)
      .get(`/api/mock/${projectSlug}/test-delay`)
      .set('x-mockia-api-key', apiKey);

    expect(mockRes500.status).toBe(500);
    expect(mockRes500.body).toEqual({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred on the server.',
      statusCode: 500,
    });

    // 3. Create an explicit 500 response on this endpoint
    const custom500Response = await ResponseModel.create({
      name: 'Custom 500 Error',
      description: 'A custom 500 error response',
      statusCode: 500,
      schema: { customError: 'Something went extremely wrong!' },
    });

    await EndpointModel.findByIdAndUpdate(endpointId, {
      $push: { responses: custom500Response._id }
    });

    // 4. Call mock proxy again and verify it now returns the custom 500 response body instead of the generic one
    const mockResCustom500 = await request(app)
      .get(`/api/mock/${projectSlug}/test-delay`)
      .set('x-mockia-api-key', apiKey);

    expect(mockResCustom500.status).toBe(500);
    expect(mockResCustom500.body).toEqual({ customError: 'Something went extremely wrong!' });
  });
});
