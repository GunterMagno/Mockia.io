import request from 'supertest';
import app from '../index.js';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { MockAPIModel } from '../models/MockAPI.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import bcrypt from 'bcrypt';

describe('Backend Integration Tests', () => {
  let userToken: string;
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    await connectDB();
    await UserModel.deleteMany({});
    await ProjectModel.deleteMany({});
    await MockAPIModel.deleteMany({});

    const hashedPassword = await bcrypt.hash('password123', 10);
    const user = await UserModel.create({
      email: 'integration@test.com',
      username: 'integration',
      passwordHash: hashedPassword,
    });
    userId = user._id.toString();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'integration@test.com', password: 'password123' });
    userToken = loginRes.body.data.tokens.accessToken;
  }, 30000);

  afterAll(async () => {
    await UserModel.deleteMany({});
    await ProjectModel.deleteMany({});
    await MockAPIModel.deleteMany({});
    await disconnectDB();
  });

  it('Health check should return 200 OK', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('Should create a new project', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        title: 'Integration Project',
        description: 'Test project'
      });
    
    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Integration Project');
    projectId = res.body.data.id;
  });

  it('Should retrieve the created project', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${userToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Integration Project');
  });
});
