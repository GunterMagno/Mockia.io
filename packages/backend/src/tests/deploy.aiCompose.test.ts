import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';
import * as ai from '../config/ai.js';
import { openRouterSupportsJsonSchema } from '../modules/ai/providers/openaiCompatible.js';

/**
 * Static checks of the self-hosted AI service (Task 14). There is no Docker daemon in unit tests: the compose files
 * are parsed as YAML and the literal `${VAR:-default}` expressions are asserted, because they are what decides what
 * the stack does when the owner has set nothing. `docker compose config` runs in CI (compose-ai-config job).
 */

const ROOT = path.resolve(__dirname, '../../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

interface ComposeService {
  image?: string;
  restart?: string;
  ports?: unknown;
  expose?: unknown;
  command?: string[] | string;
  environment?: Record<string, string>;
  volumes?: string[];
  networks?: string[] | Record<string, unknown>;
  depends_on?: unknown;
  mem_limit?: string;
  shm_size?: string;
  healthcheck?: { test: string[] | string; interval?: string; retries?: number; start_period?: string };
  deploy?: {
    resources?: { reservations?: { devices?: Array<{ driver?: string; count?: unknown; capabilities?: string[] }> } };
  };
}
interface ComposeFile {
  services: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
  networks?: Record<string, unknown>;
}

/** contextBudget 6000 + system prompt + max_tokens 5000 does not fit in 8192; 16384 is the floor. */
const MIN_CONTEXT = 16384;

const load = (rel: string): ComposeFile => yaml.load(read(rel)) as ComposeFile;
const asText = (v: string[] | string | undefined): string => (Array.isArray(v) ? v.join(' ') : (v ?? ''));
const networkNames = (s: ComposeService): string[] =>
  Array.isArray(s.networks) ? s.networks : Object.keys(s.networks ?? {});

describe('docker-compose.ai.yml (Ollama)', () => {
  const file = load('docker-compose.ai.yml');
  const llm = file.services.llm;

  it('defines the llm service with a pinned image that is overridable by variable', () => {
    expect(llm).toBeDefined();
    expect(llm.image).toMatch(/^\$\{OLLAMA_IMAGE:-ollama\/ollama:\d+\.\d+\.\d+\}$/);
    expect(llm.image).not.toMatch(/latest/);
  });

  it('restarts unless stopped and has a healthcheck that does not need curl', () => {
    expect(llm.restart).toBe('unless-stopped');
    expect(llm.healthcheck).toBeDefined();
    const test = asText(llm.healthcheck?.test);
    expect(test).toContain('ollama list');
    expect(test).not.toMatch(/curl|wget/);
    expect(llm.healthcheck?.retries).toBeGreaterThanOrEqual(3);
  });

  it('persists the models in a named volume mounted on /root/.ollama', () => {
    expect(llm.volumes).toContain('ollama_models:/root/.ollama');
    expect(file.volumes).toHaveProperty('ollama_models');
  });

  it('publishes nothing to the host', () => {
    expect(llm.ports).toBeUndefined();
  });

  it('keeps the model loaded and limits concurrency and memory by env-tunable values', () => {
    expect(llm.environment?.OLLAMA_KEEP_ALIVE).toBe('24h');
    expect(llm.environment?.OLLAMA_NUM_PARALLEL).toBe('${OLLAMA_NUM_PARALLEL:-1}');
    expect(llm.mem_limit).toMatch(/^\$\{LLM_MEM_LIMIT:-\d+[gGmM]\}$/);
  });

  it('gives the model a context big enough for the real requests (repo budget + system prompt + max_tokens)', () => {
    // A small default num_ctx silently truncates the OLDEST tokens (the system prompt), which makes any evaluation unrepresentative.
    const m = /^\$\{OLLAMA_CONTEXT_LENGTH:-(\d+)\}$/.exec(llm.environment?.OLLAMA_CONTEXT_LENGTH ?? '');
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(MIN_CONTEXT);
  });

  it('shares a dedicated network with the backend, valid in dev and prod', () => {
    const aiNet = networkNames(llm);
    expect(aiNet).toHaveLength(1);
    expect(networkNames(file.services.backend)).toEqual(aiNet);
    expect(file.networks).toHaveProperty(aiNet[0]);
    // The override cannot know the name of the dev/prod network, so it must not redeclare or reference it.
    expect(JSON.stringify(file)).not.toMatch(/mockia-network/);
  });

  it('wires the backend to the llm service but keeps the safe behaviour until the owner opts in', () => {
    const env = file.services.backend.environment ?? {};
    expect(env.AI_PROVIDERS).toBe('${AI_PROVIDERS:-openrouter}');
    expect(env.AI_LOCAL_BASE_URL).toBe('${AI_LOCAL_BASE_URL:-http://llm:11434}');
    expect(env.AI_LOCAL_MODEL).toMatch(/^\$\{AI_LOCAL_MODEL:-[^}]+\}$/);
    expect(env.AI_LOCAL_TIMEOUT_MS).toBe('${AI_LOCAL_TIMEOUT_MS:-120000}');
    expect(env.AI_TOTAL_TIMEOUT_MS).toBe('${AI_TOTAL_TIMEOUT_MS:-240000}');
  });

  it('does not make the backend depend on the llm: a stopped model must fall back, not block startup', () => {
    expect(file.services.backend.depends_on).toBeUndefined();
  });

  it('only declares services that already exist plus llm', () => {
    expect(Object.keys(file.services).sort()).toEqual(['backend', 'llm']);
  });
});

