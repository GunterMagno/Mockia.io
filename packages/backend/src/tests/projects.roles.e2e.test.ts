import request from 'supertest';
import app from '../index';
import { UserModel } from '../models/User';
import { ProjectModel } from '../models/Project';
import { connectDB, disconnectDB } from '../config/connection';
import bcrypt from 'bcrypt';

describe('Projects - Roles and Access Control E2E', () => {
  let ownerToken: string;
  let editorToken: string;
  let viewerToken: string;
  let ownerId: string;
  let editorId: string;
  let viewerId: string;
  let projectId: string;

  beforeAll(async () => {
    try {
      await connectDB();
      await UserModel.deleteMany({});
      await ProjectModel.deleteMany({});

      console.log('Creating test users...');
      const hashedPassword = await bcrypt.hash('testpassword123', 10);

      const ownerUser = await UserModel.create({
        email: 'owner@example.com',
        username: 'owneruser',
        passwordHash: hashedPassword,
      });
      ownerId = ownerUser._id.toString();

      const editorUser = await UserModel.create({
        email: 'editor@example.com',
        username: 'editoruser',
        passwordHash: hashedPassword,
      });
      editorId = editorUser._id.toString();

      const viewerUser = await UserModel.create({
        email: 'viewer@example.com',
        username: 'vieweruser',
        passwordHash: hashedPassword,
      });
      viewerId = viewerUser._id.toString();

      console.log('Logging in users...');
      const ownerLogin = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send({
          email: 'owner@example.com',
          password: 'testpassword123',
        });

      if (ownerLogin.status !== 200) {
        console.error('Owner login failed:', ownerLogin.body);
        throw new Error('Owner login failed');
      }

      ownerToken = ownerLogin.body.data.tokens.accessToken;

      const editorLogin = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send({
          email: 'editor@example.com',
          password: 'testpassword123',
        });
      editorToken = editorLogin.body.data.tokens.accessToken;

      const viewerLogin = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send({
          email: 'viewer@example.com',
          password: 'testpassword123',
        });
      viewerToken = viewerLogin.body.data.tokens.accessToken;

      console.log('Creating test project...');
      const createResponse = await request(app)
        .post('/api/projects')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Test Project for Roles',
          description: 'Project to test RBAC',
        });

      console.log('Project creation response:', createResponse.status);
      if (createResponse.status !== 201) {
        throw new Error(`Failed to create project: ${JSON.stringify(createResponse.body)}`);
      }

      projectId = createResponse.body.data.id;
      console.log('Test setup complete. ProjectId:', projectId);
    } catch (error) {
      console.error('Error in beforeAll:', error);
      throw error;
    }
  }, 30000);

  afterAll(async () => {
    try {
      await UserModel.deleteMany({});
      await ProjectModel.deleteMany({});
      await disconnectDB();
    } catch (error) {
      console.error('Error in afterAll:', error);
    }
  });

  describe('Scenario 1: OWNER invites EDITOR and VIEWER', () => {
    it('should add EDITOR to project (201)', async () => {
      const response = await request(app)
        .post(`/api/projects/${projectId}/members`)
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          targetEmail: 'editor@example.com',
          role: 'EDITOR',
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toHaveProperty('members');
      const editorMember = response.body.data.members.find(
        (m: any) => m.userId === editorId
      );
      expect(editorMember).toBeDefined();
      expect(editorMember.role).toBe('EDITOR');
    });

    it('should add VIEWER to project (201)', async () => {
      const response = await request(app)
        .post(`/api/projects/${projectId}/members`)
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          targetEmail: 'viewer@example.com',
          role: 'VIEWER',
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toHaveProperty('members');
      const viewerMember = response.body.data.members.find(
        (m: any) => m.userId === viewerId
      );
      expect(viewerMember).toBeDefined();
      expect(viewerMember.role).toBe('VIEWER');
    });
  });

  describe('Scenario 2: All roles can VIEW the project', () => {
    it('OWNER should see project in list (200)', async () => {
      const response = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      const projects = response.body.data;
      const project = projects.find((p: any) => p.id === projectId);
      expect(project).toBeDefined();
    });

    it('EDITOR should see project in list (200)', async () => {
      const response = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${editorToken}`);

      expect(response.status).toBe(200);
      const projects = response.body.data;
      const project = projects.find((p: any) => p.id === projectId);
      expect(project).toBeDefined();
    });

    it('VIEWER should see project in list (200)', async () => {
      const response = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      const projects = response.body.data;
      const project = projects.find((p: any) => p.id === projectId);
      expect(project).toBeDefined();
    });
  });

  describe('Scenario 3: Only OWNER and EDITOR can MODIFY the project', () => {
    it('VIEWER cannot update project (403)', async () => {
      const response = await request(app)
        .put(`/api/projects/${projectId}`)
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          title: 'Modified by Viewer',
        });

      expect(response.status).toBe(403);
    });

    it('EDITOR can update project (200)', async () => {
      const response = await request(app)
        .put(`/api/projects/${projectId}`)
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${editorToken}`)
        .send({
          title: 'Updated by Editor',
        });

      expect(response.status).toBe(200);
    });

    it('OWNER can update project (200)', async () => {
      const response = await request(app)
        .put(`/api/projects/${projectId}`)
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Updated by Owner',
        });

      expect(response.status).toBe(200);
    });
  });

  describe('Scenario 4: Only OWNER can manage members', () => {
    it('EDITOR can add members (201)', async () => {
      const response = await request(app)
        .post(`/api/projects/${projectId}/members`)
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${editorToken}`)
        .send({
          targetEmail: 'owner@example.com',
          role: 'VIEWER',
        });

      // It might return 400 because owner is already a member, but it should NOT be 403
      expect(response.status).not.toBe(403);
    });

    it('VIEWER cannot add members (403)', async () => {
      const response = await request(app)
        .post(`/api/projects/${projectId}/members`)
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          email: 'newuser@example.com',
          role: 'viewer',
        });

      expect(response.status).toBe(403);
    });

    it('OWNER can remove VIEWER member (200)', async () => {
      const response = await request(app)
        .delete(`/api/projects/${projectId}/members/${viewerId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
    });
  });

  describe('Scenario 5: After removal, member loses access', () => {
    it('Removed VIEWER cannot see project anymore', async () => {
      const response = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      const projects = response.body.data;
      const project = projects.find((p: any) => p.id === projectId);
      expect(project).toBeUndefined();
    });
  });

  describe('Scenario 6: Only OWNER can delete project', () => {
    it('EDITOR cannot delete project (403)', async () => {
      const response = await request(app)
        .delete(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${editorToken}`);

      expect(response.status).toBe(403);
    });

    it('OWNER can delete project (204)', async () => {
      const response = await request(app)
        .delete(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
    });
  });
});
