import request from 'supertest';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { MockAPIModel, EndpointModel } from '../models/MockAPI.js';
import { AiRateWindowModel } from '../models/AiRateWindow.js';
import * as providers from '../modules/ai/providers/index.js';

/**
 * The AI routes that take a project reference (generate-mock-api-spec reads its GitHub context into the prompt,
 * generate-and-save writes endpoints into it) must check the caller's role BEFORE building the prompt or calling a model.
 * generate-description and generate-mock-data take no project reference at all.
 */

const PASSWORD = 'ai-access-test-password-1';
const SPEC = JSON.stringify({
  apiVersion: '1.0.0',
  title: 'Gym API',
  description: 'd',
  endpoints: [
    {
      path: '/members',
      method: 'GET',
      description: 'List members',
      responseSchema: { type: 'array' },
      responseExample: [{ id: 1, name: 'Ada' }],
      statusCode: 200,
    },
  ],
  dataModels: [],
});

describe('AI routes: project access control', () => {
  const complete = jest.fn();
  let getLlmSpy: jest.SpyInstance;
  let log: jest.SpyInstance[];

  async function createUser(email: string) {
    const user = await UserModel.create({
      email,
      username: email.split('@')[0],
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      emailVerifiedAt: new Date(),
    });
    const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    return {
      id: user._id,
      auth: { Authorization: `Bearer ${login.body.data.tokens.accessToken as string}` },
    };
  }

  let owner: Awaited<ReturnType<typeof createUser>>;
  let editor: typeof owner;
  let viewer: typeof owner;
  let stranger: typeof owner;
  let project: { _id: mongoose.Types.ObjectId };

  beforeAll(async () => {
    await connectDB();
  });

  beforeEach(async () => {
    await Promise.all([UserModel, ProjectModel, MockAPIModel, EndpointModel, AiRateWindowModel].map((m) => (m as any).deleteMany({})));
    log = ['log', 'warn', 'error'].map((k) => jest.spyOn(console, k as 'log').mockImplementation(() => undefined));
    complete.mockReset();
    complete.mockResolvedValue({ text: SPEC, provider: 'fake', model: 'm', usage: { inputTokens: 1, outputTokens: 2 } });
    getLlmSpy = jest.spyOn(providers, 'getLlm').mockReturnValue({ name: 'fake', complete });

    owner = await createUser('own@example.com');
    editor = await createUser('edit@example.com');
    viewer = await createUser('view@example.com');
    stranger = await createUser('stranger@example.com');
    project = await ProjectModel.create({
      title: 'Gym',
      slug: 'gym-access',
      ownerId: owner.id,
      members: [
        { userId: owner.id, role: 'owner' },
        { userId: editor.id, role: 'editor' },
        { userId: viewer.id, role: 'viewer' },
      ],
    });
  });

  afterEach(() => {
    getLlmSpy.mockRestore();
    log.forEach((l) => l.mockRestore());
  });

  afterAll(async () => {
    await Promise.all([UserModel, ProjectModel, MockAPIModel, EndpointModel, AiRateWindowModel].map((m) => (m as any).deleteMany({})));
    await disconnectDB();
  });

  const body = (ref: unknown) => ({ projectId: ref, requirement: 'members CRUD' });
  const spec = (u: typeof owner, ref: unknown) => request(app).post('/api/ai/generate-mock-api-spec').set(u.auth).send(body(ref));
  const save = (u: typeof owner, ref: unknown) => request(app).post('/api/ai/generate-and-save').set(u.auth).send(body(ref));

  describe.each([
    ['generate-mock-api-spec', spec],
    ['generate-and-save', save],
  ])('%s', (_name, call) => {
    it('a stranger gets 403 by id and by slug and no model is called', async () => {
      for (const ref of [project._id.toString(), 'gym-access']) {
        const res = await call(stranger, ref);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      expect(complete).not.toHaveBeenCalled();
      expect(await MockAPIModel.countDocuments({})).toBe(0);
    });

    it('an unknown project is 404 and no model is called', async () => {
      expect((await call(owner, new mongoose.Types.ObjectId().toString())).status).toBe(404);
      expect((await call(owner, 'no-such-slug')).status).toBe(404);
      expect(complete).not.toHaveBeenCalled();
    });

    it('a missing or non-string projectId is a 400 and no model is called', async () => {
      expect((await call(owner, undefined)).status).toBe(400);
      expect((await call(owner, { $ne: null })).status).toBe(400);
      expect(complete).not.toHaveBeenCalled();
    });

    it('the project is checked before the rate limiter spends the caller quota on a forbidden call', async () => {
      await call(stranger, 'gym-access');
      expect(await AiRateWindowModel.countDocuments({ userId: stranger.id })).toBe(0);
    });
  });

  describe('generate-mock-api-spec (read only: nothing is written)', () => {
    it.each([
      ['owner', () => owner],
      ['editor', () => editor],
      ['viewer', () => viewer],
    ])('%s may generate a specification', async (_role, who) => {
      const res = await spec(who(), project._id.toString());
      expect(res.status).toBe(200);
      expect(res.body.data.specification.title).toBe('Gym API');
      expect(complete).toHaveBeenCalledTimes(1);
      expect(await MockAPIModel.countDocuments({})).toBe(0);
    });
  });

  describe('generate-and-save (writes endpoints)', () => {
    it('a viewer is refused with 403 and nothing is generated or saved', async () => {
      const res = await save(viewer, project._id.toString());
      expect(res.status).toBe(403);
      expect(complete).not.toHaveBeenCalled();
      expect(await MockAPIModel.countDocuments({})).toBe(0);
    });

    it.each([
      ['owner', () => owner],
      ['editor', () => editor],
    ])('%s can generate and save, by id and by slug', async (_role, who) => {
      const byId = await save(who(), project._id.toString());
      expect(byId.status).toBe(200);
      const bySlug = await save(who(), 'gym-access');
      expect(bySlug.status).toBe(200);
      expect(complete).toHaveBeenCalledTimes(2);
      expect(await MockAPIModel.countDocuments({ projectId: project._id })).toBe(1);
    });
  });

  it('the routes without a project reference are unaffected (still reachable for any verified user)', async () => {
    const d = await request(app).post('/api/ai/generate-description').set(stranger.auth).send({ prompt: 'p', userMessage: 'm' });
    expect(d.status).toBe(200);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
