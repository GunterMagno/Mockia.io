/**
 * AI evaluation bench: `npm run eval -w @mockia/backend -- --provider=<local|openrouter|fake-perfect|fake-noisy> [flags]`
 *
 *   --provider=NAME     which model to run: local (AI_LOCAL_* env), openrouter (OPENROUTER_* env) or a fake
 *   --model=NAME        override AI_LOCAL_MODEL / OPENROUTER_MODEL for this run
 *   --limit=N           only the first N cases (sorted by id)
 *   --concurrency=N     calls in flight at once (default 1)
 *   --out=DIR           where to write the result JSON (default evals/results)
 *   --compare=FILE      print a diff against a previous result or evals/baseline.json
 *   --no-fail           exit 0 even if the acceptance criteria fail
 *
 * Exit code: 0 when schemaValid >= 95 %, mean F1 >= 0.85 and p95 latency <= 60 s (or --no-fail), 1 otherwise,
 * 2 on a usage error.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { CASES_DIR_NAME } from './cases.js';
import { parseArgs, runEval } from './runner.js';

const evalsDir = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('Usage: npm run eval -w @mockia/backend -- --provider=<local|openrouter|fake-perfect|fake-noisy> [--model=] [--limit=] [--concurrency=] [--out=] [--compare=] [--no-fail]');
    return 2;
  }

  try {
    const { exitCode } = await runEval({
      provider: args.provider,
      model: args.model,
      limit: args.limit,
      concurrency: args.concurrency,
      casesDir: path.join(evalsDir, CASES_DIR_NAME),
      outDir: path.resolve(args.out ?? path.join(evalsDir, 'results')),
      noFail: args.noFail,
      compare: args.compare ? path.resolve(args.compare) : undefined,
    });
    return exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

main().then((code) => process.exit(code));
