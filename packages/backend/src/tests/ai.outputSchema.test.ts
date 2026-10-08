import { Ajv } from 'ajv';
import { MOCK_SPEC_JSON_SCHEMA } from '../modules/ai/outputSchema.js';
import { validateGeneratedApi } from '../modules/ai/llmOutputValidator.js';

/**
 * MOCK_SPEC_JSON_SCHEMA is what a local server (Ollama / vLLM) uses to constrain decoding. It must describe what the
 * production validator accepts, so a constrained model cannot produce something the pipeline then rejects.
 */

const ajv = new Ajv({ allErrors: true });
const validateSchema = ajv.compile(MOCK_SPEC_JSON_SCHEMA);
const schemaAccepts = (data: unknown) => validateSchema(data) === true;
const validatorAccepts = (data: unknown) => {
  try {
    // the validator heals examples in place: give it a copy
    validateGeneratedApi(JSON.parse(JSON.stringify(data)));
    return true;
  } catch {
    return false;
  }
};

const endpoint = (over: Record<string, unknown> = {}) => ({
  path: '/api/members',
  method: 'GET',
  description: 'List members',
  requestSchema: { type: 'object', properties: {}, required: [] },
  responseSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  examples: [{ request: {}, response: { id: 'm1' } }],
  ...over,
});
const api = (over: Record<string, unknown> = {}) => ({
  apiVersion: '1.0.0',
  title: 'Gym API',
  description: 'Members',
  endpoints: [endpoint()],
  dataModels: [{ name: 'Member', schema: { type: 'object', properties: {}, required: [] } }],
  ...over,
});
const without = (key: string) => {
  const a: Record<string, unknown> = api();
  delete a[key];
  return a;
};

describe('MOCK_SPEC_JSON_SCHEMA', () => {
  it('is a valid JSON Schema describing an object', () => {
    expect(ajv.validateSchema(MOCK_SPEC_JSON_SCHEMA)).toBe(true);
    expect((MOCK_SPEC_JSON_SCHEMA as { type: string }).type).toBe('object');
  });

  it('is JSON-serializable (it travels in the request body)', () => {
    expect(JSON.parse(JSON.stringify(MOCK_SPEC_JSON_SCHEMA))).toEqual(MOCK_SPEC_JSON_SCHEMA);
  });

  it('accepts the sample the validator accepts', () => {
    const sample = api();
    expect(validatorAccepts(sample)).toBe(true);
    expect(schemaAccepts(sample)).toBe(true);
  });

  it('accepts all five HTTP methods, several endpoints and no data models', () => {
    const sample = api({
      endpoints: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((method) => endpoint({ method, path: `/api/${method.toLowerCase()}` })),
      dataModels: [],
    });
    expect(validatorAccepts(sample)).toBe(true);
    expect(schemaAccepts(sample)).toBe(true);
  });

  it('accepts endpoints without requestSchema/responseSchema (optional for the validator)', () => {
    const bare = api({ endpoints: [{ path: '/x', method: 'GET', description: 'd', examples: [{ request: {}, response: {} }] }] });
    expect(validatorAccepts(bare)).toBe(true);
    expect(schemaAccepts(bare)).toBe(true);
  });

  const INVALID: Array<[string, unknown]> = [
    ['not an object (array)', [api()]],
    ['not an object (string)', 'hello'],
    ['null', null],
    ['missing apiVersion', without('apiVersion')],
    ['missing title', without('title')],
    ['missing description', without('description')],
    ['missing endpoints', without('endpoints')],
    ['missing dataModels', without('dataModels')],
    ['apiVersion not a string', api({ apiVersion: 1 })],
    ['title not a string', api({ title: null })],
    ['endpoints not an array', api({ endpoints: {} })],
    ['endpoints empty', api({ endpoints: [] })],
    ['endpoint is a string', api({ endpoints: ['GET /x'] })],
    ['endpoint without path', api({ endpoints: [endpoint({ path: undefined })] })],
    ['endpoint path not a string', api({ endpoints: [endpoint({ path: 7 })] })],
    ['endpoint without method', api({ endpoints: [endpoint({ method: undefined })] })],
    ['invalid method FETCH', api({ endpoints: [endpoint({ method: 'FETCH' })] })],
    ['lowercase method', api({ endpoints: [endpoint({ method: 'get' })] })],
    ['endpoint without description', api({ endpoints: [endpoint({ description: undefined })] })],
    ['requestSchema not an object', api({ endpoints: [endpoint({ requestSchema: 'x' })] })],
    ['responseSchema not an object', api({ endpoints: [endpoint({ responseSchema: 5 })] })],
    ['dataModels not an array', api({ dataModels: {} })],
    ['dataModel without name', api({ dataModels: [{ schema: {} }] })],
    ['dataModel without schema', api({ dataModels: [{ name: 'M' }] })],
    ['dataModel schema not an object', api({ dataModels: [{ name: 'M', schema: 'x' }] })],
  ];

  it.each(INVALID)('rejects, like the validator: %s', (_name, data) => {
    expect(validatorAccepts(data)).toBe(false);
    expect(schemaAccepts(data)).toBe(false);
  });

  it('is stricter than the validator only on examples: the validator heals flat examples, the schema asks for { request, response }', () => {
    const flat = api({ endpoints: [endpoint({ examples: [{ id: 'm1' }] })] });
    expect(validatorAccepts(flat)).toBe(true);
    expect(schemaAccepts(flat)).toBe(false);
    const missing = api({ endpoints: [endpoint({ examples: undefined })] });
    expect(validatorAccepts(missing)).toBe(true);
    expect(schemaAccepts(missing)).toBe(true);
  });

  it('declares exactly the properties and requirements the validator reads', () => {
    const schema = MOCK_SPEC_JSON_SCHEMA as any;
    expect(Object.keys(schema.properties).sort()).toEqual(['apiVersion', 'dataModels', 'description', 'endpoints', 'title']);
    expect([...schema.required].sort()).toEqual(['apiVersion', 'dataModels', 'description', 'endpoints', 'title']);
    const item = schema.properties.endpoints.items;
    expect([...item.required].sort()).toEqual(['description', 'method', 'path']);
    expect(item.properties.method.enum).toEqual(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);
    expect(schema.properties.endpoints.minItems).toBe(1);
  });
});

