/**
 * Converts the held-out split into evaluation cases:
 *
 *   npm run ai:val-to-cases -w @mockia/backend -- ./ai-datasets/val.jsonl [./ai-datasets/val-cases]
 *   npm run eval -w @mockia/backend -- --provider=local --cases=./ai-datasets/val-cases --no-fail
 *
 * Prints counts only. See evals/valCases.ts and docs/ia-entrenamiento.md.
 */

import fs from 'fs';
import path from 'path';
import { casesFromJsonl, writeValCases } from './valCases.js';

const [input, outDir = './ai-datasets/val-cases'] = process.argv.slice(2);
if (!input) {
  console.error('Usage: npm run ai:val-to-cases -w @mockia/backend -- <val.jsonl> [outDir=./ai-datasets/val-cases]');
  process.exit(2);
}
try {
  const cases = casesFromJsonl(fs.readFileSync(path.resolve(input), 'utf8'));
  const written = writeValCases(cases, path.resolve(outDir));
  console.log(`${written} held-out case(s) written to ${path.resolve(outDir)}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
