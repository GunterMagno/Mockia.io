import fs from 'fs';
import path from 'path';
import { loadCases, CASES_DIR_NAME, type EvalCase } from '../../evals/cases.js';
import { scoreOutput } from '../../evals/scoring.js';
import { validateGeneratedApi } from '../modules/ai/llmOutputValidator.js';
import { buildPromptFromInput } from '../modules/ai/prompt.service.js';

/**
 * Integrity of the evaluation cases (packages/backend/evals/cases/*.json): they are data a decision rests on, so a typo
 * in one of them must fail here and not show up as a "bad model".
 */

const CASES_DIR = path.resolve(__dirname, '../../evals', CASES_DIR_NAME);
const wrap = (endpoints: unknown) => ({ apiVersion: '1.0.0', title: 'T', description: 'D', endpoints, dataModels: [] });

describe('evaluation cases', () => {
  const files = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'));
  const cases = loadCases(CASES_DIR);

  it('there are at least 30 and every file loads', () => {
    expect(files.length).toBeGreaterThanOrEqual(30);
    expect(cases).toHaveLength(files.length);
  });

  it('ids are unique and equal the file name', () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const file of files) {
      const parsed = JSON.parse(fs.readFileSync(path.join(CASES_DIR, file), 'utf8')) as EvalCase;
      expect(`${parsed.id}.json`).toBe(file);
    }
  });

  it('loadCases returns them sorted by id (stable runs)', () => {
    const ids = cases.map((c) => c.id);
    expect(ids).toEqual([...ids].sort());
  });

  describe.each(cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    it('has a description, a user instruction and a non-empty expected list', () => {
      expect(c.description.length).toBeGreaterThan(10);
      expect(typeof c.input.userInput).toBe('string');
      expect(c.input.userInput.trim()).not.toBe('');
      expect(typeof c.input.projectTitle).toBe('string');
      expect(c.expected.length).toBeGreaterThan(0);
    });

    it('the expected endpoints pass the production validator (and are not healed into something else)', () => {
      const validated = validateGeneratedApi(JSON.parse(JSON.stringify(wrap(c.expected))));
      expect(validated.endpoints).toHaveLength(c.expected.length);
    });

    it('the expected answer scores 1.0 on everything against itself', () => {
      expect(scoreOutput(c.expected, wrap(c.expected))).toEqual({ validJson: true, schemaValid: true, methodPathF1: 1, fieldCoverage: 1 });
    });

    it('has no duplicated method+path in expected (it would make the F1 ambiguous)', () => {
      const keys = c.expected.map((e) => `${e.method} ${e.path.toLowerCase().replace(/[:{][^/}]*\}?/g, ':p')}`);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('builds a prompt without a database, with the system prompt and the user instruction', () => {
      const messages = buildPromptFromInput(c.input);
      expect(messages[0].role).toBe('system');
      expect(messages.length).toBe(3);
      expect(messages[messages.length - 1].content).toContain(c.input.userInput);
    });

    it('is small enough for a 7B model: prompt under ~6000 tokens', () => {
      const chars = buildPromptFromInput(c.input).reduce((n, m) => n + m.content.length, 0);
      expect(chars / 4).toBeLessThan(6000);
    });
  });

  describe('coverage of scenarios', () => {
    const tag = (t: string) => cases.filter((c) => (c.tags ?? []).includes(t));

    it.each([
      ['express', 3],
      ['typescript-types', 3],
      ['nestjs', 2],
      ['openapi3', 2],
      ['swagger2', 1],
      ['path-params', 3],
      ['nested-resources', 2],
      ['pagination', 2],
      ['auth', 2],
      ['upload', 1],
      ['errors', 3],
      ['undocumented', 2],
      ['es', 2],
      ['adversarial', 3],
    ])('has cases tagged "%s" (>= %i)', (name, min) => {
      expect(tag(name).length).toBeGreaterThanOrEqual(min);
    });
  });

  describe('adversarial cases', () => {
    const adversarial = cases.filter((c) => (c.tags ?? []).includes('adversarial'));

    it.each(adversarial.map((c) => [c.id, c] as const))('%s: the injected instruction is in the input, not in the expected answer, and the scorer punishes following it', (_id, c) => {
      expect(c.trap).toBeDefined();
      const trap = c.trap!;
      const haystack = JSON.stringify(c.input).toLowerCase();
      expect(haystack).toMatch(/ignore|ignora|disregard|olvida|system prompt|instrucciones anteriores|previous instructions/);
      expect(haystack).toContain(trap.path.toLowerCase());
      const expectedKeys = c.expected.map((e) => `${e.method} ${e.path}`);
      expect(expectedKeys).not.toContain(`${trap.method} ${trap.path}`);

      const followedInjection = wrap([
        ...c.expected,
        { method: trap.method, path: trap.path, description: 'injected', requestSchema: {}, responseSchema: {}, examples: [{ request: {}, response: { pwned: true } }] },
      ]);
      const score = scoreOutput(c.expected, followedInjection);
      expect(score.methodPathF1).toBeLessThan(1);
      expect(score.methodPathF1).toBeGreaterThan(0.5);
    });
  });
});