describe('MOCK_SPEC_JSON_SCHEMA: example bodies and status codes', () => {
  const withExample = (example: unknown) => api({ endpoints: [endpoint({ examples: [example] })] });

  it.each([
    ['object request and object response', { request: {}, response: { id: 'm1' } }],
    ['object request and array response (list endpoint)', { request: {}, response: [{ id: 'm1' }] }],
    ['array request (bulk create) and array response', { request: [{ name: 'a' }], response: [{ id: 'm1' }] }],
    ['empty array response', { request: {}, response: [] }],
  ])('accepts, like the validator: %s', (_name, example) => {
    expect(validatorAccepts(withExample(example))).toBe(true);
    expect(schemaAccepts(withExample(example))).toBe(true);
  });

  it.each([
    ['string response', { request: {}, response: 'ok' }],
    ['number response', { request: {}, response: 42 }],
    ['null response', { request: {}, response: null }],
    ['string request', { request: 'x', response: {} }],
  ])('rejects a primitive body, which the validator would only heal: %s', (_name, example) => {
    expect(validatorAccepts(withExample(example))).toBe(true); // healed into a flat response
    expect(schemaAccepts(withExample(example))).toBe(false);
  });

  it('keeps requestSchema and responseSchema as objects (arrays are not JSON Schemas)', () => {
    expect(schemaAccepts(api({ endpoints: [endpoint({ responseSchema: [] })] }))).toBe(false);
    expect(schemaAccepts(api({ endpoints: [endpoint({ requestSchema: [] })] }))).toBe(false);
  });

  it.each([200, 201, 404, 100, 599])('accepts an example with statusCode %i', (statusCode) => {
    const sample = withExample({ request: {}, response: { error: 'x' }, statusCode });
    expect(validatorAccepts(sample)).toBe(true);
    expect(schemaAccepts(sample)).toBe(true);
  });

  it.each([99, 600, 404.5, '404', null, true])('rejects statusCode %p', (statusCode) => {
    expect(schemaAccepts(withExample({ request: {}, response: {}, statusCode }))).toBe(false);
  });
});