describe('docker-compose.ai.gpu.yml', () => {
  const file = load('docker-compose.ai.gpu.yml');

  it('reserves every NVIDIA GPU for the llm service and nothing else', () => {
    expect(Object.keys(file.services)).toEqual(['llm']);
    const devices = file.services.llm.deploy?.resources?.reservations?.devices ?? [];
    expect(devices).toEqual([{ driver: 'nvidia', count: 'all', capabilities: ['gpu'] }]);
    expect(file.services.llm.ports).toBeUndefined();
  });

  it('is not part of the base AI file, so CPU-only hosts simply leave it out', () => {
    expect(load('docker-compose.ai.yml').services.llm.deploy).toBeUndefined();
  });
});

describe('docker-compose.ai.vllm.yml', () => {
  const file = load('docker-compose.ai.vllm.yml');
  const llm = file.services.llm;

  it('publishes nothing to the host', () => {
    expect(llm.ports).toBeUndefined();
  });

  it('pins the image by variable and serves the configured model with a bounded context', () => {
    expect(llm.image).toMatch(/^\$\{VLLM_IMAGE:-vllm\/vllm-openai:v\d+\.\d+\.\d+\}$/);
    const command = asText(llm.command);
    expect(command).toContain('--model ${VLLM_MODEL:-');
    expect(command).toContain('--max-model-len ${VLLM_MAX_MODEL_LEN:-');
    expect(command).toContain('--port 8000');
  });

  it('serves a context of at least 16384 tokens by default, so real prompts are not rejected with a 400', () => {
    const command = asText(llm.command);
    const m = /--max-model-len \$\{VLLM_MAX_MODEL_LEN:-(\d+)\}/.exec(command);
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(MIN_CONTEXT);
  });

  it('requires an NVIDIA GPU by itself', () => {
    const devices = llm.deploy?.resources?.reservations?.devices ?? [];
    expect(devices).toEqual([{ driver: 'nvidia', count: 'all', capabilities: ['gpu'] }]);
  });

  it('has a /health healthcheck, restarts unless stopped and caches the weights in a named volume', () => {
    expect(asText(llm.healthcheck?.test)).toContain('/health');
    expect(llm.restart).toBe('unless-stopped');
    expect(llm.volumes).toContain('hf_cache:/root/.cache/huggingface');
    expect(file.volumes).toHaveProperty('hf_cache');
  });

  it('points the backend at vLLM port 8000 with the served model name, safe default provider', () => {
    const env = file.services.backend.environment ?? {};
    expect(env.AI_LOCAL_BASE_URL).toBe('http://llm:8000');
    expect(env.AI_LOCAL_MODEL).toMatch(/^\$\{VLLM_MODEL:-[^}]+\}$/);
    expect(env.AI_PROVIDERS).toBe('${AI_PROVIDERS:-openrouter}');
    expect(file.services.backend.depends_on).toBeUndefined();
  });

  it('uses the same network layout as the Ollama file (they are alternatives, never combined)', () => {
    const ollama = load('docker-compose.ai.yml');
    expect(networkNames(llm)).toEqual(networkNames(ollama.services.llm));
    expect(networkNames(file.services.backend)).toEqual(networkNames(ollama.services.backend));
  });
});

