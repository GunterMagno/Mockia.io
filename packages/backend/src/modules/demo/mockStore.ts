import crypto from 'crypto';
import { DemoMockModel, type DemoEndpointDocument, type DemoMockDocument } from '../../models/DemoMock.js';
import { calculatePatternSpecificity, extractPathParams, hasWildcards } from '../mock/pathParams.util.js';
import { getDemoConfig } from './config.js';

/**
 * Storage and matching of the demo's ephemeral mocks. Everything a visitor (or the model that writes the mock for
 * them) hands over is untrusted: createDemoMock validates it and keeps only what the router is willing to serve.
 */

export const DEMO_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type DemoMethod = (typeof DEMO_METHODS)[number];

export interface DemoEndpoint {
  method: DemoMethod;
  path: string;
  statusCode: number;
  /** Any JSON value (null for an empty answer). */
  body: unknown;
  headers?: Record<string, string>;
}

export const MAX_BODY_BYTES = 8 * 1024;
const MAX_PATH_LENGTH = 200;
const MAX_HEADER_VALUE = 200;
const MAX_HEADERS = 5;

/**
 * The only response headers a demo mock may set. Nothing here can move the browser (Location, Refresh), set state
 * (Set-Cookie), widen CORS or change how the body is read: those belong to the server.
 */
export const ALLOWED_DEMO_HEADERS = new Set([
  'x-total-count',
  'x-page',
  'x-per-page',
  'x-next-cursor',
  'x-request-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'etag',
  'last-modified',
]);

/** C0 controls (except TAB, LF, CR, which are fine inside text) and DEL. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const HEADER_VALUE = /^[\x20-\x7e]*$/;
// No "%": Express hands the router the DECODED path, so a stored "/a%20b" could never match any request.
const PATH = /^\/[A-Za-z0-9\-._~:@/]*$/;

/** The input cannot become a demo mock; `reason` is safe to show the caller. */
export class DemoMockError extends Error {
  constructor(public reason: string) {
    super(`Invalid demo mock: ${reason}`);
    this.name = 'DemoMockError';
  }
}

export const normalizeDemoPath = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
};

/** True when a string anywhere inside the JSON value carries a control character (object keys included). */
function hasControlChars(value: unknown, depth = 0): boolean {
  if (depth > 64) return true;
  if (typeof value === 'string') return CONTROL.test(value);
  if (Array.isArray(value)) return value.some((v) => hasControlChars(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => CONTROL.test(k) || hasControlChars(v, depth + 1));
  }
  return false;
}

function cleanEndpoint(raw: DemoEndpoint): DemoEndpointDocument {
  const method = String(raw?.method ?? '').toUpperCase() as DemoMethod;
  if (!DEMO_METHODS.includes(method)) throw new DemoMockError('method not allowed');

  const rawPath = raw.path;
  if (typeof rawPath !== 'string' || rawPath.length > MAX_PATH_LENGTH || !PATH.test(rawPath)) {
    throw new DemoMockError('invalid path');
  }
  if (rawPath.split('/').some((s) => s === '..' || s === '.')) throw new DemoMockError('invalid path');

  const statusCode = raw.statusCode;
  if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode > 599) throw new DemoMockError('invalid status code');

  let bodyJson: string | undefined;
  try {
    bodyJson = JSON.stringify(raw.body === undefined ? null : raw.body);
  } catch {
    throw new DemoMockError('body is not JSON');
  }
  if (bodyJson === undefined) throw new DemoMockError('body is not JSON');
  if (Buffer.byteLength(bodyJson, 'utf8') > MAX_BODY_BYTES) throw new DemoMockError('body is larger than 8 KB');
  if (hasControlChars(JSON.parse(bodyJson))) throw new DemoMockError('body has control characters');

  const headers: Record<string, string> = {};
  if (raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers)) {
    for (const [name, value] of Object.entries(raw.headers)) {
      const key = name.trim().toLowerCase();
      if (Object.keys(headers).length >= MAX_HEADERS) break;
      if (!ALLOWED_DEMO_HEADERS.has(key)) continue;
      if (typeof value !== 'string' || value.length > MAX_HEADER_VALUE || !HEADER_VALUE.test(value)) continue;
      headers[key] = value;
    }
  }

  return { method, path: normalizeDemoPath(rawPath), statusCode, bodyJson, headers };
}

/**
 * Creates the mock of one visitor. Keeps the first `maxEndpoints` endpoints, ignores a repeated method+path, and
 * throws DemoMockError for anything it will not serve (nothing is silently "fixed" except headers outside the
 * allow-list, which are dropped). The router always answers `Content-Type: application/json`.
 */
export async function createDemoMock(
  ipHash: string,
  endpoints: DemoEndpoint[],
  now: Date = new Date(),
): Promise<{ demoId: string; expiresAt: Date }> {
  const cfg = getDemoConfig();
  const kept = (Array.isArray(endpoints) ? endpoints : []).slice(0, cfg.maxEndpoints);
  const seen = new Set<string>();
  const clean: DemoEndpointDocument[] = [];
  for (const raw of kept) {
    const endpoint = cleanEndpoint(raw);
    const id = `${endpoint.method} ${endpoint.path}`;
    if (seen.has(id)) continue;
    seen.add(id);
    clean.push(endpoint);
  }
  if (clean.length === 0) throw new DemoMockError('no endpoints');

  const demoId = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(now.getTime() + cfg.mockTtlMinutes * 60 * 1000);
  await DemoMockModel.create({ demoId, ipHash, endpoints: clean, requestCount: 0, createdAt: now, expiresAt });
  return { demoId, expiresAt };
}

export const isDemoId = (value: string): boolean => /^[0-9a-f]{32}$/.test(value);

/** The demo mock if it exists and has not expired at `now` (null otherwise). */
export async function findLiveDemoMock(demoId: string, now: Date): Promise<DemoMockDocument | null> {
  if (!isDemoId(demoId)) return null;
  return DemoMockModel.findOne({ demoId, expiresAt: { $gt: now } }).lean<DemoMockDocument>();
}

/**
 * Endpoint answering `method path`: static routes first, then parameter routes, most specific first (the same
 * order as the project mocks, reusing their pattern helpers). Null when nothing matches.
 */
export function matchDemoEndpoint(endpoints: DemoEndpointDocument[], method: string, path: string): DemoEndpointDocument | null {
  const wanted = normalizeDemoPath(path);
  const sameMethod = endpoints.filter((e) => e.method === method);
  const exact = sameMethod.filter((e) => !hasWildcards(e.path)).find((e) => e.path === wanted);
  if (exact) return exact;
  return (
    sameMethod
      .filter((e) => hasWildcards(e.path))
      .sort((a, b) => calculatePatternSpecificity(b.path) - calculatePatternSpecificity(a.path))
      .find((e) => extractPathParams(e.path, wanted) !== null) ?? null
  );
}

/** Takes one of the mock's requests unless it already served `max`. Atomic: concurrent callers cannot exceed it. */
export async function reserveDemoRequest(demoId: string, max: number): Promise<boolean> {
  const res = await DemoMockModel.updateOne({ demoId, requestCount: { $lt: max } }, { $inc: { requestCount: 1 } });
  return res.modifiedCount === 1;
}

/** Gives a reserved request back (the visitor's own daily limit refused it after the mock's counter took it). */
export async function releaseDemoRequest(demoId: string): Promise<void> {
  await DemoMockModel.updateOne({ demoId, requestCount: { $gt: 0 } }, { $inc: { requestCount: -1 } }).catch(() => undefined);
}
