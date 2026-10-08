import {
  percentile,
  summarize,
  evaluateCriteria,
  compareResults,
  ACCEPTANCE,
  type CaseRow,
  type EvalResult,
} from '../../evals/report.js';

const row = (over: Partial<CaseRow> = {}): CaseRow => ({
  id: 'c',
  validJson: true,
  schemaValid: true,
  methodPathF1: 1,
  fieldCoverage: 1,
  latencyMs: 100,
  ...over,
});

describe('percentile', () => {
  it('a single element is every percentile', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 100)).toBe(42);
  });

  it('odd count: p50 is the middle value', () => {
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([9, 1, 5, 3, 7], 50)).toBe(5);
  });

  it('even count: p50 interpolates between the two middle values', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10, 20], 50)).toBe(15);
  });

  it('p95 / p0 / p100 over 1..100 (linear interpolation)', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, 100)).toBe(100);
    expect(percentile(values, 95)).toBeCloseTo(95.05, 10);
  });

  it('does not reorder or mutate the input', () => {
    const values = [3, 1, 2];
    percentile(values, 50);
    expect(values).toEqual([3, 1, 2]);
  });

  it('an empty list is 0 (nothing was measured)', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('rejects a percentile outside 0..100', () => {
    expect(() => percentile([1], -1)).toThrow();
    expect(() => percentile([1], 101)).toThrow();
  });
});

describe('summarize', () => {
  it('computes percentages, means, latency percentiles and tokens/s', () => {
    const rows = [
      row({ id: 'a', latencyMs: 1000, outputTokens: 100 }),
      row({ id: 'b', schemaValid: false, methodPathF1: 0.5, fieldCoverage: 0.5, latencyMs: 3000, outputTokens: 100 }),
      row({ id: 'c', validJson: false, schemaValid: false, methodPathF1: 0, fieldCoverage: 0, latencyMs: 2000, error: 'timeout' }),
      row({ id: 'd', latencyMs: 4000, outputTokens: 200 }),
    ];
    const s = summarize(rows);
    expect(s.cases).toBe(4);
    expect(s.validJsonPct).toBe(75);
    expect(s.schemaValidPct).toBe(50);
    expect(s.meanMethodPathF1).toBeCloseTo(0.625, 10);
    expect(s.meanFieldCoverage).toBeCloseTo(0.625, 10);
    expect(s.latencyP50Ms).toBe(2500);
    expect(s.latencyP95Ms).toBeCloseTo(3850, 10);
    expect(s.errors).toBe(1);
    // 400 output tokens in the 8 s of the three rows that reported usage: 1 + 3 + 4 s
    expect(s.tokensPerSecond).toBeCloseTo(400 / 8, 10);
  });

  it('tokens/s is absent when no row reported usage', () => {
    expect(summarize([row()]).tokensPerSecond).toBeUndefined();
  });

  it('an empty run summarizes to zeros without NaN', () => {
    const s = summarize([]);
    expect(s).toMatchObject({ cases: 0, validJsonPct: 0, schemaValidPct: 0, meanMethodPathF1: 0, meanFieldCoverage: 0, latencyP95Ms: 0 });
  });
});

describe('evaluateCriteria (schemaValid >= 95 %, mean F1 >= 0.85, p95 <= 60 s)', () => {
  const base = summarize([row({ latencyMs: 1000 })]);

  it('documents the thresholds', () => {
    expect(ACCEPTANCE).toEqual({ minSchemaValidPct: 95, minMeanMethodPathF1: 0.85, maxLatencyP95Ms: 60_000 });
  });

  it('passes exactly on the thresholds (inclusive)', () => {
    const verdict = evaluateCriteria({ ...base, schemaValidPct: 95, meanMethodPathF1: 0.85, latencyP95Ms: 60_000 });
    expect(verdict.pass).toBe(true);
    expect(verdict.checks.every((c) => c.pass)).toBe(true);
  });

  it.each([
    ['schemaValidPct', { schemaValidPct: 94.9 }, 'schemaValid'],
    ['meanMethodPathF1', { meanMethodPathF1: 0.849 }, 'methodPathF1'],
    ['latencyP95Ms', { latencyP95Ms: 60_001 }, 'p95'],
  ])('fails when %s misses its threshold', (_n, patch, label) => {
    const verdict = evaluateCriteria({ ...base, ...patch });
    expect(verdict.pass).toBe(false);
    const failed = verdict.checks.filter((c) => !c.pass);
    expect(failed).toHaveLength(1);
    expect(failed[0].name).toContain(label);
  });

  it('an empty run never passes', () => {
    expect(evaluateCriteria(summarize([])).pass).toBe(false);
  });
});

describe('compareResults', () => {
  const result = (over: Partial<EvalResult['summary']>, id = 'a'): EvalResult => ({
    provider: 'p',
    model: 'm',
    startedAt: '2026-10-08T00:00:00.000Z',
    summary: { ...summarize([row({ id })]), ...over },
    criteria: { pass: true, checks: [] },
    rows: [row({ id })],
  });

  it('compareResults(previous, current) prints each metric as previous -> current with its signed delta', () => {
    const text = compareResults(result({ schemaValidPct: 90, meanMethodPathF1: 0.8, latencyP95Ms: 5000 }), result({ schemaValidPct: 97, meanMethodPathF1: 0.7, latencyP95Ms: 5000 }));
    expect(text).toMatch(/schemaValid%.*90.*97.*\+7/);
    expect(text).toMatch(/methodPathF1.*0\.8.*0\.7.*-0\.1/);
    expect(text).toMatch(/latency p95.*5000.*5000.*0/);
  });

  it('lists cases whose F1 changed and cases that exist on one side only', () => {
    const before = result({}, 'a');
    before.rows = [row({ id: 'a', methodPathF1: 1 }), row({ id: 'gone', methodPathF1: 1 })];
    const after = result({}, 'a');
    after.rows = [row({ id: 'a', methodPathF1: 0.5 }), row({ id: 'new', methodPathF1: 1 })];
    const text = compareResults(before, after);
    expect(text).toMatch(/a.*1.*0\.5/);
    expect(text).toMatch(/only in previous: gone/);
    expect(text).toMatch(/only in current: new/);
  });
});
