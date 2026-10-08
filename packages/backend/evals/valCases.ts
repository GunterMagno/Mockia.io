/**
 * Held-out examples as evaluation cases.
 *
 * `npm run ai:export-dataset` writes val.jsonl (chat format, never used for training). This turns each line into an
 * `EvalCase` so the bench can replay it: the prompt is EXACTLY the stored messages (everything before the final
 * assistant message) and the expectation is the endpoints of that final message. Run them with
 * `npm run eval -- --cases=<dir>` next to the 36 hand-written cases to decide whether a fine-tuned model is promoted.
 *
 * The files derive from user data (already redacted and anonymous): they are written 0600 and belong in the gitignored
 * ai-datasets/ directory. Errors name the line number and never quote a line.
 */

import fs from 'fs';
import path from 'path';
import type { EvalCase } from './cases.js';
import type { EndpointSpec } from './scoring.js';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One val.jsonl line -> case, or the reason it is not usable (without quoting its content). */
function caseFromLine(raw: string, number: number, id: string): EvalCase {
  const bad = (why: string) => new Error(`val.jsonl line ${number}: ${why}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw bad('not valid JSON');
  }
  const messages = isRecord(parsed) ? parsed.messages : undefined;
  if (!Array.isArray(messages) || messages.length < 2) throw bad('"messages" must have a prompt and a final assistant message');
  const last = messages[messages.length - 1];
  if (!isRecord(last) || last.role !== 'assistant' || typeof last.content !== 'string') throw bad('the last message must be the assistant target');
  const prompt = messages.slice(0, -1);
  if (!prompt.every((m) => isRecord(m) && typeof m.role === 'string' && typeof m.content === 'string')) throw bad('every message needs role and content');

  let target: unknown;
  try {
    target = JSON.parse(last.content);
  } catch {
    throw bad('the assistant target is not JSON');
  }
  const endpoints = isRecord(target) ? target.endpoints : undefined;
  if (!Array.isArray(endpoints) || endpoints.length === 0) throw bad('the target has no endpoints');

  return {
    id,
    description: 'Held-out example from val.jsonl (real prompt, redacted; never used for training)',
    // The bench builds the prompt from `messages`; `input` is only the required stub of the case shape
    input: { projectTitle: 'held-out example', userInput: '(see messages)' },
    messages: prompt.map((m) => ({ role: (m as { role: 'system' | 'user' | 'assistant' }).role, content: (m as { content: string }).content })),
    expected: endpoints as EndpointSpec[],
    tags: ['held-out'],
  };
}

/** Parses the text of a val.jsonl (blank lines ignored). Ids are `val-0001`, `val-0002`, ... in file order. */
export function casesFromJsonl(text: string): EvalCase[] {
  const cases: EvalCase[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    if (raw.trim() === '') return;
    cases.push(caseFromLine(raw, index + 1, `val-${String(cases.length + 1).padStart(4, '0')}`));
  });
  return cases;
}

/** Writes `<id>.json` for every case into `dir` (created 0700; files 0600). Returns how many were written. */
export function writeValCases(cases: EvalCase[], dir: string): number {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const c of cases) {
    const file = path.join(dir, `${c.id}.json`);
    fs.rmSync(file, { force: true });
    fs.writeFileSync(file, `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  }
  return cases.length;
}
