import fs from 'fs';
import os from 'os';
import path from 'path';
import { casesFromJsonl, writeValCases } from '../../evals/valCases.js';
import { loadCases } from '../../evals/cases.js';
import { runEval, parseArgs, cli } from '../../evals/runner.js';

/**
 * val.jsonl (the held-out split exported by ai:export-dataset) can be replayed through the evaluation bench: each line
 * becomes a case whose prompt is exactly the stored messages and whose expectation is the endpoints of the target.
 */

const spec = (endpoints: Array<{ path: string; method: string }>) => ({
  apiVersion: '1.0.0',
  title: 'Gym API',
  description: 'd',
  endpoints: endpoints.map((e) => ({ ...e, description: 'x', examples: [{ request: {}, response: { id: 1 } }] })),
  dataModels: [],
});
const line = (endpoints: Array<{ path: string; method: string }>, user = 'Make an API') =>
  JSON.stringify({
    messages: [
      { role: 'system', content: 'You generate mock APIs.' },
      { role: 'user', content: user },
      { role: 'assistant', content: JSON.stringify(spec(endpoints)) },
    ],
  });

describe('casesFromJsonl', () => {
  it('turns each line into a case: messages without the target, expected from the target', () => {
    const text = [line([{ path: '/members', method: 'GET' }], 'u1'), line([{ path: '/classes', method: 'POST' }, { path: '/classes/:id', method: 'GET' }], 'u2')].join('\n') + '\n';
    const cases = casesFromJsonl(text);
    expect(cases.map((c) => c.id)).toEqual(['val-0001', 'val-0002']);
    expect(cases[0].messages).toEqual([
      { role: 'system', content: 'You generate mock APIs.' },
      { role: 'user', content: 'u1' },
    ]);
    expect(cases[0].expected.map((e) => `${e.method} ${e.path}`)).toEqual(['GET /members']);
    expect(cases[1].expected).toHaveLength(2);
    expect(cases[0].tags).toContain('held-out');
    expect(typeof cases[0].description).toBe('string');
  });

  it('ignores blank lines', () => {
    expect(casesFromJsonl(`\n${line([{ path: '/a', method: 'GET' }])}\n\n`)).toHaveLength(1);
  });

  it('an empty file gives no cases', () => {
    expect(casesFromJsonl('')).toEqual([]);
  });

  it('rejects a malformed line naming the line number but never quoting its content', () => {
    const secret = 'PRIVATE-CONTENT-123';
    expect(() => casesFromJsonl(`${line([{ path: '/a', method: 'GET' }])}\n{"messages": [${secret}`)).toThrow(/line 2/);
    try {
      casesFromJsonl(`{"messages": [${secret}`);
    } catch (e) {
      expect(String(e)).not.toContain(secret);
    }
  });

  it.each([
    ['no messages', JSON.stringify({ nope: 1 })],
    ['last message not the assistant', JSON.stringify({ messages: [{ role: 'user', content: 'x' }] })],
    ['assistant content not JSON', JSON.stringify({ messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'plain text' }] })],
    ['assistant JSON without endpoints', JSON.stringify({ messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: '{"a":1}' }] })],
    ['no prompt before the target', JSON.stringify({ messages: [{ role: 'assistant', content: JSON.stringify(spec([{ path: '/a', method: 'GET' }])) }] })],
  ])('rejects: %s', (_name, bad) => {
    expect(() => casesFromJsonl(bad)).toThrow(/line 1/);
  });
});

describe('writeValCases + the bench', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockia-valcases-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes one JSON file per case that loadCases reads back', () => {
    const cases = casesFromJsonl([line([{ path: '/a', method: 'GET' }]), line([{ path: '/b', method: 'GET' }])].join('\n'));
    const out = path.join(dir, 'cases');
    expect(writeValCases(cases, out)).toBe(2);
    expect(fs.readdirSync(out).sort()).toEqual(['val-0001.json', 'val-0002.json']);
    const loaded = loadCases(out);
    expect(loaded.map((c) => c.id)).toEqual(['val-0001', 'val-0002']);
    expect(loaded[0].messages).toHaveLength(2);
  });

  (process.platform === 'win32' ? it.skip : it)('the files are 0600 (they derive from user data) and the directory 0700', () => {
    const out = path.join(dir, 'cases');
    writeValCases(casesFromJsonl(line([{ path: '/a', method: 'GET' }])), out);
    expect(fs.statSync(path.join(out, 'val-0001.json')).mode & 0o777).toBe(0o600);
    expect(fs.statSync(out).mode & 0o777).toBe(0o700);
  });

  it('the runner sends exactly the stored messages to the model and scores against the target', async () => {
    const out = path.join(dir, 'cases');
    writeValCases(casesFromJsonl(line([{ path: '/members', method: 'GET' }], 'held-out prompt')), out);
    const seen: unknown[] = [];
    const logs: string[] = [];
    const { result } = await runEval({
      provider: 'fake-perfect',
      casesDir: out,
      noFail: true,
      log: (l) => logs.push(l),
      providerFactory: () => ({
        name: 'probe',
        async complete(req) {
          seen.push(req.messages);
          return { text: JSON.stringify(spec([{ path: '/members', method: 'GET' }])), provider: 'probe', model: 'm' };
        },
      }),
    });
    expect(seen).toEqual([[
      { role: 'system', content: 'You generate mock APIs.' },
      { role: 'user', content: 'held-out prompt' },
    ]]);
    expect(result.summary.meanMethodPathF1).toBe(1);
    expect(result.summary.schemaValidPct).toBe(100);
  });

  it('a wrong answer on a held-out case lowers the score', async () => {
    const out = path.join(dir, 'cases');
    writeValCases(casesFromJsonl(line([{ path: '/members', method: 'GET' }])), out);
    const { result } = await runEval({
      provider: 'fake-perfect',
      casesDir: out,
      noFail: true,
      log: () => undefined,
      providerFactory: () => ({
        name: 'probe',
        async complete() {
          return { text: JSON.stringify(spec([{ path: '/other', method: 'DELETE' }])), provider: 'probe', model: 'm' };
        },
      }),
    });
    expect(result.summary.meanMethodPathF1).toBe(0);
  });
});

describe('--cases flag', () => {
  it('parseArgs accepts --cases=<dir>', () => {
    expect(parseArgs(['--provider=fake-perfect', '--cases=./ai-datasets/val-cases']).cases).toBe('./ai-datasets/val-cases');
    expect(parseArgs(['--provider=fake-perfect']).cases).toBeUndefined();
  });

  it('cli runs against another cases directory and exits 2 when it does not exist', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockia-valcli-'));
    const out = path.join(dir, 'cases');
    const results = path.join(dir, 'results');
    writeValCases(casesFromJsonl(line([{ path: '/members', method: 'GET' }])), out);
    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await cli(['--provider=fake-perfect', `--cases=${out}`, `--out=${results}`], dir)).toBe(0);
      expect(fs.readdirSync(results)).toHaveLength(1);
      expect(await cli(['--provider=fake-perfect', `--cases=${path.join(dir, 'missing')}`, `--out=${results}`], dir)).toBe(2);
    } finally {
      spy.mockRestore();
      err.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
