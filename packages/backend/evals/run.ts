/**
 * AI evaluation bench: `npm run eval -w @mockia/backend -- --provider=<local|openrouter|fake-perfect|fake-noisy> [flags]`
 *
 *   --provider=NAME     which model to run: local (AI_LOCAL_* env), openrouter (OPENROUTER_* env) or a fake
 *   --model=NAME        override AI_LOCAL_MODEL / OPENROUTER_MODEL for this run
 *   --limit=N           only the first N cases (sorted by id)
 *   --concurrency=N     calls in flight at once (default 1)
 *   --temperature=T     sampling temperature (default: the production value for endpoint generation)
 *   --max-tokens=N      max output tokens (default: the production value for endpoint generation)
 *   --out=DIR           where to write the result JSON (default evals/results)
 *   --compare=FILE      print a diff against a previous result or evals/baseline.json
 *   --cases=DIR         run the cases in DIR instead of evals/cases (e.g. held-out cases from ai:val-to-cases)
 *   --no-fail           exit 0 even if the acceptance criteria fail
 *
 * Exit code: 0 when schemaValid >= 95 %, mean F1 >= 0.85 and p95 latency <= 60 s (or --no-fail), 1 otherwise,
 * 2 on a usage or configuration error (unknown flag, local without AI_LOCAL_BASE_URL, openrouter without a key...).
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { cli } from './runner.js';

cli(process.argv.slice(2), path.dirname(fileURLToPath(import.meta.url))).then((code) => process.exit(code));
