/**
 * Aggregation, acceptance verdict, comparison and printing of an evaluation run. Pure functions over the per-case rows.
 */

export interface CaseRow {
  id: string;
  validJson: boolean;
  schemaValid: boolean;
  methodPathF1: number;
  fieldCoverage: number;
  latencyMs: number;
  /** Output tokens, when the provider reported usage. */
  outputTokens?: number;
  /** outputTokens / latency of this call. */
  tokensPerSecond?: number;
  /** Class of the failure (timeout, connection_refused, http_500, ...) when the call itself failed. Never a message. */
  error?: string;
}

export interface Summary {
  cases: number;
  validJsonPct: number;
  schemaValidPct: number;
  meanMethodPathF1: number;
  meanFieldCoverage: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  /** Total output tokens over the time spent on the calls that reported usage. */
  tokensPerSecond?: number;
  errors: number;
}

export interface Check {
  name: string;
  value: number;
  threshold: number;
  /** `>=` or `<=`. */
  comparator: '>=' | '<=';
  pass: boolean;
}

export interface Criteria {
  pass: boolean;
  checks: Check[];
}

export interface EvalResult {
  provider: string;
  model: string;
  startedAt: string;
  summary: Summary;
  criteria: Criteria;
  rows: CaseRow[];
}

/** Decision rule to replace OpenRouter with another model (plan, Task 13). */
export const ACCEPTANCE = {
  minSchemaValidPct: 95,
  minMeanMethodPathF1: 0.85,
  maxLatencyP95Ms: 60_000,
} as const;

/** Percentile with linear interpolation between the closest ranks (the usual "type 7"). 0 for an empty list. */
export function percentile(values: number[], p: number): number {
  if (!(p >= 0 && p <= 100)) throw new RangeError(`percentile must be between 0 and 100, got ${p}`);
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length);

export function summarize(rows: CaseRow[]): Summary {
  const pct = (count: number) => (rows.length === 0 ? 0 : (count / rows.length) * 100);
  const withUsage = rows.filter((r) => r.outputTokens !== undefined);
  const generationSeconds = withUsage.reduce((sum, r) => sum + r.latencyMs, 0) / 1000;
  const outputTokens = withUsage.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0);

  const summary: Summary = {
    cases: rows.length,
    validJsonPct: pct(rows.filter((r) => r.validJson).length),
    schemaValidPct: pct(rows.filter((r) => r.schemaValid).length),
    meanMethodPathF1: mean(rows.map((r) => r.methodPathF1)),
    meanFieldCoverage: mean(rows.map((r) => r.fieldCoverage)),
    latencyP50Ms: percentile(rows.map((r) => r.latencyMs), 50),
    latencyP95Ms: percentile(rows.map((r) => r.latencyMs), 95),
    errors: rows.filter((r) => r.error !== undefined).length,
  };
  if (withUsage.length > 0 && generationSeconds > 0) summary.tokensPerSecond = outputTokens / generationSeconds;
  return summary;
}

export function evaluateCriteria(summary: Summary): Criteria {
  const checks: Check[] = [
    { name: 'schemaValid%', value: summary.schemaValidPct, threshold: ACCEPTANCE.minSchemaValidPct, comparator: '>=', pass: false },
    { name: 'mean methodPathF1', value: summary.meanMethodPathF1, threshold: ACCEPTANCE.minMeanMethodPathF1, comparator: '>=', pass: false },
    { name: 'latency p95 (ms)', value: summary.latencyP95Ms, threshold: ACCEPTANCE.maxLatencyP95Ms, comparator: '<=', pass: false },
  ];
  for (const check of checks) {
    check.pass = check.comparator === '>=' ? check.value >= check.threshold : check.value <= check.threshold;
  }
  // A run that measured nothing proves nothing, even though 0 ms is under the latency limit.
  const pass = summary.cases > 0 && checks.every((c) => c.pass);
  return { pass, checks };
}

/* ------------------------------------------------------------------------------------------------------------------
 * Printing
 * ---------------------------------------------------------------------------------------------------------------- */

const round = (n: number, digits = 3) => Number(n.toFixed(digits));
const signed = (n: number, digits = 3) => (n > 0 ? '+' : '') + String(round(n, digits));

export function formatRows(rows: CaseRow[]): string {
  const idWidth = Math.max(2, ...rows.map((r) => r.id.length));
  const header = `${'id'.padEnd(idWidth)}  json schema      F1 fields  latency(ms)  error`;
  const lines = rows.map((r) =>
    [
      r.id.padEnd(idWidth),
      (r.validJson ? 'yes' : 'NO').padStart(4),
      (r.schemaValid ? 'yes' : 'NO').padStart(6),
      r.methodPathF1.toFixed(3).padStart(7),
      r.fieldCoverage.toFixed(3).padStart(6),
      String(Math.round(r.latencyMs)).padStart(12),
      r.error ? `  ${r.error}` : '',
    ].join(' ')
  );
  return [header, ...lines].join('\n');
}

