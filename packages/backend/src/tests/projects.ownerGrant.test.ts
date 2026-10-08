import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../index.js';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { connectDB, disconnectDB } from '../config/connection.js';

/**
 * Privilege escalation: an EDITOR used to be able to add an account (e.g. their own second account) as OWNER, and that
 * new owner could then remove the real one. Only an OWNER may grant OWNER; editors invite EDITOR or VIEWER only.
 */
describe('Projects - only an OWNER can grant the OWNER role', () => {
  const PASSWORD = 'testpassword123';
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let projectId: string;
  let errorSpy: jest.SpyInstance;

  const memberRole = async (who: string): Promise<string | undefined> => {
    const project = await ProjectModel.findById(projectId).lean();
    const m = project?.members.find((x) => x.userId.toString() === ids[who]);
    return m ? String(m.role).toUpperCase() : undefined;
  };

  beforeAll(async () => {
    await connectDB();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await UserModel.deleteMany({});
    await ProjectModel.deleteMany({});
    const hash = await bcrypt.hash(PASSWORD, 10);
    for (const name of ['owner', 'editor', 'alt', 'friend', 'coowner']) {
      const user = await UserModel.create({ email: `${name}@grant-example.com`, username: `${name}grant`, passwordHash: hash });
      ids[name] = user._id.toString();
      const login = await request(app).post('/api/auth/login').send({ email: `${name}@grant-example.com`, password: PASSWORD });
      tokens[name] = login.body.data.tokens.accessToken;
    }
    const created = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${tokens.owner}`)
      .send({ title: 'Owner grant project', description: 'x' });
    projectId = created.body.data.id;
    const addEditor = await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${tokens.owner}`)
      .send({ targetEmail: 'editor@grant-example.com', role: 'EDITOR' });
    expect(addEditor.status).toBe(201);
  });

  afterAll(async () => {
    errorSpy.mockRestore();
    await UserModel.deleteMany({});
    await ProjectModel.deleteMany({});
    await disconnectDB();
  });

  it('an EDITOR inviting someone as OWNER gets 403 and nobody is added', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${tokens.editor}`)
      .send({ targetEmail: 'alt@grant-example.com', role: 'OWNER' });
    expect(res.status).toBe(403);
    expect(await memberRole('alt')).toBeUndefined();
  });

  it('an EDITOR can still invite EDITOR and VIEWER', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${tokens.editor}`)
      .send({ targetEmail: 'friend@grant-example.com', role: 'VIEWER' });
    expect(res.status).toBe(201);
    expect(await memberRole('friend')).toBe('VIEWER');
  });

  it('an OWNER can grant OWNER', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${tokens.owner}`)
      .send({ targetEmail: 'coowner@grant-example.com', role: 'OWNER' });
    expect(res.status).toBe(201);
    expect(await memberRole('coowner')).toBe('OWNER');
  });

  it('a member who is not the owner deleting the GitHub context gets 403 (not 500)', async () => {
    const res = await request(app)
      .delete(`/api/projects/${projectId}/context`)
      .set('Authorization', `Bearer ${tokens.editor}`);
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  it('an EDITOR cannot remove an owner', async () => {
    const res = await request(app)
      .delete(`/api/projects/${projectId}/members/${ids.owner}`)
      .set('Authorization', `Bearer ${tokens.editor}`);
    expect(res.status).toBe(403);
    expect(await memberRole('owner')).toBe('OWNER');
  });
});
