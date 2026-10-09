import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { MockAPIModel, EndpointModel, ResponseModel } from '../models/MockAPI.js';
import { AiRateWindowModel } from '../models/AiRateWindow.js';
import { SPEC_GENERATION_DEFAULTS, getSpecGenerationSampling } from '../config/ai.js';
import * as providers from '../modules/ai/providers/index.js';

/**
 * The client does not control sampling or size: one verified user sending { maxTokens: 20000 } or a 1 MB requirement
 * could otherwise keep the local model's breaker open for everybody. The endpoint-generation routes use the
 * server's sampling (AI_SPEC_TEMPERATURE for the owner to tune), cap the free text, and hand the chain the same
 * content-free validator the pipeline applies afterwards. The old open LLM proxy routes are gone.
 */
const PASSWORD = 'ai-limits-test-password-1';
const SPEC = JSON.stringify({
  apiVersion: '1.0.0',
  title: 'Gym API',
  description: 'd',
  endpoints: [{ path: '/members', method: 'GET', description: 'List members', examples: [{ request: {}, response: { id: 1 } }] }],
  dataModels: [],
});
const MODELS = [UserModel, ProjectModel, MockAPIModel, EndpointModel, ResponseModel, AiRateWindowModel];

describe('AI generation: server-side sampling, input caps, validator, no open proxy routes', () => {
  const complete = jest.fn();
  let getLlmSpy: jest.SpyInstance;
  let log: jest.SpyInstance[];
  let auth: { Authorization: string };
  let projectId: string;
  const savedTemp = process.env.AI_SPEC_TEMPERATURE;

  beforeAll(async () => {
    await connectDB();
  });

  beforeEach(async () => {
    await Promise.all(MODELS.map((m) => (m as any).deleteMany({})));
    delete process.env.AI_SPEC_TEMPERATURE;
    log = ['log', 'warn', 'error'].map((k) => jest.spyOn(console, k as 'log').mockImplementation(() => undefined));
    complete.mockReset();
    complete.mockResolvedValue({ text: SPEC, provider: 'fake', model: 'm' });
    getLlmSpy = jest.spyOn(providers, 'getLlm').mockReturnValue({ name: 'fake', complete });
    const user = await UserModel.create({
      email: 'limits@example.com',
      username: 'limits',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      emailVerifiedAt: new Date(),
    });
    const login = await request(app).post('/api/auth/login').send({ email: 'limits@example.com', password: PASSWORD });
    auth = { Authorization: `Bearer ${login.body.data.tokens.accessToken as string}` };
    const project = await ProjectModel.create({ title: 'Gym', slug: 'gym-limits', ownerId: user._id, members: [{ userId: user._id, role: 'owner' }] });
    projectId = project._id.toString();
  });

  afterEach(() => {
    getLlmSpy.mockRestore();
    log.forEach((l) => l.mockRestore());
    if (savedTemp === undefined) delete process.env.AI_SPEC_TEMPERATURE;
    else process.env.AI_SPEC_TEMPERATURE = savedTemp;
  });

  afterAll(async () => {
    await Promise.all(MODELS.map((m) => (m as any).deleteMany({})));
    await disconnectDB();
  });

  it.each(['generate-mock-api-spec', 'generate-and-save'])('%s ignores client temperature / maxTokens', async (route) => {
    const res = await request(app)
      .post(`/api/ai/${route}`)
      .set(auth)
      .send({ projectId, requirement: 'members CRUD', temperature: 2, maxTokens: 20000 });
    expect(res.status).toBe(200);
    const req = complete.mock.calls[0][0];
    expect(req.temperature).toBe(SPEC_GENERATION_DEFAULTS.temperature);
    expect(req.maxTokens).toBe(SPEC_GENERATION_DEFAULTS.maxTokens);
  });

  it('AI_SPEC_TEMPERATURE tunes the sampling (owner side); empty or invalid keeps the default 0.85', () => {
    expect(getSpecGenerationSampling({ AI_SPEC_TEMPERATURE: '0.5' })).toEqual({ temperature: 0.5, maxTokens: 5000 });
    expect(getSpecGenerationSampling({ AI_SPEC_TEMPERATURE: '0' }).temperature).toBe(0);
    for (const value of [undefined, '', '  ', 'abc', '-1', '3']) {
      expect(getSpecGenerationSampling({ AI_SPEC_TEMPERATURE: value }).temperature).toBe(0.85);
    }
  });

  it('the routes use AI_SPEC_TEMPERATURE', async () => {
    process.env.AI_SPEC_TEMPERATURE = '0.4';
    await request(app).post('/api/ai/generate-mock-api-spec').set(auth).send({ projectId, requirement: 'members CRUD' });
    expect(complete.mock.calls[0][0].temperature).toBe(0.4);
  });

  it.each(['generate-mock-api-spec', 'generate-and-save'])('%s rejects a requirement over 4000 characters (400, no model call, no quota)', async (route) => {
    const res = await request(app).post(`/api/ai/${route}`).set(auth).send({ projectId, requirement: 'x'.repeat(4001) });
    expect(res.status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
    expect(await AiRateWindowModel.countDocuments({})).toBe(0);
    const ok = await request(app).post(`/api/ai/${route}`).set(auth).send({ projectId, requirement: 'x'.repeat(4000) });
    expect(ok.status).toBe(200);
  });

  it('rejects an oversized or non-string projectId (400) before any lookup', async () => {
    expect((await request(app).post('/api/ai/generate-and-save').set(auth).send({ projectId: 'p'.repeat(201), requirement: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/ai/generate-and-save').set(auth).send({ projectId: 42, requirement: 'x' })).status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });

  it.each(['generate-mock-api-spec', 'generate-and-save'])('%s hands the chain a content-free validator (the downstream parse + validation)', async (route) => {
    await request(app).post(`/api/ai/${route}`).set(auth).send({ projectId, requirement: 'members CRUD' });
    const validate = complete.mock.calls[0][0].validate as (text: string) => string | null;
    expect(typeof validate).toBe('function');
    expect(validate(SPEC)).toBeNull();
    const junk = 'SECRET-OUTPUT {"title": tru';
    const reason = validate(junk);
    expect(typeof reason).toBe('string');
    expect(reason).not.toContain('SECRET');
    const wrongShape = validate(JSON.stringify({ hello: 'SECRET-WORLD' }));
    expect(typeof wrongShape).toBe('string');
    expect(wrongShape).not.toContain('SECRET');
  });

  it('the unused open LLM proxy routes are gone (404) and never reach a model', async () => {
    const d = await request(app).post('/api/ai/generate-description').set(auth).send({ prompt: 'p', userMessage: 'u' });
    const m = await request(app).post('/api/ai/generate-mock-data').set(auth).send({ schema: { a: 'number' } });
    expect(d.status).toBe(404);
    expect(m.status).toBe(404);
    expect(complete).not.toHaveBeenCalled();
  });
});
