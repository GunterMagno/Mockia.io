import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractJsonFromLLMOutput, tryExtractJsonFromLLMOutput } from '../modules/ai/llmOutputParser.js';
import { validateGeneratedApi, MAX_GENERATED_ENDPOINTS } from '../modules/ai/llmOutputValidator.js';
import { findSchemaProblem, MAX_SCHEMA_DEPTH } from '../utils/parsers/schemaGuard.js';
import { parseSwaggerFile } from '../utils/parsers/swaggerParser.js';
import { normalizeType, extractBaseType } from '../utils/parsers/typeNormalizer.js';
import { buildSampleData } from '../modules/ai/fakeDataProvider.js';

const nest = (depth: number): unknown => {
  let v: unknown = { leaf: true };
  for (let i = 0; i < depth; i++) v = { child: v };
  return v;
};

describe('llmOutputParser: malformed JSON', () => {
  it.each([
    ['{"a": 1,}'],
    ['{"a": '],
    ['```json\n{"a": 1\n```'],
    ['no json here at all'],
    ['42'],
    ['null'],
    ['"str"'],
  ])('rejects %j with an error, never hangs or returns a primitive', (input) => {
    expect(() => extractJsonFromLLMOutput(input)).toThrow();
    expect(tryExtractJsonFromLLMOutput(input)).toBeNull();
  });

  it.each([[''], [undefined], [null], [123], [{}]])('rejects non-string input %j', (input) => {
    expect(() => extractJsonFromLLMOutput(input as unknown as string)).toThrow(/Invalid input/);
  });

  it('extracts JSON from markdown, prose and arrays', () => {
    expect(extractJsonFromLLMOutput('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonFromLLMOutput('Here: {"a":1} done')).toEqual({ a: 1 });
    expect(extractJsonFromLLMOutput('[1,2]')).toEqual([1, 2]);
    expect(extractJsonFromLLMOutput('```text\nnope\n```\n{"ok":true}')).toEqual({ ok: true });
  });

  it('rejects outputs above the size limit', () => {
    expect(() => extractJsonFromLLMOutput('{"a":"' + 'x'.repeat(2_000_001) + '"}')).toThrow(/too large/);
  });

  it('handles a pathologically deep JSON string without a raw TypeError/RangeError escaping', () => {
    const deep = '['.repeat(200_000) + ']'.repeat(200_000);
    let thrown: unknown;
    try {
      extractJsonFromLLMOutput(deep);
    } catch (e) {
      thrown = e;
    }
    // Either parsed or rejected as AppError; never a bare RangeError.
    expect(thrown instanceof RangeError).toBe(false);
  });
});

describe('schemaGuard: depth, cycles and alias bombs', () => {
  it('accepts normal structures', () => {
    expect(findSchemaProblem(nest(5))).toBeNull();
    expect(findSchemaProblem({ a: [1, { b: 2 }], c: 'x' })).toBeNull();
  });

  it('flags depth beyond the limit without overflowing the stack', () => {
    expect(findSchemaProblem(nest(MAX_SCHEMA_DEPTH + 5))).toBe('depth');
    expect(findSchemaProblem(nest(100_000))).toBe('depth');
  });

  it('flags circular references (the JS equivalent of a circular $ref)', () => {
    const a: Record<string, unknown> = { name: 'A' };
    const b: Record<string, unknown> = { name: 'B', a };
    a.b = b;
    expect(findSchemaProblem(a)).toBe('cycle');
    const self: unknown[] = [];
    self.push(self);
    expect(findSchemaProblem(self)).toBe('cycle');
  });

  it('a shared (non-cyclic) node referenced many times is not a cycle', () => {
    const shared = { x: 1 };
    expect(findSchemaProblem({ a: shared, b: shared, c: [shared, shared] })).toBeNull();
  });

  it('billion-laughs style DAG finishes fast', () => {
    let node: unknown = ['lol', 'lol'];
    for (let i = 0; i < 25; i++) node = [node, node];
    const t0 = Date.now();
    findSchemaProblem(node, 64);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('flags too many nodes', () => {
    expect(findSchemaProblem(Array.from({ length: 50 }, () => ({})), 32, 10)).toBe('nodes');
  });
});

describe('llmOutputValidator: complexity limits', () => {
  const base = (extra: Record<string, unknown> = {}) => ({
    apiVersion: '1.0.0',
    title: 't',
    description: 'd',
    dataModels: [],
    endpoints: [{ path: '/a', method: 'GET', description: 'x' }],
    ...extra,
  });

  it('accepts a normal spec', () => {
    expect(validateGeneratedApi(base()).title).toBe('t');
  });

  it('rejects too many endpoints', () => {
    const endpoints = Array.from({ length: MAX_GENERATED_ENDPOINTS + 1 }, (_, i) => ({
      path: `/p${i}`,
      method: 'GET',
      description: 'x',
    }));
    expect(() => validateGeneratedApi(base({ endpoints }))).toThrow(/too large/);
  });

  it('rejects deeply nested and circular schemas', () => {
    expect(() =>
      validateGeneratedApi(base({ dataModels: [{ name: 'M', schema: nest(60) }] }))
    ).toThrow(/too complex/);
    const cyc: Record<string, unknown> = { type: 'object' };
    cyc.properties = { self: cyc };
    expect(() => validateGeneratedApi(base({ dataModels: [{ name: 'M', schema: cyc }] }))).toThrow(/too complex/);
  });
});

describe('swaggerParser: hostile specs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mockia-swagger-'));
  const write = (name: string, content: string) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, content);
    return p;
  };
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('parses a spec with a self-referencing $ref schema (refs are kept as data, not resolved)', async () => {
    const file = write(
      'tree.yaml',
      [
        'openapi: 3.0.0',
        'info: { title: T }',
        'paths:',
        '  /nodes:',
        '    get:',
        '      responses:',
        '        "200":',
        '          description: ok',
        '          content:',
        '            application/json:',
        '              schema: { $ref: "#/components/schemas/Node" }',
        'components:',
        '  schemas:',
        '    Node:',
        '      type: object',
        '      properties:',
        '        children:',
        '          type: array',
        '          items: { $ref: "#/components/schemas/Node" }',
      ].join('\n')
    );
    const parsed = await parseSwaggerFile(file);
    expect(parsed.paths).toHaveLength(1);
    expect(parsed.components[0].name).toBe('Node');
  });

  it('rejects YAML with a real alias cycle instead of returning a cyclic object', async () => {
    const file = write('cycle.yaml', 'openapi: 3.0.0\npaths: {}\nloop: &a\n  self: *a\n');
    await expect(parseSwaggerFile(file)).rejects.toThrow(/structure rejected \(cycle\)/);
  });

  it('rejects empty, non-mapping and malformed files with a normal Error', async () => {
    await expect(parseSwaggerFile(write('empty.yaml', ''))).rejects.toThrow(/root must be/);
    await expect(parseSwaggerFile(write('list.yaml', '- a\n- b\n'))).rejects.toThrow(/root must be/);
    await expect(parseSwaggerFile(write('bad.yaml', 'a: [1, 2\nb: {'))).rejects.toThrow(/Failed to parse/);
    await expect(parseSwaggerFile(path.join(tmp, 'missing.yaml'))).rejects.toThrow(/File not found/);
  });
});

describe('typeNormalizer / fakeDataProvider limits', () => {
  it('long unbalanced generics are truncated (ReDoS guard) and do not throw', () => {
    const evil = 'Array<'.repeat(50_000);
    const t0 = Date.now();
    expect(() => normalizeType(evil)).not.toThrow();
    expect(() => extractBaseType(evil)).not.toThrow();
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(normalizeType(undefined as unknown as string).normalized).toBe('');
  });

  it('buildSampleData survives 0, negative, NaN and huge counts', () => {
    expect(() => buildSampleData({ userCount: 0, productCount: 0, orderCount: -3 })).not.toThrow();
    expect(() => buildSampleData({ userCount: NaN })).not.toThrow();
    expect(buildSampleData({ userCount: 1e9 }).users.length).toBeLessThanOrEqual(100);
  });
});
