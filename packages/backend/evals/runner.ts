/**
 * Core of the evaluation bench (the CLI in run.ts is a thin wrapper), so tests can run it in process.
 *
 * Every case goes through the product's own path: the prompt is built by buildPromptFromInput (the pure half of
 * buildPrompt), the call goes through getLlm() configured with that single provider (AI_PROVIDERS=<provider>, so no
 * silent fall back to another one) and carries the same JSON schema the controller sends; the answer is scored by
 * scoreOutput, which uses the production parser and validator.
 */

import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { AI_PROVIDER_NAMES, getLocalAiConfig, openRouterConfig } from '../src/config/ai.js';
import { buildPromptFromInput } from '../src/modules/ai/prompt.service.js';
import { MOCK_SPEC_JSON_SCHEMA } from '../src/modules/ai/outputSchema.js';
import { classifyFailure, getLlm, resetLlm } from '../src/modules/ai/providers/index.js';
import type { LlmProvider } from '../src/modules/ai/providers/types.js';
import { loadCases, type EvalCase } from './cases.js';
import { createFakeProvider, isFakeProvider, FAKE_PROVIDERS } from './fakeProviders.js';
import {
  compareResults,
  evaluateCriteria,
  formatRows,
  formatSummary,
  isEvalResult,
  summarize,
  type CaseRow,
  type EvalResult,
} from './report.js';
import { scoreOutput } from './scoring.js';

export interface RunOptions {
  /** `local`, `openrouter` (real models, configured by the AI_* env vars) or `fake-perfect` / `fake-noisy`. */
  provider: string;
  /** Model override: AI_LOCAL_MODEL for local, OPENROUTER_MODEL for openrouter. */
  model?: string;
  limit?: number;
  /** Calls in flight at once (default 1: latency is only meaningful when the server is not shared). */
  concurrency?: number;
  casesDir: string;
  /** Directory where the result JSON is written. Nothing is written when absent. */
  outDir?: string;
  /** Exit 0 even when the acceptance criteria fail (exploratory runs). */
  noFail?: boolean;
  /** A previous result (or evals/baseline.json) to print a diff against. */
  compare?: string;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  /** Replaces how the provider of each case is built (tests). */
  providerFactory?: (c: EvalCase, index: number) => LlmProvider;
}

export interface RunOutcome {
  result: EvalResult;
  exitCode: 0 | 1;
  /** Path of the written result file, when outDir was given. */
  file?: string;
}

const VALID_PROVIDERS = [...AI_PROVIDER_NAMES, ...FAKE_PROVIDERS];

