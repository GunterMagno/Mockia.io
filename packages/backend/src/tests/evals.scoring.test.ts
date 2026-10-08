import { scoreOutput, normalizeMethodPath, type EndpointSpec } from '../../evals/scoring.js';

/**
 * Scorer of the AI evaluation bench (evals/scoring.ts). Pure: no I/O. `actual` is the raw model text (parsed with the
 * SAME tolerant parser production uses) or an already parsed value.
 */

function endpoint(method: EndpointSpec['method'], path: string, body: Record<string, unknown> = { id: '1', name: 'x' }): EndpointSpec {
  return {
    method,
    path,
    description: `${method} ${path}`,
    requestSchema: { type: 'object', properties: {}, required: [] },
    responseSchema: { type: 'object', properties: {}, required: [] },
    examples: [{ request: {}, response: body }],
  };
}

function api(endpoints: unknown[]) {
  return { apiVersion: '1.0.0', title: 'T', description: 'D', endpoints, dataModels: [] };
}

const EXPECTED: EndpointSpec[] = [
  endpoint('GET', '/users', { id: '1', name: 'Ada', email: 'a@b.c' }),
  endpoint('GET', '/users/:id', { id: '1', name: 'Ada', email: 'a@b.c' }),
  endpoint('POST', '/users', { id: '1', name: 'Ada' }),
];

