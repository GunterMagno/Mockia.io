import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import { runEval, parseArgs, resultFileName, cli } from '../../evals/runner.js';
import { openRouterConfig, SPEC_GENERATION_DEFAULTS } from '../config/ai.js';
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
      expect(result.rows[0].error).toMatch(/^(connection_refused|timeout)$/); // the real class, not a wrapped http_503
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

/* ------------------------------------------------------------------------------------------------------------------
 * A benchmark must measure the model, not the production safety nets, and must sample like production does.
 * ---------------------------------------------------------------------------------------------------------------- */

type Handler = (body: any, res: http.ServerResponse) => void;

async function startServer(handler: Handler) {
  const bodies: any[] = [];
  const sockets = new Set<import('net').Socket>();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      bodies.push(body);
      handler(body, res);
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    bodies,
    close: () =>
      new Promise<void>((r) => {
        sockets.forEach((socket) => socket.destroy());
        server.close(() => r());
      }),
  };
}

const sendJson = (res: http.ServerResponse, status: number, payload: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
};
const okCompletion = (res: http.ServerResponse, text = 'no json here') =>
  sendJson(res, 200, { model: 'served', choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

describe('eval runner: raw provider errors (no circuit breaker)', () => {
  let outDir: string;
  const savedEnv = { ...process.env };
  const log = () => undefined;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockia-eval-'));
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    resetLlm();
  });
  afterEach(() => {
    warn.mockRestore();
    fs.rmSync(outDir, { recursive: true, force: true });
    process.env = { ...savedEnv };
    resetLlm();
  });

  const localEnv = (url: string) => ({ ...process.env, AI_LOCAL_BASE_URL: url, AI_LOCAL_TIMEOUT_MS: '3000' });

  it('a model that fails 8 times in a row still receives all 8 calls, each row carries the real HTTP class', async () => {
    const server = await startServer((_b, res) => sendJson(res, 500, { error: 'boom' }));
    try {
      const { result } = await runEval({ provider: 'local', casesDir: CASES_DIR, outDir, log, limit: 8, noFail: true, env: localEnv(server.url) });
      expect(server.bodies).toHaveLength(8);
      expect(result.rows.map((r) => r.error)).toEqual(Array(8).fill('http_500'));
      expect(result.summary.errors).toBe(8);
    } finally {
      await server.close();
    }
  });

  it('rows keep the class of each failure: a refused connection, a bad envelope and an empty answer', async () => {
    const dead = await startServer((_b, res) => okCompletion(res));
    const deadUrl = dead.url;
    await dead.close();
    const refused = await runEval({ provider: 'local', casesDir: CASES_DIR, outDir, log, limit: 5, noFail: true, env: localEnv(deadUrl) });
    expect(refused.result.rows.map((r) => r.error)).toEqual(Array(5).fill('connection_refused'));

    const modes = ['{"nope":true}', '{"choices":[{"message":{"content":""}}]}', '{"choices":[]}'];
    let n = 0;
    const odd = await startServer((_b, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(modes[n++ % modes.length]);
    });
    try {
      const { result } = await runEval({ provider: 'local', casesDir: CASES_DIR, outDir, log, limit: 6, noFail: true, env: localEnv(odd.url) });
      expect(result.rows.map((r) => r.error)).toEqual(['invalid_envelope', 'empty_content', 'invalid_envelope', 'invalid_envelope', 'empty_content', 'invalid_envelope']);
    } finally {
      await odd.close();
    }
  });

  it('a hung model is cut at its timeout and reported as timeout, and the next case still gets its call', async () => {
    const server = await startServer(() => undefined); // never answers
    try {
      const env = { ...localEnv(server.url), AI_LOCAL_TIMEOUT_MS: '150' };
      const { result } = await runEval({ provider: 'local', casesDir: CASES_DIR, outDir, log, limit: 4, noFail: true, env });
      expect(server.bodies).toHaveLength(4);
      expect(result.rows.map((r) => r.error)).toEqual(Array(4).fill('timeout'));
      expect(result.rows.every((r) => r.latencyMs >= 100)).toBe(true);
    } finally {
      await server.close();
    }
  });
});

