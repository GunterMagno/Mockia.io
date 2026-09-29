import {
  MAX_DELAY_MS,
  clampDelay,
  computeDelay,
  clampStatus,
  sanitizeHeaders,
  waitDelay,
} from '../modules/mock/mockBehavior.js';
import { normalizeConfigDto } from '../modules/mock/interceptor.service.js';

describe('mockBehavior: latency and jitter', () => {
  it('clampDelay bounds garbage input to [0, MAX_DELAY_MS]', () => {
    expect(clampDelay(-5)).toBe(0);
    expect(clampDelay(NaN)).toBe(0);
    expect(clampDelay('abc')).toBe(0);
    expect(clampDelay(undefined)).toBe(0);
    expect(clampDelay(Infinity)).toBe(0);
    expect(clampDelay(1e12)).toBe(MAX_DELAY_MS);
    expect(clampDelay(150.9)).toBe(150);
  });

  it('computeDelay without jitter is the base delay', () => {
    expect(computeDelay(200, 0)).toBe(200);
  });

  it('jitter stays inside [base-jitter, base+jitter] and never below 0', () => {
    expect(computeDelay(100, 50, () => 0)).toBe(50);
    expect(computeDelay(100, 50, () => 1)).toBe(150);
    expect(computeDelay(10, 500, () => 0)).toBe(0);
    for (let i = 0; i < 200; i++) {
      const d = computeDelay(100, 30);
      expect(d).toBeGreaterThanOrEqual(70);
      expect(d).toBeLessThanOrEqual(130);
    }
  });

  it('total delay is capped at MAX_DELAY_MS even with huge delay + jitter', () => {
    expect(computeDelay(1e9, 1e9, () => 1)).toBe(MAX_DELAY_MS);
  });

  it('waitDelay subtracts time already elapsed and returns immediately when 0', async () => {
    const t0 = Date.now();
    await waitDelay(Date.now(), 0, 0);
    expect(Date.now() - t0).toBeLessThan(50);
    const t1 = Date.now();
    await waitDelay(Date.now() - 1000, 100, 0); // 1000ms already elapsed
    expect(Date.now() - t1).toBeLessThan(50);
  });
});

describe('mockBehavior: status and headers', () => {
  it('clampStatus only accepts integers 200-599', () => {
    expect(clampStatus(404)).toBe(404);
    expect(clampStatus(99999)).toBe(200);
    expect(clampStatus(100)).toBe(200);
    expect(clampStatus(200.5)).toBe(200);
    expect(clampStatus('abc', 500)).toBe(500);
    expect(clampStatus(null)).toBe(200);
  });

  it('sanitizeHeaders drops hop-by-hop, cookies, CRLF injection and invalid names', () => {
    const out = sanitizeHeaders({
      'X-Custom': 'ok',
      'X-Num': 5,
      'Set-Cookie': 'sid=1',
      'Transfer-Encoding': 'chunked',
      Connection: 'close',
      'Content-Length': '1',
      'Access-Control-Allow-Origin': 'https://evil.example',
      'X-Inject': 'a\r\nSet-Cookie: x=1',
      'bad name': 'v',
      'X-Obj': { a: 1 } as unknown as string,
    });
    expect(out).toEqual({ 'X-Custom': 'ok', 'X-Num': '5' });
  });

  it('sanitizeHeaders tolerates non-objects and caps the count', () => {
    expect(sanitizeHeaders(null)).toEqual({});
    expect(sanitizeHeaders('x')).toEqual({});
    expect(sanitizeHeaders(['a'])).toEqual({});
    const many: Record<string, string> = {};
    for (let i = 0; i < 100; i++) many[`X-H${i}`] = 'v';
    expect(Object.keys(sanitizeHeaders(many))).toHaveLength(20);
  });
});

describe('interceptor normalizeConfigDto', () => {
  it('accepts valid values and clamps delays', () => {
    expect(normalizeConfigDto({ force_status_code: 503, delay_ms: 1e9, jitter_ms: 20 })).toEqual({
      force_status_code: 503,
      delay_ms: MAX_DELAY_MS,
      jitter_ms: 20,
    });
  });

  it('null disables status/delay; invalid values give 400', () => {
    expect(normalizeConfigDto({ force_status_code: null, delay_ms: null })).toEqual({
      force_status_code: 0,
      delay_ms: 0,
    });
    expect(() => normalizeConfigDto({ force_status_code: 99999 })).toThrow('Invalid value for force_status_code');
    expect(() => normalizeConfigDto({ delay_ms: -1 })).toThrow('Invalid value for delay_ms');
    expect(() => normalizeConfigDto({ jitter_ms: 'x' as unknown as number })).toThrow('Invalid value for jitter_ms');
  });
});