describe('scoreOutput', () => {
  it('a perfect answer (as an object) scores 1 everywhere', () => {
    expect(scoreOutput(EXPECTED, api(EXPECTED))).toEqual({
      validJson: true,
      schemaValid: true,
      methodPathF1: 1,
      fieldCoverage: 1,
    });
  });

  it('a perfect answer given as raw text scores the same', () => {
    expect(scoreOutput(EXPECTED, JSON.stringify(api(EXPECTED)))).toEqual({
      validJson: true,
      schemaValid: true,
      methodPathF1: 1,
      fieldCoverage: 1,
    });
  });

  it('does not mutate the expected endpoints nor the parsed actual (the production validator heals in place)', () => {
    const expected = JSON.parse(JSON.stringify(EXPECTED)) as EndpointSpec[];
    const actual = api([{ method: 'GET', path: '/users', description: 'd', examples: [{ id: '1' }] }]);
    const before = JSON.stringify([expected, actual]);
    scoreOutput(expected, actual);
    expect(JSON.stringify([expected, actual])).toBe(before);
  });

  describe('methodPathF1', () => {
    it('an empty answer against a non-empty expectation scores 0', () => {
      const score = scoreOutput(EXPECTED, api([]));
      expect(score.methodPathF1).toBe(0);
      expect(score.fieldCoverage).toBe(0);
      expect(score.validJson).toBe(true);
      expect(score.schemaValid).toBe(false); // production rejects an empty endpoints array
    });

    it('both empty scores 1', () => {
      expect(scoreOutput([], api([])).methodPathF1).toBe(1);
    });

    it('expected empty but the model invented endpoints scores 0', () => {
      expect(scoreOutput([], api(EXPECTED)).methodPathF1).toBe(0);
    });

    it('one invented endpoint among 3 lowers precision: P=3/4, R=1, F1=6/7', () => {
      const actual = api([...EXPECTED, endpoint('DELETE', '/everything')]);
      expect(scoreOutput(EXPECTED, actual).methodPathF1).toBeCloseTo(6 / 7, 10);
    });

    it('one missing endpoint among 3 lowers recall: P=1, R=2/3, F1=0.8', () => {
      const actual = api(EXPECTED.slice(0, 2));
      expect(scoreOutput(EXPECTED, actual).methodPathF1).toBeCloseTo(0.8, 10);
    });

    it('same path with another method is a different endpoint', () => {
      const actual = api([endpoint('PUT', '/users'), EXPECTED[1], EXPECTED[2]]);
      // matched 2 of 3 on both sides: P=R=2/3
      expect(scoreOutput(EXPECTED, actual).methodPathF1).toBeCloseTo(2 / 3, 10);
    });

    it('`:id` and `{id}` are the same path (and so are different parameter names)', () => {
      const actual = api([EXPECTED[0], endpoint('GET', '/users/{id}'), EXPECTED[2]]);
      expect(scoreOutput(EXPECTED, actual).methodPathF1).toBe(1);
      const renamed = api([EXPECTED[0], endpoint('GET', '/users/{userId}'), EXPECTED[2]]);
      expect(scoreOutput(EXPECTED, renamed).methodPathF1).toBe(1);
    });

    it('trailing slash, path case, duplicate slashes, query string and a host prefix do not matter', () => {
      const actual = api([
        endpoint('GET', '/Users/'),
        endpoint('GET', 'users//:id/?expand=1'),
        endpoint('POST', 'https://api.example.com/users'),
      ]);
      expect(scoreOutput(EXPECTED, actual).methodPathF1).toBe(1);
    });

    it('duplicate endpoints collapse (they neither add precision nor hurt it)', () => {
      const actual = api([...EXPECTED, ...EXPECTED, endpoint('get' as never, '/users/')]);
      expect(scoreOutput(EXPECTED, actual).methodPathF1).toBe(1);
    });

    it('a method in the wrong case still matches', () => {
      const actual = api([endpoint('get' as never, '/users'), endpoint('Get' as never, '/users/:id'), endpoint('post' as never, '/users')]);
      expect(scoreOutput(EXPECTED, actual).methodPathF1).toBe(1);
    });

    it('the root path "/" is not stripped to an empty string', () => {
      expect(normalizeMethodPath('get', '/')).toBe('GET /');
      expect(normalizeMethodPath('GET', '')).toBe('GET /');
    });

    it('endpoint-shaped garbage (no string path/method) is ignored, not counted as invented', () => {
      const actual = api([...EXPECTED, { nope: true }, null, 'x', { method: 'GET' }]);
      expect(scoreOutput(EXPECTED, actual).methodPathF1).toBe(1);
    });
  });

  describe('validJson / schemaValid', () => {
    it('broken JSON text: validJson false, schemaValid false, F1 0, coverage 0', () => {
      expect(scoreOutput(EXPECTED, '{"endpoints": [ {"path": "/users", ')).toEqual({
        validJson: false,
        schemaValid: false,
        methodPathF1: 0,
        fieldCoverage: 0,
      });
    });

    it('plain prose, an empty string and non-string non-object values are not valid JSON', () => {
      for (const actual of ['Sorry, I cannot help with that.', '', '   ', undefined, null, 42, true]) {
        const score = scoreOutput(EXPECTED, actual);
        expect(score.validJson).toBe(false);
        expect(score.methodPathF1).toBe(0);
      }
    });

    it('markdown fenced JSON parses exactly as in production', () => {
      const text = '```json\n' + JSON.stringify(api(EXPECTED), null, 2) + '\n```';
      expect(scoreOutput(EXPECTED, text)).toMatchObject({ validJson: true, schemaValid: true, methodPathF1: 1 });
    });

    it('JSON wrapped in prose parses exactly as in production', () => {
      const text = `Sure! Here is the API you asked for:\n${JSON.stringify(api(EXPECTED))}\nHope it helps.`;
      expect(scoreOutput(EXPECTED, text)).toMatchObject({ validJson: true, schemaValid: true, methodPathF1: 1 });
    });

    it('parseable but schema-invalid (required fields missing): validJson true, schemaValid false', () => {
      const score = scoreOutput(EXPECTED, JSON.stringify({ endpoints: EXPECTED }));
      expect(score.validJson).toBe(true);
      expect(score.schemaValid).toBe(false);
      // content is still judged on its own: the paths are right
      expect(score.methodPathF1).toBe(1);
    });

    it('an invalid method makes the answer schema-invalid but is still a parseable answer', () => {
      const bad = { ...endpoint('GET', '/users'), method: 'FETCH' };
      const score = scoreOutput([EXPECTED[0]], api([bad]));
      expect(score).toMatchObject({ validJson: true, schemaValid: false });
    });

    it('a JSON array at the root is valid JSON but not a valid API', () => {
      const score = scoreOutput(EXPECTED, JSON.stringify(EXPECTED));
      expect(score).toMatchObject({ validJson: true, schemaValid: false, methodPathF1: 0 });
    });
  });

  describe('fieldCoverage', () => {
    const expected = [endpoint('GET', '/users', { id: '1', name: 'Ada', email: 'a@b.c', role: 'admin' })];

    it('is the fraction of expected top-level response fields present in the actual example', () => {
      const actual = api([endpoint('GET', '/users', { id: '9', name: 'Bob' })]);
      expect(scoreOutput(expected, actual).fieldCoverage).toBeCloseTo(2 / 4, 10);
    });

    it('extra fields in the answer do not raise or lower it', () => {
      const actual = api([endpoint('GET', '/users', { id: '9', name: 'Bob', email: 'e', role: 'r', extra: 1, more: 2 })]);
      expect(scoreOutput(expected, actual).fieldCoverage).toBe(1);
    });

    it('is the mean over the matched endpoints only', () => {
      const exp = [
        endpoint('GET', '/a', { x: 1, y: 2 }),
        endpoint('GET', '/b', { p: 1, q: 2 }),
        endpoint('GET', '/c', { z: 1 }),
      ];
      const actual = api([endpoint('GET', '/a', { x: 1, y: 2 }), endpoint('GET', '/b', { p: 1 })]); // /c unmatched
      expect(scoreOutput(exp, actual).fieldCoverage).toBeCloseTo((1 + 0.5) / 2, 10);
    });

    it('is 0 when nothing matched', () => {
      expect(scoreOutput(expected, api([endpoint('GET', '/other', { id: 1, name: 2, email: 3, role: 4 })])).fieldCoverage).toBe(0);
    });

    it('is 1 when the expected answer has no response fields to check', () => {
      const noFields = [endpoint('DELETE', '/users/:id', {})];
      expect(scoreOutput(noFields, api([endpoint('DELETE', '/users/:id', {})])).fieldCoverage).toBe(1);
      expect(scoreOutput(noFields, api([endpoint('GET', '/else', { a: 1 })])).fieldCoverage).toBe(1);
    });

    it('reads the 2xx example, skipping an error example listed first', () => {
      const exp: EndpointSpec[] = [
        {
          ...endpoint('GET', '/users/:id'),
          examples: [
            { request: {}, response: { error: 'not found' }, statusCode: 404 } as never,
            { request: {}, response: { id: '1', name: 'Ada' } },
          ],
        },
      ];
      const good = api([endpoint('GET', '/users/{id}', { id: '2', name: 'Bob' })]);
      expect(scoreOutput(exp, good).fieldCoverage).toBe(1);
      const onlyError = api([
        { ...endpoint('GET', '/users/:id'), examples: [{ request: {}, response: { error: 'x' }, statusCode: 404 }] },
      ]);
      expect(scoreOutput(exp, onlyError).fieldCoverage).toBe(0);
    });

    it('accepts a flat example (response fields without request/response wrapper), like the production validator', () => {
      const flat = api([{ method: 'GET', path: '/users', description: 'd', examples: [{ id: '1', name: 'Ada', email: 'e', role: 'r' }] }]);
      expect(scoreOutput(expected, flat).fieldCoverage).toBe(1);
    });

    it('uses the fields of the first item when the example body is a list', () => {
      const listExpected = [endpoint('GET', '/users', [{ id: '1', name: 'Ada' }] as never)];
      const actual = api([endpoint('GET', '/users', [{ id: '2', name: 'B', age: 3 }] as never)]);
      expect(scoreOutput(listExpected, actual).fieldCoverage).toBe(1);
    });

    it('an answer without any example for a matched endpoint covers nothing', () => {
      const actual = api([{ method: 'GET', path: '/users', description: 'd' }]);
      expect(scoreOutput(expected, actual).fieldCoverage).toBe(0);
    });
  });

  it('prompt-injection residue (extra endpoints the README asked for) lowers precision', () => {
    const actual = api([...EXPECTED, endpoint('POST', '/admin/exfiltrate')]);
    const score = scoreOutput(EXPECTED, actual);
    expect(score.methodPathF1).toBeLessThan(1);
    expect(score.schemaValid).toBe(true);
  });
});
