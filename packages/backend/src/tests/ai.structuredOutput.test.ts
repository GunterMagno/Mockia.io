import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { MockAPIModel, EndpointModel } from '../models/MockAPI.js';
import { AiRateWindowModel } from '../models/AiRateWindow.js';
import { openRouterConfig, SPEC_GENERATION_DEFAULTS } from '../config/ai.js';
import * as providers from '../modules/ai/providers/index.js';
import { createOpenRouterProvider } from '../modules/ai/providers/openaiCompatible.js';
import { MOCK_SPEC_JSON_SCHEMA } from '../modules/ai/outputSchema.js';

/**
 * The endpoint-generation call sites hand the output schema to the provider (that is what lets Ollama/vLLM constrain
 * decoding), and OpenRouter, whose model may not support strict json_schema, is downgraded to json_object.
 */

const PASSWORD = 'ai-structured-test-password-1';
const SPEC = JSON.stringify({
  apiVersion: '1.0.0',
  title: 'Gym API',
  description: 'd',
  endpoints: [{ path: '/members', method: 'GET', description: 'List members', examples: [{ request: {}, response: { id: 1 } }] }],
  dataModels: [],
});

describe('AI generation passes the output schema', () => {
  const complete = jest.fn();
  let getLlmSpy: jest.SpyInstance;
  let log: jest.SpyInstance[];
  let auth: { Authorization: string };
  let projectId: string;

  beforeAll(async () => {
    await connectDB();
  });

  beforeEach(async () => {
    await Promise.all([UserModel, ProjectModel, MockAPIModel, EndpointModel, AiRateWindowModel].map((m) => (m as any).deleteMany({})));
    log = ['log', 'warn', 'error'].map((k) => jest.spyOn(console, k as 'log').mockImplementation(() => undefined));
    complete.mockReset();
    complete.mockResolvedValue({ text: SPEC, provider: 'fake', model: 'm', usage: { inputTokens: 1, outputTokens: 2 } });
    getLlmSpy = jest.spyOn(providers, 'getLlm').mockReturnValue({ name: 'fake', complete });

    const user = await UserModel.create({
      email: 'schema@example.com',
      username: 'schema',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      emailVerifiedAt: new Date(),
    });
    const login = await request(app).post('/api/auth/login').send({ email: 'schema@example.com', password: PASSWORD });
    auth = { Authorization: `Bearer ${login.body.data.tokens.accessToken as string}` };
    const project = await ProjectModel.create({ title: 'Gym', slug: 'gym-schema', ownerId: user._id, members: [{ userId: user._id, role: 'owner' }] });
    projectId = project._id.toString();
  });

  afterEach(() => {
    getLlmSpy.mockRestore();
    log.forEach((l) => l.mockRestore());
  });

  afterAll(async () => {
    await Promise.all([UserModel, ProjectModel, MockAPIModel, EndpointModel, AiRateWindowModel].map((m) => (m as any).deleteMany({})));
    await disconnectDB();
  });

  it('generate-mock-api-spec calls the provider with jsonSchema = MOCK_SPEC_JSON_SCHEMA', async () => {
    const res = await request(app).post('/api/ai/generate-mock-api-spec').set(auth).send({ projectId, requirement: 'members CRUD' });
    expect(res.status).toBe(200);
    expect(complete).toHaveBeenCalledTimes(1);
    const req = complete.mock.calls[0][0];
    expect(req.jsonSchema).toBe(MOCK_SPEC_JSON_SCHEMA);
    expect(req.json).toBeUndefined();
    expect(req.temperature).toBe(SPEC_GENERATION_DEFAULTS.temperature);
    expect(req.maxTokens).toBe(SPEC_GENERATION_DEFAULTS.maxTokens);
    expect(req.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'user']);
  });

  it('generate-and-save calls the provider with jsonSchema = MOCK_SPEC_JSON_SCHEMA and still saves', async () => {
    const res = await request(app).post('/api/ai/generate-and-save').set(auth).send({ projectId, requirement: 'members CRUD' });
    expect(res.status).toBe(200);
    expect(res.body.data.database.endpointsCreated).toBe(1);
    expect(complete.mock.calls[0][0].jsonSchema).toBe(MOCK_SPEC_JSON_SCHEMA);
  });

  it('the other call sites keep their plain request (no schema)', async () => {
    await request(app).post('/api/ai/generate-description').set(auth).send({ prompt: 'p', userMessage: 'u' });
    complete.mockResolvedValueOnce({ text: '{"a":1}', provider: 'fake', model: 'm' });
    await request(app).post('/api/ai/generate-mock-data').set(auth).send({ schema: { a: 'number' } });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0][0].jsonSchema).toBeUndefined();
    expect(complete.mock.calls[1][0].jsonSchema).toBeUndefined();
    expect(complete.mock.calls[1][0].json).toBe(true);
  });
});

describe('OpenRouter provider with a schema', () => {
  const savedOr = { ...openRouterConfig };
  const savedEnv = { ...process.env };
  let server: http.Server;
  let seen: any[];

  beforeEach(async () => {
    seen = [];
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seen.push(JSON.parse(raw));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ model: 'or-model', choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    openRouterConfig.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    openRouterConfig.apiKey = 'sk-or-test';
    openRouterConfig.model = 'some/model';
    delete process.env.OPENROUTER_JSON_SCHEMA;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    Object.assign(openRouterConfig, savedOr);
    process.env = { ...savedEnv };
  });

  const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };

  it('downgrades to json_object by default (the chosen model may not support strict json_schema), keeping the structured temperature', async () => {
    const out = await createOpenRouterProvider().complete({ messages: [{ role: 'user', content: 'x' }], jsonSchema: SCHEMA });
    expect(out.text).toBe('{"ok":true}');
    expect(seen[0].response_format).toEqual({ type: 'json_object' });
    expect(seen[0].temperature).toBe(0.2);
    expect(JSON.stringify(seen[0])).not.toContain('json_schema');
  });

  it('an explicit caller temperature still wins', async () => {
    await createOpenRouterProvider().complete({ messages: [{ role: 'user', content: 'x' }], jsonSchema: SCHEMA, temperature: 0.85 });
    expect(seen[0].temperature).toBe(0.85);
  });

  it('OPENROUTER_JSON_SCHEMA=1 opts in to strict json_schema for models that support it', async () => {
    process.env.OPENROUTER_JSON_SCHEMA = '1';
    await createOpenRouterProvider().complete({ messages: [{ role: 'user', content: 'x' }], jsonSchema: SCHEMA });
    expect(seen[0].response_format).toEqual({ type: 'json_schema', json_schema: { name: 'mockia_output', strict: true, schema: SCHEMA } });
  });

  it('without a schema nothing changes (json:true -> json_object, plain -> no response_format)', async () => {
    const p = createOpenRouterProvider();
    await p.complete({ messages: [{ role: 'user', content: 'x' }], json: true });
    await p.complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(seen[0].response_format).toEqual({ type: 'json_object' });
    expect(seen[1].response_format).toBeUndefined();
    expect(seen[1].temperature).toBe(0.7);
  });
});
