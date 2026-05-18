import request from 'supertest';
import app from '../index.js';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { EndpointModel, MockAPIModel, ResponseModel } from '../models/MockAPI.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import bcrypt from 'bcrypt';

describe('Endpoints CRUD (endpoints.routes)', () => {
  let accessToken: string;
  let userId: string;
  let projectId: string;
  let projectSlug: string;
  let testEndpointId: string;

  beforeAll(async () => {
    try {
      await connectDB();
      await UserModel.deleteMany({});
      await ProjectModel.deleteMany({});
      await MockAPIModel.deleteMany({});
      await EndpointModel.deleteMany({});
      await ResponseModel.deleteMany({});

      // 1. Create a test user
      const hashedPassword = await bcrypt.hash('testpassword123', 10);
      const user = await UserModel.create({
        email: 'testendpoints@example.com',
        username: 'testendpointsuser',
        passwordHash: hashedPassword,
      });
      userId = user._id.toString();

      // 2. Log in to retrieve JWT access token
      const loginRes = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send({
          email: 'testendpoints@example.com',
          password: 'testpassword123',
        });

      accessToken = loginRes.body.data.tokens.accessToken;

      // 3. Create a test project owned by the user
      const project = await ProjectModel.create({
        title: 'Test Endpoint Project',
        description: 'Project for testing endpoints CRUD',
        slug: 'test-endpoint-project',
        ownerId: user._id,
        members: [{ userId: user._id, role: 'owner' as any, addedAt: new Date() }],
        isArchived: false,
      });
      projectId = project._id.toString();
      projectSlug = project.slug;

    } catch (error) {
      console.error('Error in beforeAll of endpoints test:', error);
    }
  });

  afterAll(async () => {
    try {
      await UserModel.deleteMany({});
      await ProjectModel.deleteMany({});
      await MockAPIModel.deleteMany({});
      await EndpointModel.deleteMany({});
      await ResponseModel.deleteMany({});
      await disconnectDB();
    } catch (error) {
      console.error('Error in afterAll of endpoints test:', error);
    }
  });

  describe('POST /api/endpoints/:projectSlug', () => {
    it('should block creation without token (401)', async () => {
      const response = await request(app)
        .post(`/api/endpoints/${projectSlug}`)
        .send({ path: '/users', method: 'GET', description: 'Get users list' });

      expect(response.status).toBe(401);
    });

    it('should create a new endpoint with valid token (201)', async () => {
      const response = await request(app)
        .post(`/api/endpoints/${projectSlug}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ path: '/users', method: 'GET', description: 'Get users list' });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('_id');
      expect(response.body.data).toHaveProperty('path', '/users');
      expect(response.body.data).toHaveProperty('method', 'GET');
      expect(response.body.data).toHaveProperty('responses');
      expect(response.body.data.responses.length).toBeGreaterThan(0);

      testEndpointId = response.body.data._id;
    });

    it('should enforce unique paths (append counter on duplicates)', async () => {
      const response = await request(app)
        .post(`/api/endpoints/${projectSlug}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ path: '/users', method: 'GET', description: 'Duplicate path check' });

      expect(response.status).toBe(201);
      expect(response.body.data.path).toBe('/users-1');
    });

    it('should block creation with invalid method due to Joi validation (400)', async () => {
      const response = await request(app)
        .post(`/api/endpoints/${projectSlug}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ path: '/test', method: 'INVALID' });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });
  });

  describe('PUT /api/endpoints/:id', () => {
    it('should update endpoint properties and response body correctly (200)', async () => {
      const response = await request(app)
        .put(`/api/endpoints/${testEndpointId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          path: '/users-updated',
          method: 'POST',
          description: 'Updated description',
          statusCode: 201,
          responseBody: { message: 'User created successfully', ok: true }
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.path).toBe('/users-updated');
      expect(response.body.data.method).toBe('POST');
      expect(response.body.data.description).toBe('Updated description');

      // Fetch the associated response doc to verify updates
      const updatedEndpoint = await EndpointModel.findById(testEndpointId).populate('responses');
      const responseDoc = updatedEndpoint?.responses[0] as any;
      expect(responseDoc).toBeDefined();
      expect(responseDoc.statusCode).toBe(201);
      expect(responseDoc.schema).toHaveProperty('message', 'User created successfully');
    });

    it('should block updates with invalid path format (no slash) due to Joi validation (400)', async () => {
      const response = await request(app)
        .put(`/api/endpoints/${testEndpointId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ path: 'invalidpath' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/endpoints/:id', () => {
    it('should block deletion without token (401)', async () => {
      const response = await request(app)
        .delete(`/api/endpoints/${testEndpointId}`);

      expect(response.status).toBe(401);
    });

    it('should delete the endpoint and its default responses (200)', async () => {
      const endpointDoc = await EndpointModel.findById(testEndpointId);
      const associatedResponseId = endpointDoc?.responses[0];

      const response = await request(app)
        .delete(`/api/endpoints/${testEndpointId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify DB deletion of both Endpoint and Response documents
      const deletedEndpoint = await EndpointModel.findById(testEndpointId);
      expect(deletedEndpoint).toBeNull();

      if (associatedResponseId) {
        const deletedResponse = await ResponseModel.findById(associatedResponseId);
        expect(deletedResponse).toBeNull();
      }
    });
  });
});