describe('eval runner: preflight', () => {
  const savedKey = openRouterConfig.apiKey;
  afterEach(() => {
    openRouterConfig.apiKey = savedKey;
  });

  it('--provider=local without AI_LOCAL_BASE_URL fails before any call, naming the variable', async () => {
    const env = { ...process.env, AI_LOCAL_BASE_URL: '' };
    await expect(runEval({ provider: 'local', casesDir: CASES_DIR, log: () => undefined, limit: 1, env })).rejects.toThrow(/AI_LOCAL_BASE_URL/);
  });

  it('--provider=openrouter without OPENROUTER_API_KEY fails before any call, naming the variable', async () => {
    openRouterConfig.apiKey = '';
    await expect(runEval({ provider: 'openrouter', casesDir: CASES_DIR, log: () => undefined, limit: 1 })).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it('the fakes need no configuration', async () => {
    openRouterConfig.apiKey = '';
    const env = { ...process.env, AI_LOCAL_BASE_URL: '' };
    await expect(runEval({ provider: 'fake-perfect', casesDir: CASES_DIR, log: () => undefined, limit: 1, env, noFail: true })).resolves.toBeDefined();
  });

  describe('cli exit codes', () => {
    let errors: jest.SpyInstance;
    beforeEach(() => {
      errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => errors.mockRestore());
    const evalsDir = path.resolve(__dirname, '../../evals');

    it('exits 2 with a clear message when the local server is not configured', async () => {
      const code = await cli(['--provider=local', '--limit=1'], evalsDir, { ...process.env, AI_LOCAL_BASE_URL: '' });
      expect(code).toBe(2);
      expect(errors.mock.calls.flat().join('\n')).toMatch(/AI_LOCAL_BASE_URL/);
    });

    it('exits 2 on a usage error and 0 / 1 from the criteria', async () => {
      expect(await cli(['--bogus=1'], evalsDir, process.env)).toBe(2);
      const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mockia-eval-'));
      try {
        expect(await cli(['--provider=fake-perfect', `--out=${out}`], evalsDir, process.env)).toBe(0);
        expect(await cli(['--provider=fake-noisy', `--out=${out}`], evalsDir, process.env)).toBe(1);
      } finally {
        log.mockRestore();
        fs.rmSync(out, { recursive: true, force: true });
      }
    });
  });
});

describe('eval runner: sampling parameters', () => {
  let outDir: string;
  let lines: string[];
  const log = (line: string) => lines.push(line);
  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockia-eval-'));
    lines = [];
    resetLlm();
  });
  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
    resetLlm();
  });
  const env = (url: string) => ({ ...process.env, AI_LOCAL_BASE_URL: url, AI_LOCAL_TIMEOUT_MS: '3000' });

  it('the production values are shared constants (0.85 and 5000 for endpoint generation)', () => {
    expect(SPEC_GENERATION_DEFAULTS).toEqual({ temperature: 0.85, maxTokens: 5000 });
  });

  it('by default the provider gets the production temperature and max tokens, and the result records them', async () => {
    const server = await startServer((_b, res) => okCompletion(res));
    try {
      const { result, file } = await runEval({ provider: 'local', casesDir: CASES_DIR, outDir, log, limit: 2, noFail: true, env: env(server.url) });
      expect(server.bodies).toHaveLength(2);
      for (const body of server.bodies) {
        expect(body.temperature).toBe(SPEC_GENERATION_DEFAULTS.temperature);
        expect(body.max_tokens).toBe(SPEC_GENERATION_DEFAULTS.maxTokens);
      }
      expect(result.params).toEqual({ temperature: 0.85, maxTokens: 5000 });
      expect(JSON.parse(fs.readFileSync(file!, 'utf8')).params).toEqual({ temperature: 0.85, maxTokens: 5000 });
      expect(lines.join('\n')).toMatch(/temperature\s*:?\s*0\.85/);
      expect(lines.join('\n')).toMatch(/max tokens\s*:?\s*5000/i);
    } finally {
      await server.close();
    }
  });

  it('--temperature and --max-tokens override them for that run', async () => {
    const server = await startServer((_b, res) => okCompletion(res));
    try {
      const { result, file } = await runEval({ provider: 'local', casesDir: CASES_DIR, outDir, log, limit: 1, noFail: true, temperature: 0.1, maxTokens: 777, env: env(server.url) });
      expect(server.bodies[0].temperature).toBe(0.1);
      expect(server.bodies[0].max_tokens).toBe(777);
      expect(result.params).toEqual({ temperature: 0.1, maxTokens: 777 });
      expect(JSON.parse(fs.readFileSync(file!, 'utf8')).params).toEqual({ temperature: 0.1, maxTokens: 777 });
    } finally {
      await server.close();
    }
  });

  it('a temperature of 0 is honoured (it is not "unset")', async () => {
    const server = await startServer((_b, res) => okCompletion(res));
    try {
      await runEval({ provider: 'local', casesDir: CASES_DIR, outDir, log, limit: 1, noFail: true, temperature: 0, env: env(server.url) });
      expect(server.bodies[0].temperature).toBe(0);
    } finally {
      await server.close();
    }
  });

  it('parseArgs reads --temperature and --max-tokens and rejects bad values', () => {
    expect(parseArgs(['--provider=local', '--temperature=0.3', '--max-tokens=900'])).toMatchObject({ temperature: 0.3, maxTokens: 900 });
    expect(parseArgs(['--provider=local', '--temperature=0'])).toMatchObject({ temperature: 0 });
    expect(() => parseArgs(['--provider=local', '--temperature=hot'])).toThrow(/--temperature/);
    expect(() => parseArgs(['--provider=local', '--temperature=3'])).toThrow(/--temperature/);
    expect(() => parseArgs(['--provider=local', '--max-tokens=0'])).toThrow(/--max-tokens/);
  });
});