/** `qwen2.5-coder:7b-instruct` -> `qwen2.5-coder-7b-instruct`: safe in a file name on every OS. */
export function resultFileName(provider: string, model: string, when: Date): string {
  const safeModel = model.replace(/[^A-Za-z0-9.]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
  const stamp = when.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${provider}-${safeModel}-${stamp}.json`;
}

function loadPrevious(file: string): EvalResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read the --compare file ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isEvalResult(parsed)) throw new Error(`The --compare file ${file} is not an evaluation result`);
  return parsed;
}

function failedRow(id: string, latencyMs: number, error: unknown): CaseRow {
  return { id, validJson: false, schemaValid: false, methodPathF1: 0, fieldCoverage: 0, latencyMs, error: classifyFailure(error) };
}

async function runCase(c: EvalCase, llm: LlmProvider): Promise<CaseRow> {
  const started = performance.now();
  try {
    const messages = buildPromptFromInput(c.input);
    const completion = await llm.complete({ messages, jsonSchema: MOCK_SPEC_JSON_SCHEMA });
    const latencyMs = performance.now() - started;
    const row: CaseRow = { id: c.id, ...scoreOutput(c.expected, completion.text), latencyMs };
    if (completion.usage) {
      row.outputTokens = completion.usage.outputTokens;
      if (latencyMs > 0) row.tokensPerSecond = completion.usage.outputTokens / (latencyMs / 1000);
    }
    return row;
  } catch (error) {
    // Only the class of the failure is kept: messages can quote the prompt.
    return failedRow(c.id, performance.now() - started, error);
  }
}

/** Runs `tasks` with at most `concurrency` in flight; results keep the order of the tasks. */
async function pool<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, worker));
  return results;
}

export async function runEval(options: RunOptions): Promise<RunOutcome> {
  const log = options.log ?? ((line: string) => console.log(line));
  if (!(VALID_PROVIDERS as string[]).includes(options.provider)) {
    throw new Error(`Unknown provider "${options.provider}" (valid: ${VALID_PROVIDERS.join(', ')})`);
  }
  const previous = options.compare ? loadPrevious(options.compare) : undefined;

  let cases = loadCases(options.casesDir);
  if (options.limit !== undefined) cases = cases.slice(0, options.limit);

  const fake = isFakeProvider(options.provider);
  const env: NodeJS.ProcessEnv = { ...(options.env ?? process.env), AI_PROVIDERS: options.provider };
  if (!fake && options.provider === 'local' && options.model) env.AI_LOCAL_MODEL = options.model;
  const savedOpenRouterModel = openRouterConfig.model;
  if (!fake && options.provider === 'openrouter' && options.model) openRouterConfig.model = options.model;

  const model = fake
    ? 'fake'
    : options.provider === 'local'
      ? getLocalAiConfig(env).model
      : openRouterConfig.model;

  const startedAt = new Date();
  let rows: CaseRow[];
  try {
    resetLlm();
    const realLlm = fake || options.providerFactory ? undefined : getLlm(env);
    let done = 0;
    rows = await pool(
      cases.map((c, index) => async () => {
        const llm =
          options.providerFactory?.(c, index) ??
          (fake ? createFakeProvider(options.provider as (typeof FAKE_PROVIDERS)[number], c, index) : realLlm!);
        const row = await runCase(c, llm);
        done += 1;
        log(`[${done}/${cases.length}] ${c.id}  F1=${row.methodPathF1.toFixed(2)}  ${Math.round(row.latencyMs)} ms${row.error ? `  ${row.error}` : ''}`);
        return row;
      }),
      options.concurrency ?? 1
    );
  } finally {
    openRouterConfig.model = savedOpenRouterModel;
    resetLlm();
  }

  const summary = summarize(rows);
  const result: EvalResult = {
    provider: options.provider,
    model: options.model && fake ? options.model : model,
    startedAt: startedAt.toISOString(),
    summary,
    criteria: evaluateCriteria(summary),
    rows,
  };

  log('');
  log(formatRows(rows));
  log('');
  log(formatSummary(result));

  let file: string | undefined;
  if (options.outDir) {
    fs.mkdirSync(options.outDir, { recursive: true });
    file = path.join(options.outDir, resultFileName(result.provider, result.model, startedAt));
    fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
    log(`Saved: ${file}`);
  }
  if (previous) {
    log('');
    log(compareResults(previous, result));
  }

  return { result, exitCode: options.noFail || result.criteria.pass ? 0 : 1, file };
}

/* ------------------------------------------------------------------------------------------------------------------
 * Command line
 * ---------------------------------------------------------------------------------------------------------------- */

export interface CliArgs {
  provider: string;
  model?: string;
  limit?: number;
  concurrency: number;
  out?: string;
  compare?: string;
  noFail: boolean;
}

function positiveInt(flag: string, value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer, got "${value}"`);
  return n;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { provider: '', concurrency: 1, noFail: false };
  for (const raw of argv) {
    if (raw === '--no-fail') {
      args.noFail = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.*)$/.exec(raw);
    if (!match) throw new Error(`Unknown argument ${raw}`);
    const [, key, value] = match;
    switch (key) {
      case 'provider':
        args.provider = value;
        break;
      case 'model':
        args.model = value;
        break;
      case 'limit':
        args.limit = positiveInt('--limit', value);
        break;
      case 'concurrency':
        args.concurrency = positiveInt('--concurrency', value);
        break;
      case 'out':
        args.out = value;
        break;
      case 'compare':
        args.compare = value;
        break;
      default:
        throw new Error(`Unknown flag --${key}`);
    }
  }
  if (!args.provider) throw new Error(`--provider is required (one of: ${VALID_PROVIDERS.join(', ')})`);
  return args;
}