describe('docker-compose.ai.eval.yml (temporary, for the evaluation bench)', () => {
  const file = load('docker-compose.ai.eval.yml');

  it('only touches llm and binds exclusively to the host loopback', () => {
    expect(Object.keys(file.services)).toEqual(['llm']);
    const ports = file.services.llm.ports as string[];
    expect(ports).toHaveLength(1);
    expect(ports[0]).toMatch(/^127\.0\.0\.1:/);
    expect(ports[0]).not.toMatch(/^0\.0\.0\.0|^\$|^\d+:/);
  });

  it('is a separate opt-in file: neither AI base file includes it', () => {
    expect(load('docker-compose.ai.yml').services.llm.ports).toBeUndefined();
    expect(load('docker-compose.ai.vllm.yml').services.llm.ports).toBeUndefined();
  });
});

describe('the model API never leaves the internal network', () => {
  const nginx = read('nginx.conf');
  const withoutComments = nginx
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

  it('nginx.conf has no proxy to llm and no llm upstream', () => {
    expect(withoutComments).not.toMatch(/proxy_pass\s+[^;]*\bllm\b/);
    expect(withoutComments).not.toMatch(/\bupstream\b/);
    expect(withoutComments).not.toMatch(/\b11434\b|:8000\b/);
  });

  it('nginx.conf states why, so nobody adds it later', () => {
    expect(nginx).toMatch(/#.*llm.*(sin autenticacion|no tiene autenticacion)/i);
  });

  it('neither the base nor the production compose declare or publish the llm', () => {
    expect(load('docker-compose.yml').services).not.toHaveProperty('llm');
    expect(load('docker-compose.prod.yml').services).not.toHaveProperty('llm');
  });

  it('the production compose still does not publish MongoDB and keeps its mandatory variables', () => {
    const prod = load('docker-compose.prod.yml');
    expect(prod.services.mongo.ports).toBeUndefined();
    expect(prod.services.mongo.environment?.MONGO_INITDB_ROOT_PASSWORD).toContain(':?');
    expect(prod.services.backend.environment?.JWT_ACCESS_SECRET).toContain(':?');
  });

  it('only the frontend publishes a port in production', () => {
    const prod = load('docker-compose.prod.yml');
    const publishing = Object.entries(prod.services)
      .filter(([, s]) => s.ports !== undefined)
      .map(([name]) => name);
    expect(publishing).toEqual(['frontend']);
  });
});

describe('scripts/pull-model.sh', () => {
  const rel = 'scripts/pull-model.sh';

  it('exists, is POSIX sh and fails fast', () => {
    const text = read(rel);
    expect(text.startsWith('#!/bin/sh\n')).toBe(true);
    expect(text).toMatch(/^set -eu$/m);
    expect(text).not.toMatch(/\r/);
  });

  it('validates the model name before using it', () => {
    const text = read(rel);
    expect(text).toMatch(/case "\$model" in/);
    expect(text).toMatch(/exec -T llm ollama pull "\$model"/);
  });

  // Behavioural checks with a fake `docker` that records its arguments. Skipped where there is no POSIX sh.
  const sh = spawnSync('sh', ['-c', 'exit 0']);
  const itWithSh = sh.error ? it.skip : it;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pullmodel-'));
  const log = path.join(tmp, 'docker.log');
  const toPosix = (p: string): string =>
    p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_m, drive: string) => `/${drive.toLowerCase()}`);

  beforeAll(() => {
    fs.writeFileSync(
      path.join(tmp, 'docker'),
      [
        '#!/bin/sh',
        'echo "$*" >> "$FAKE_DOCKER_LOG"',
        'case "$*" in',
        '  *"ps -q llm"*) [ "${FAKE_LLM_UP:-1}" = 1 ] && echo abc123 ;;',
        '  *"ollama pull"*) [ "${FAKE_PULL_FAIL:-0}" = 1 ] && exit 1 ;;',
        'esac',
        'exit 0',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  beforeEach(() => fs.rmSync(log, { force: true }));

  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('sh', [path.join(ROOT, rel), ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${tmp}${path.delimiter}${process.env.PATH ?? ''}`,
        FAKE_DOCKER_LOG: toPosix(log),
        ...env,
      },
    });
  const calls = (): string[] => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);

  itWithSh.each([
    ['', 'empty'],
    ['a b', 'whitespace'],
    ['x; rm -rf /', 'shell metacharacters'],
    ['$(id)', 'command substitution'],
    ['-rf', 'leading dash (option injection)'],
    ['../../etc', 'path traversal start'],
    ['`id`', 'backticks'],
  ])('rejects the model name %j (%s) without calling docker', (model) => {
    const r = run([model]);
    expect(r.status).not.toBe(0);
    expect(calls()).toEqual([]);
  });

  itWithSh('rejects a missing argument with a usage message', () => {
    const r = run([]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/uso|usage/i);
    expect(calls()).toEqual([]);
  });

  itWithSh('pulls and then warms the model, using the default prod+ai compose files', () => {
    const r = run(['qwen2.5-coder:7b-instruct']);
    expect(r.status).toBe(0);
    const lines = calls();
    expect(lines[0]).toContain('-f docker-compose.prod.yml -f docker-compose.ai.yml');
    expect(lines.some((l) => l.includes('exec -T llm ollama pull qwen2.5-coder:7b-instruct'))).toBe(true);
    const pull = lines.findIndex((l) => l.includes('ollama pull'));
    const warm = lines.findIndex((l) => l.includes('ollama run qwen2.5-coder:7b-instruct'));
    expect(warm).toBeGreaterThan(pull);
  });

  itWithSh('honours COMPOSE_FILES and can skip the warm-up', () => {
    const r = run(['qwen2.5-coder:7b-instruct'], {
      COMPOSE_FILES: 'docker-compose.yml docker-compose.ai.yml docker-compose.ai.gpu.yml',
      SKIP_WARMUP: '1',
    });
    expect(r.status).toBe(0);
    const lines = calls();
    expect(lines[0]).toContain('-f docker-compose.yml -f docker-compose.ai.yml -f docker-compose.ai.gpu.yml');
    expect(lines.some((l) => l.includes('ollama run'))).toBe(false);
  });

  itWithSh('fails clearly when the llm container is not running, without pulling', () => {
    const r = run(['qwen2.5-coder:7b-instruct'], { FAKE_LLM_UP: '0' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/llm/);
    expect(calls().some((l) => l.includes('ollama pull'))).toBe(false);
  });

  itWithSh('exits non-zero with a message when the pull fails and does not warm up', () => {
    const r = run(['qwen2.5-coder:7b-instruct'], { FAKE_PULL_FAIL: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/pull/i);
    expect(calls().some((l) => l.includes('ollama run'))).toBe(false);
  });
});

describe('docs/ia-local.md', () => {
  const doc = read('docs/ia-local.md');

  it('leaves the results table empty instead of inventing measurements', () => {
    const rows = doc.split('\n').filter((l) => /^\| (OpenRouter|Qwen|Otra)/.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row).toContain('pendiente de medir por el titular');
      expect(row).not.toMatch(/\d+(\.\d+)? ?(%|s\b)/);
    }
  });

  it('states the decision rule of the plan and what to do when it is not met', () => {
    expect(doc).toMatch(/95 %/);
    expect(doc).toMatch(/0\.85/);
    expect(doc).toMatch(/60 s/);
    expect(doc).toMatch(/Tarea 15/);
  });

  it('explains how to size the context and makes it a prerequisite of a fair evaluation', () => {
    expect(doc).toMatch(/OLLAMA_CONTEXT_LENGTH/);
    expect(doc).toMatch(/num_ctx 16384/);
    expect(doc).toMatch(/KV/);
    expect(doc).toMatch(/16384/);
  });

  it('drill expects dns_error for a stopped container and timeout for a paused one', () => {
    const drill = doc.slice(doc.indexOf('## 10.'), doc.indexOf('## 11.'));
    expect(drill).toMatch(/dns_error/);
    expect(drill).toMatch(/docker compose <ficheros> pause llm/);
    expect(drill).toMatch(/timeout/);
    expect(drill).not.toMatch(/stop llm[\s\S]*Provider "local" failed \(connection_refused\)/);
  });

  it('documents how to turn it off and labels hardware figures as estimates', () => {
    expect(doc).toContain('AI_PROVIDERS=openrouter');
    expect(doc).toMatch(/ESTIMACI/);
  });
});

describe('CI validates every AI compose combination', () => {
  const ci = read('.github/workflows/ci.yml');

  it('is valid YAML with the job', () => {
    const parsed = yaml.load(ci) as { jobs: Record<string, { steps: Array<{ run?: string }> }> };
    expect(parsed.jobs).toHaveProperty('compose-ai-config');
  });

  it.each([
    '-f docker-compose.prod.yml -f docker-compose.ai.yml config',
    '-f docker-compose.prod.yml -f docker-compose.ai.yml -f docker-compose.ai.gpu.yml config',
    '-f docker-compose.prod.yml -f docker-compose.ai.vllm.yml config',
    '-f docker-compose.yml -f docker-compose.ai.yml config',
    '-f docker-compose.prod.yml -f docker-compose.ai.yml -f docker-compose.ai.eval.yml config',
  ])('runs docker compose %s', (combo) => {
    expect(ci).toContain(combo);
  });
});

/**
 * C3: the production stack must forward every AI setting the backend reads, in a form where an unset variable reaches
 * the backend as an EMPTY string, and an empty string must keep the backend's own default (never override it).
 */
describe('AI settings reach the backend in production', () => {
  const AI_VARS = ['OPENROUTER_MODEL', 'AI_RATE_PER_MINUTE', 'AI_GENERATION_RETENTION_DAYS', 'OPENROUTER_JSON_SCHEMA', 'AI_SPEC_TEMPERATURE'];

  it('docker-compose.prod.yml forwards each one as ${VAR:-} (empty when unset)', () => {
    const env = load('docker-compose.prod.yml').services.backend.environment ?? {};
    for (const name of AI_VARS) expect(env[name]).toBe(`\${${name}:-}`);
    expect(env.OPENROUTER_API_KEY).toBe('${OPENROUTER_API_KEY:-}');
  });

  it('render.yaml lists them on the backend as optional (sync: false)', () => {
    const render = yaml.load(read('render.yaml')) as { services: Array<{ name: string; envVars: Array<{ key: string; sync?: boolean }> }> };
    const backend = render.services.find((s) => s.name === 'mockia-backend')!;
    for (const name of AI_VARS) {
      expect(backend.envVars.find((v) => v.key === name)).toEqual({ key: name, sync: false });
    }
  });

  it('an empty value keeps every default of the backend', () => {
    const empty = Object.fromEntries(AI_VARS.map((n) => [n, '']));
    expect(ai.openRouterModelFrom(empty)).toBe('google/gemini-flash-1.5');
    expect(ai.openRouterModelFrom({ OPENROUTER_MODEL: '  ' })).toBe('google/gemini-flash-1.5');
    expect(ai.openRouterModelFrom({ OPENROUTER_MODEL: 'vendor/model' })).toBe('vendor/model');
    expect(ai.getAiRatePerMinute(empty)).toBe(20);
    expect(ai.getAiGenerationRetentionDays(empty)).toBe(180);
    expect(ai.getSpecGenerationSampling(empty).temperature).toBe(0.85);
    expect(openRouterSupportsJsonSchema(empty)).toBe(false);
  });

  it('warns at startup in production when OPENROUTER_MODEL is not set (the default model may be retired)', () => {
    expect(ai.openRouterModelWarning({ NODE_ENV: 'production' })).toMatch(/OPENROUTER_MODEL/);
    expect(ai.openRouterModelWarning({ NODE_ENV: 'production', OPENROUTER_MODEL: '' })).toMatch(/OPENROUTER_MODEL/);
    expect(ai.openRouterModelWarning({ NODE_ENV: 'production', OPENROUTER_MODEL: 'vendor/model' })).toBeNull();
    expect(ai.openRouterModelWarning({ NODE_ENV: 'development' })).toBeNull();
    // Only when OpenRouter is in the chain
    expect(ai.openRouterModelWarning({ NODE_ENV: 'production', AI_PROVIDERS: 'local' })).toBeNull();
  });

  it('index.ts prints that warning at startup', () => {
    expect(read('packages/backend/src/index.ts')).toMatch(/openRouterModelWarning\(\)/);
  });
});
