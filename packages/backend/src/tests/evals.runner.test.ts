import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import { runEval, parseArgs, resultFileName } from '../../evals/runner.js';
import { loadCases, CASES_DIR_NAME } from '../../evals/cases.js';
import { createFakeProvider } from '../../evals/fakeProviders.js';
import { MOCK_SPEC_JSON_SCHEMA } from '../modules/ai/outputSchema.js';
import { resetLlm } from '../modules/ai/providers/index.js';

const CASES_DIR = path.resolve(__dirname, '../../evals', CASES_DIR_NAME);
const cases = loadCases(CASES_DIR);

describe('eval runner (in process)', () => {
  let outDir: string;
  let lines: string[];
  const log = (line: string) => lines.push(line);

  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockia-eval-'));
    lines = [];
  });
  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  describe('fake-perfect (self-test of the harness)', () => {
    it('scores 1.0 on every metric over all the cases and exits 0', async () => {
      const { result, exitCode } = await runEval({ provider: 'fake-perfect', casesDir: CASES_DIR, outDir, log });
      expect(result.rows).toHaveLength(cases.length);
      expect(result.summary).toMatchObject({
        cases: cases.length,
        validJsonPct: 100,
        schemaValidPct: 100,
        meanMethodPathF1: 1,
        meanFieldCoverage: 1,
        errors: 0,
      });
      expect(result.criteria.pass).toBe(true);
      expect(exitCode).toBe(0);
      expect(result.provider).toBe('fake-perfect');
      for (const r of result.rows) {
        expect(r).toMatchObject({ validJson: true, schemaValid: true, methodPathF1: 1, fieldCoverage: 1 });
        expect(r.error).toBeUndefined();
        expect(r.latencyMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('prints a per-case table, the summary and a PASS line against the acceptance criteria', async () => {
      await runEval({ provider: 'fake-perfect', casesDir: CASES_DIR, outDir, log, limit: 3 });
      const out = lines.join('\n');
      expect(out).toContain(cases[0].id);
      expect(out).toMatch(/validJson%\s*:?\s*100/);
      expect(out).toMatch(/schemaValid%\s*:?\s*100/);
      expect(out).toMatch(/methodPathF1\s*:?\s*1\.000/);
      expect(out).toMatch(/latency p50/);
      expect(out).toMatch(/latency p95/);
      expect(out).toMatch(/^PASS/m);
    });

    it('--limit runs only the first N cases (sorted by id)', async () => {
      const { result } = await runEval({ provider: 'fake-perfect', casesDir: CASES_DIR, outDir, log, limit: 4 });
      expect(result.rows.map((r) => r.id)).toEqual(cases.slice(0, 4).map((c) => c.id));
    });

    it('concurrency does not change the rows nor their order', async () => {
      const serial = await runEval({ provider: 'fake-perfect', casesDir: CASES_DIR, outDir, log, concurrency: 1 });
      const parallel = await runEval({ provider: 'fake-perfect', casesDir: CASES_DIR, outDir, log, concurrency: 5 });
      const strip = (rows: typeof serial.result.rows) => rows.map(({ latencyMs: _l, tokensPerSecond: _t, ...rest }) => rest);
      expect(strip(parallel.result.rows)).toEqual(strip(serial.result.rows));
    });
  });

  describe('fake-noisy (the metrics move)', () => {
    it('stays below the thresholds, exits 1 and prints FAIL', async () => {
      const { result, exitCode } = await runEval({ provider: 'fake-noisy', casesDir: CASES_DIR, outDir, log });
      expect(result.summary.validJsonPct).toBeLessThan(100);
      expect(result.summary.schemaValidPct).toBeLessThan(95);
      expect(result.summary.meanMethodPathF1).toBeLessThan(0.85);
      expect(result.summary.meanMethodPathF1).toBeGreaterThan(0.3); // degraded, not destroyed
      expect(result.summary.meanFieldCoverage).toBeLessThan(1);
      expect(result.criteria.pass).toBe(false);
      expect(exitCode).toBe(1);
      expect(lines.join('\n')).toMatch(/^FAIL/m);
    });

    it('is deterministic: same rows (scores) on every run', async () => {
      const a = await runEval({ provider: 'fake-noisy', casesDir: CASES_DIR, outDir, log });
      const b = await runEval({ provider: 'fake-noisy', casesDir: CASES_DIR, outDir, log });
      const scores = (r: typeof a.result) => r.rows.map(({ id, validJson, schemaValid, methodPathF1, fieldCoverage }) => ({ id, validJson, schemaValid, methodPathF1, fieldCoverage }));
      expect(scores(b.result)).toEqual(scores(a.result));
    });

    it('--no-fail keeps the verdict but exits 0 (exploratory runs)', async () => {
      const { result, exitCode } = await runEval({ provider: 'fake-noisy', casesDir: CASES_DIR, outDir, log, noFail: true });
      expect(result.criteria.pass).toBe(false);
      expect(exitCode).toBe(0);
    });

    it('covers every kind of degradation: broken JSON, schema break, dropped and invented endpoints', async () => {
      const { result } = await runEval({ provider: 'fake-noisy', casesDir: CASES_DIR, outDir, log });
      expect(result.rows.some((r) => !r.validJson)).toBe(true);
      expect(result.rows.some((r) => r.validJson && !r.schemaValid)).toBe(true);
      expect(result.rows.some((r) => r.schemaValid && r.methodPathF1 > 0 && r.methodPathF1 < 1)).toBe(true);
      expect(result.rows.some((r) => r.schemaValid && r.methodPathF1 === 1)).toBe(true);
    });
  });

  describe('output files and comparison', () => {
    it('writes <provider>-<model>-<timestamp>.json under --out with the full result', async () => {
      const { result, file } = await runEval({ provider: 'fake-perfect', casesDir: CASES_DIR, outDir, log, limit: 2 });
      expect(file).toBeDefined();
      expect(path.dirname(file!)).toBe(outDir);
      expect(path.basename(file!)).toMatch(/^fake-perfect-[^-].*-\d{8}T\d{6}Z\.json$/);
      const saved = JSON.parse(fs.readFileSync(file!, 'utf8'));
      expect(saved.summary).toEqual(result.summary);
      expect(saved.rows).toHaveLength(2);
      expect(saved.criteria.pass).toBe(true);
    });

    it('result file names are filesystem safe for models such as "qwen2.5-coder:7b-instruct" and "google/gemini-flash-1.5"', () => {
      const when = new Date('2026-10-08T12:34:56.789Z');
      expect(resultFileName('local', 'qwen2.5-coder:7b-instruct', when)).toBe('local-qwen2.5-coder-7b-instruct-20261008T123456Z.json');
      expect(resultFileName('openrouter', 'google/gemini-flash-1.5', when)).toBe('openrouter-google-gemini-flash-1.5-20261008T123456Z.json');
    });

    it('--compare prints the metrics against a previous result file', async () => {
      const first = await runEval({ provider: 'fake-perfect', casesDir: CASES_DIR, outDir, log, limit: 6 });
      lines = [];
      await runEval({ provider: 'fake-noisy', casesDir: CASES_DIR, outDir, log, limit: 6, noFail: true, compare: first.file });
      const out = lines.join('\n');
      expect(out).toMatch(/Comparison with/);
      expect(out).toMatch(/schemaValid%/);
      expect(out).toMatch(/methodPathF1/);
    });

    it('--compare with a missing or malformed file is a clear error', async () => {
      await expect(runEval({ provider: 'fake-perfect', casesDir: CASES_DIR, outDir, log, limit: 1, compare: path.join(outDir, 'nope.json') })).rejects.toThrow(/compare/i);
      const bad = path.join(outDir, 'bad.json');
      fs.writeFileSync(bad, '{"not":"a result"}');
      await expect(runEval({ provider: 'fake-perfect', casesDir: CASES_DIR, outDir, log, limit: 1, compare: bad })).rejects.toThrow(/compare/i);
    });
  });

  describe('errors', () => {
    it('an unknown provider name is rejected before running anything', async () => {
      await expect(runEval({ provider: 'gpt-9000', casesDir: CASES_DIR, outDir, log })).rejects.toThrow(/provider/i);
    });

    it('a provider that throws yields a zero row with the error class, and the run continues', async () => {
      const calls: string[] = [];
      const { result, exitCode } = await runEval({
        provider: 'fake-perfect',
        casesDir: CASES_DIR,
        outDir,
        log,
        limit: 3,
        providerFactory: (c) => {
          calls.push(c.id);
          return {
            name: 'boom',
            complete: async () => {
              throw Object.assign(new Error('secret prompt text'), { code: 'ECONNREFUSED' });
            },
          };
        },
      });
      expect(calls).toHaveLength(3);
      expect(result.rows.every((r) => r.error === 'connection_refused')).toBe(true);
      expect(result.rows.every((r) => !r.validJson && r.methodPathF1 === 0)).toBe(true);
      expect(result.summary.errors).toBe(3);
      expect(exitCode).toBe(1);
      expect(JSON.stringify(result)).not.toContain('secret prompt text'); // error class only, never messages
    });
  });

  describe('fake providers', () => {
    it('receive the real prompt (system + context + task) and the JSON schema', async () => {
      const seen: Array<{ roles: string[]; schema: unknown }> = [];
      await runEval({
        provider: 'fake-perfect',
        casesDir: CASES_DIR,
        outDir,
        log,
        limit: 2,
        providerFactory: (c) => {
          const inner = createFakeProvider('fake-perfect', c);
          return {
            name: inner.name,
            complete: async (req) => {
              seen.push({ roles: req.messages.map((m) => m.role), schema: req.jsonSchema });
              return inner.complete(req);
            },
          };
        },
      });
      expect(seen).toHaveLength(2);
      for (const s of seen) {
        expect(s.roles).toEqual(['system', 'user', 'user']);
        expect(s.schema).toBe(MOCK_SPEC_JSON_SCHEMA);
      }
    });
  });

  describe('real providers go through getLlm() configured with that single provider', () => {
    let server: http.Server;
    let seenBodies: any[];
    let url: string;
    const savedEnv = { ...process.env };

    beforeEach(async () => {
      seenBodies = [];
      server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          seenBodies.push(JSON.parse(raw));
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              model: 'served-by-fake',
              choices: [{ message: { content: 'Sorry, no.' } }],
              usage: { prompt_tokens: 100, completion_tokens: 50 },
            })
          );
        });
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resetLlm();
    });
    afterEach(async () => {
      await new Promise<void>((r) => server.close(() => r()));
      process.env = savedEnv;
      resetLlm();
    });

    it('--provider=local posts the real prompt and the schema, honours --model, and reports usage', async () => {
      const env = { ...process.env, AI_LOCAL_BASE_URL: url, AI_LOCAL_TIMEOUT_MS: '5000', OPENROUTER_API_KEY: '' };
      const { result } = await runEval({ provider: 'local', model: 'my-model:7b', casesDir: CASES_DIR, outDir, log, limit: 2, noFail: true, env });
      expect(seenBodies).toHaveLength(2);
      expect(seenBodies[0].model).toBe('my-model:7b');
      expect(seenBodies[0].messages.map((m: any) => m.role)).toEqual(['system', 'user', 'user']);
      expect(seenBodies[0].response_format).toEqual({
        type: 'json_schema',
        json_schema: { name: 'mockia_output', strict: true, schema: MOCK_SPEC_JSON_SCHEMA },
      });
      expect(result.model).toBe('my-model:7b');
      expect(result.rows.every((r) => !r.validJson && r.methodPathF1 === 0 && r.error === undefined)).toBe(true);
      expect(result.rows[0].outputTokens).toBe(50);
      expect(result.summary.tokensPerSecond).toBeGreaterThan(0);
    });

    it('with only "local" configured there is no silent fall back to OpenRouter: a dead server is an error row', async () => {
      const env = { ...process.env, AI_LOCAL_BASE_URL: 'http://127.0.0.1:1', AI_LOCAL_TIMEOUT_MS: '500', OPENROUTER_API_KEY: 'would-be-used' };
      const { result } = await runEval({ provider: 'local', casesDir: CASES_DIR, outDir, log, limit: 1, noFail: true, env });
      expect(result.rows[0].error).toBeDefined();
      expect(result.rows[0].validJson).toBe(false);
    });
  });
});

describe('parseArgs', () => {
  it('reads --key=value flags and bare boolean flags', () => {
    expect(parseArgs(['--provider=local', '--model=m:7b', '--limit=5', '--concurrency=3', '--out=/tmp/x', '--compare=a.json', '--no-fail'])).toEqual({
      provider: 'local',
      model: 'm:7b',
      limit: 5,
      concurrency: 3,
      out: '/tmp/x',
      compare: 'a.json',
      noFail: true,
    });
  });

  it('defaults: concurrency 1, no limit, fails on criteria', () => {
    expect(parseArgs(['--provider=fake-perfect'])).toEqual({ provider: 'fake-perfect', concurrency: 1, noFail: false });
  });

  it('requires --provider and rejects bad numbers and unknown flags', () => {
    expect(() => parseArgs([])).toThrow(/--provider/);
    expect(() => parseArgs(['--provider=x', '--limit=0'])).toThrow(/--limit/);
    expect(() => parseArgs(['--provider=x', '--concurrency=abc'])).toThrow(/--concurrency/);
    expect(() => parseArgs(['--provider=x', '--bogus=1'])).toThrow(/--bogus/);
  });
});