export function formatSummary(result: Pick<EvalResult, 'provider' | 'model' | 'summary' | 'criteria'>): string {
  const { summary: s, criteria } = result;
  const lines = [
    `Provider: ${result.provider}   Model: ${result.model}   Cases: ${s.cases}   Call errors: ${s.errors}`,
    `validJson%      : ${round(s.validJsonPct, 1)}`,
    `schemaValid%    : ${round(s.schemaValidPct, 1)}`,
    `methodPathF1    : ${s.meanMethodPathF1.toFixed(3)}  (mean)`,
    `fieldCoverage   : ${s.meanFieldCoverage.toFixed(3)}  (mean)`,
    `latency p50     : ${Math.round(s.latencyP50Ms)} ms`,
    `latency p95     : ${Math.round(s.latencyP95Ms)} ms`,
    `tokens/s        : ${s.tokensPerSecond === undefined ? 'n/a (no usage reported)' : round(s.tokensPerSecond, 1)}`,
    '',
    `Acceptance criteria (schemaValid >= ${ACCEPTANCE.minSchemaValidPct} %, mean F1 >= ${ACCEPTANCE.minMeanMethodPathF1}, p95 <= ${ACCEPTANCE.maxLatencyP95Ms / 1000} s):`,
    ...criteria.checks.map(
      (c) => `  [${c.pass ? 'ok' : 'XX'}] ${c.name}: ${round(c.value)} (${c.comparator} ${c.threshold})`
    ),
    criteria.pass ? 'PASS: this model meets the criteria to replace OpenRouter' : 'FAIL: this model does not meet the criteria to replace OpenRouter',
  ];
  return lines.join('\n');
}

/** previous -> current for every metric, plus the cases whose F1 moved and the ones present on one side only. */
export function compareResults(previous: EvalResult, current: EvalResult): string {
  const p = previous.summary;
  const c = current.summary;
  const metric = (name: string, before: number, after: number, digits = 3) =>
    `  ${name.padEnd(18)} ${String(round(before, digits)).padStart(9)} -> ${String(round(after, digits)).padEnd(9)} (${signed(after - before, digits)})`;
  const lines = [
    `Comparison with ${previous.provider} / ${previous.model} (${previous.startedAt})`,
    metric('validJson%', p.validJsonPct, c.validJsonPct, 1),
    metric('schemaValid%', p.schemaValidPct, c.schemaValidPct, 1),
    metric('mean methodPathF1', p.meanMethodPathF1, c.meanMethodPathF1),
    metric('mean fieldCoverage', p.meanFieldCoverage, c.meanFieldCoverage),
    metric('latency p50 (ms)', p.latencyP50Ms, c.latencyP50Ms, 0),
    metric('latency p95 (ms)', p.latencyP95Ms, c.latencyP95Ms, 0),
  ];

  const before = new Map(previous.rows.map((r) => [r.id, r]));
  const after = new Map(current.rows.map((r) => [r.id, r]));
  const moved = [...after.values()]
    .filter((r) => before.has(r.id) && Math.abs(r.methodPathF1 - before.get(r.id)!.methodPathF1) > 1e-9)
    .map((r) => `  ${r.id}: F1 ${round(before.get(r.id)!.methodPathF1)} -> ${round(r.methodPathF1)}`);
  if (moved.length > 0) lines.push('Cases whose F1 changed:', ...moved);

  const onlyPrevious = [...before.keys()].filter((id) => !after.has(id));
  const onlyCurrent = [...after.keys()].filter((id) => !before.has(id));
  if (onlyPrevious.length > 0) lines.push(`Cases only in previous: ${onlyPrevious.join(', ')}`);
  if (onlyCurrent.length > 0) lines.push(`Cases only in current: ${onlyCurrent.join(', ')}`);
  return lines.join('\n');
}

/** A parsed file is a usable result only if it has the fields compareResults reads. */
export function isEvalResult(value: unknown): value is EvalResult {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Partial<EvalResult>;
  return (
    typeof v.provider === 'string' &&
    typeof v.model === 'string' &&
    Array.isArray(v.rows) &&
    v.summary !== null &&
    typeof v.summary === 'object' &&
    typeof (v.summary as Summary).schemaValidPct === 'number' &&
    typeof (v.summary as Summary).meanMethodPathF1 === 'number'
  );
}
