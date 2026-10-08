/**
 * Evaluation cases: small, realistic repositories and the endpoints a good model should derive from them.
 * One JSON file per case in evals/cases/. See evals/README.md to add one.
 */

import fs from 'fs';
import path from 'path';
import type { PromptInput } from '../src/modules/ai/prompt.service.js';
import type { EndpointSpec } from './scoring.js';

export const CASES_DIR_NAME = 'cases';

export interface EvalCase {
  /** Unique, equal to the file name without `.json`. */
  id: string;
  description: string;
  /** What the product's prompt is built from (see buildPromptFromInput): no database involved. */
  input: PromptInput;
  /** The endpoints a correct answer contains. At least one: production rejects an empty list. */
  expected: EndpointSpec[];
  /** Free labels (express, nestjs, openapi3, auth, errors, es, adversarial, ...). */
  tags?: string[];
  /** Adversarial cases: the endpoint a model that obeyed the injected instruction would add. */
  trap?: { method: string; path: string };
}

/** Loads every `*.json` in `dir`, sorted by id. A malformed file fails with its name (never silently skipped). */
export function loadCases(dir: string): EvalCase[] {
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort();
  return files.map((file) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (error) {
      throw new Error(`Case file ${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const c = parsed as Partial<EvalCase>;
    if (!c || typeof c.id !== 'string' || typeof c.description !== 'string' || !c.input || !Array.isArray(c.expected)) {
      throw new Error(`Case file ${file} must have id, description, input and expected`);
    }
    return c as EvalCase;
  }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
