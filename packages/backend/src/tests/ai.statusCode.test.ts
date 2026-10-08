import mongoose from 'mongoose';
import { validateGeneratedApi } from '../modules/ai/llmOutputValidator.js';
import { SYSTEM_PROMPT } from '../modules/ai/systemPrompt.js';
import { populateEndpointsFromLLM } from '../modules/mock/mockPopulation.service.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { MockAPIModel, EndpointModel, ResponseModel } from '../models/MockAPI.js';

/**
 * Model-written error examples (404, 401...) must keep their status all the way into the saved responses: the validator
 * self-heals examples into { request, response } and used to drop `statusCode`/`status`, so everything was saved as 200.
 */

const spec = (examples: unknown[]) => ({
  apiVersion: '1.0.0',
  title: 'Gym API',
  description: 'd',
  endpoints: [{ path: '/members/:id', method: 'GET', description: 'Get a member', examples }],
  dataModels: [],
});
const healed = (examples: unknown[]) => validateGeneratedApi(spec(examples)).endpoints[0].examples as Array<Record<string, unknown>>;

describe('validateGeneratedApi keeps the status of an example', () => {
  it('keeps a valid integer statusCode on a wrapped example', () => {
    expect(healed([{ request: {}, response: { error: 'not found' }, statusCode: 404 }])).toEqual([
      { request: {}, response: { error: 'not found' }, statusCode: 404 },
    ]);
  });

  it('accepts `status` as an alias and normalizes it to statusCode', () => {
    const [example] = healed([{ request: {}, response: { error: 'nope' }, status: 401 }]);
    expect(example).toEqual({ request: {}, response: { error: 'nope' }, statusCode: 401 });
    expect(example).not.toHaveProperty('status');
  });

  it('statusCode wins over status; an invalid statusCode falls back to a valid status', () => {
    expect(healed([{ request: {}, response: {}, statusCode: 400, status: 500 }])[0].statusCode).toBe(400);
    expect(healed([{ request: {}, response: {}, statusCode: 'x', status: 500 }])[0].statusCode).toBe(500);
  });

  it.each([99, 600, 404.5, '404', null, true, NaN, -1, 0])('drops an invalid status %p (the example stays valid)', (bad) => {
    const [example] = healed([{ request: {}, response: { id: 1 }, statusCode: bad }]);
    expect(example).toEqual({ request: {}, response: { id: 1 } });
  });

  it('accepts the whole 100-599 range at its edges', () => {
    expect(healed([{ request: {}, response: {}, statusCode: 100 }])[0].statusCode).toBe(100);
    expect(healed([{ request: {}, response: {}, statusCode: 599 }])[0].statusCode).toBe(599);
  });

  it('works with a response-only or request-only example and keeps several examples apart', () => {
    const out = healed([
      { response: { id: 1 } },
      { request: { name: 'x' }, statusCode: 201 },
      { response: { error: 'gone' }, statusCode: 410 },
    ]);
    expect(out).toEqual([
      { request: {}, response: { id: 1 } },
      { request: { name: 'x' }, response: {}, statusCode: 201 },
      { request: {}, response: { error: 'gone' }, statusCode: 410 },
    ]);
  });

  it('a flat example (no request/response wrapper) is still wrapped as before, its fields are the response', () => {
    expect(healed([{ id: 1, name: 'Ada' }])).toEqual([{ request: {}, response: { id: 1, name: 'Ada' } }]);
  });
});

describe('the system prompt asks for a statusCode in each example', () => {
  it('has one sentence about it and keeps the documented output format', () => {
    expect(SYSTEM_PROMPT).toMatch(/statusCode/);
    expect(SYSTEM_PROMPT).toContain('"examples"');
    expect(SYSTEM_PROMPT.match(/statusCode/g)!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('saved responses keep the example status', () => {
  const projectId = new mongoose.Types.ObjectId().toString();

  beforeAll(async () => {
    await connectDB();
  });
  afterAll(async () => {
    await Promise.all([MockAPIModel, EndpointModel, ResponseModel].map((m) => (m as any).deleteMany({})));
    await disconnectDB();
  });

  it('a 404 example is stored with statusCode 404 and the 200 one with 200', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const validated = validateGeneratedApi(
      spec([
        { request: {}, response: { id: 'm1' } },
        { request: {}, response: { error: 'Member not found' }, statusCode: 404 },
        { request: {}, response: { error: 'Unauthorized' }, status: 401 },
      ])
    );
    const result = await populateEndpointsFromLLM(projectId, validated);
    expect(result.responsesCreated).toBe(3);

    const endpoint = await EndpointModel.findOne({ path: '/members/:id' }).populate('responses');
    const codes = (endpoint!.responses as unknown as Array<{ statusCode: number; examples: unknown[] }>).map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 401, 404]);
    jest.restoreAllMocks();
  });
});
