/**
 * Scorer of the AI evaluation bench. Pure: no I/O, no clock, no randomness.
 *
 * It judges one model answer against the endpoints a case expects, with the production code as the authority:
 *   - text is parsed with the same tolerant parser the pipeline uses (markdown fences, prose around the JSON);
 *   - "schema valid" means validateGeneratedApi (the pipeline's validator) accepts it.
 */

import type { MockAPIOutput } from '@mockia/shared';
import { extractJsonFromLLMOutput } from '../src/modules/ai/llmOutputParser.js';
import { validateGeneratedApi } from '../src/modules/ai/llmOutputValidator.js';

/** One endpoint of the specification the model must produce (the validator's own type). */
export type EndpointSpec = MockAPIOutput['endpoints'][number];

export interface Score {
  /** The answer could be parsed as a JSON object/array (after the pipeline's tolerant extraction). */
  validJson: boolean;
  /** The production validator accepts it as a mock API specification. */
  schemaValid: boolean;
  /** F1 over the set of normalized "METHOD path" pairs. */
  methodPathF1: number;
  /** Mean share of the expected top-level response fields found in the answer, over the endpoints that matched. */
  fieldCoverage: number;
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);

/** `:id`, `{id}` and `{userId}` are all "a path parameter". */
const isParamSegment = (segment: string) => /^:[^/]+$/.test(segment) || /^\{[^/}]+\}$/.test(segment);

/**
 * Canonical key of an endpoint: upper-case method plus a path with the host, query string, duplicate and trailing
 * slashes removed, lower-cased, and every path parameter written as `:param`.
 */
export function normalizeMethodPath(method: string, path: string): string {
  const withoutHost = path.trim().replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  const withoutQuery = withoutHost.split(/[?#]/)[0];
  const segments = withoutQuery
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => (isParamSegment(segment) ? ':param' : segment.toLowerCase()));
  return `${method.trim().toUpperCase()} /${segments.join('/')}`;
}

/** Text goes through the production parser; an already parsed object/array is taken as is. `undefined` = not JSON. */
function parseAnswer(actual: unknown): object | undefined {
  if (typeof actual === 'string') {
    try {
      const parsed = extractJsonFromLLMOutput(actual, { silent: true });
      return parsed !== null && typeof parsed === 'object' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return actual !== null && typeof actual === 'object' ? actual : undefined;
}

function isSchemaValid(parsed: object): boolean {
  try {
    // The validator heals examples IN PLACE: validate a copy so the content scoring still sees what the model wrote.
    validateGeneratedApi(JSON.parse(JSON.stringify(parsed)));
    return true;
  } catch {
    return false;
  }
}

interface EndpointLike {
  method: string;
  path: string;
  examples?: unknown;
}

/** Endpoints found in an answer, leniently: anything with a string method and a string path counts. */
function endpointsOf(value: unknown): EndpointLike[] {
  if (!isRecord(value) || !Array.isArray(value.endpoints)) return [];
  return value.endpoints.filter(
    (ep): ep is EndpointLike => isRecord(ep) && typeof ep.method === 'string' && typeof ep.path === 'string'
  );
}

/** Endpoints by key; when the same endpoint appears twice the first one is kept. */
function indexByKey(endpoints: EndpointLike[]): Map<string, EndpointLike> {
  const byKey = new Map<string, EndpointLike>();
  for (const ep of endpoints) {
    const key = normalizeMethodPath(ep.method, ep.path);
    if (!byKey.has(key)) byKey.set(key, ep);
  }
  return byKey;
}

/** Response body of one example, read the way the validator heals it: wrapped, request-only, or a flat body. */
function bodyOfExample(example: Json): unknown {
  const response = example.response;
  if (response && typeof response === 'object') return response;
  const request = example.request;
  if (request && typeof request === 'object') return {};
  return example;
}

/** Body of the first example that is a success (no status, or a 2xx `statusCode`/`status`). */
function successBody(endpoint: EndpointLike): unknown {
  if (!Array.isArray(endpoint.examples)) return undefined;
  for (const example of endpoint.examples) {
    if (!isRecord(example)) continue;
    const status = typeof example.statusCode === 'number' ? example.statusCode : typeof example.status === 'number' ? example.status : undefined;
    if (status !== undefined && (status < 200 || status >= 300)) continue;
    return bodyOfExample(example);
  }
  return undefined;
}

/** Top-level field names of a body (the first item's, for a list). */
function fieldNames(body: unknown): string[] {
  if (Array.isArray(body)) return isRecord(body[0]) ? Object.keys(body[0]) : [];
  return isRecord(body) ? Object.keys(body) : [];
}

function f1(expectedKeys: Set<string>, actualKeys: Set<string>): number {
  if (expectedKeys.size === 0 && actualKeys.size === 0) return 1;
  if (expectedKeys.size === 0 || actualKeys.size === 0) return 0;
  let hits = 0;
  for (const key of actualKeys) if (expectedKeys.has(key)) hits += 1;
  if (hits === 0) return 0;
  const precision = hits / actualKeys.size;
  const recall = hits / expectedKeys.size;
  return (2 * precision * recall) / (precision + recall);
}

function coverage(expected: Map<string, EndpointLike>, actual: Map<string, EndpointLike>): number {
  const checks: Array<{ wanted: string[]; found: Set<string> }> = [];
  let anyFieldToCheck = false;
  for (const [key, expectedEndpoint] of expected) {
    const wanted = fieldNames(successBody(expectedEndpoint));
    if (wanted.length > 0) anyFieldToCheck = true;
    const actualEndpoint = actual.get(key);
    if (actualEndpoint && wanted.length > 0) {
      checks.push({ wanted, found: new Set(fieldNames(successBody(actualEndpoint))) });
    }
  }
  if (!anyFieldToCheck) return 1;
  if (checks.length === 0) return 0;
  const shares = checks.map(({ wanted, found }) => wanted.filter((name) => found.has(name)).length / wanted.length);
  return shares.reduce((sum, share) => sum + share, 0) / shares.length;
}

/**
 * @param expected endpoints the case expects
 * @param actual raw model text, or the already parsed answer
 */
export function scoreOutput(expected: EndpointSpec[], actual: unknown): Score {
  const parsed = parseAnswer(actual);
  if (parsed === undefined) return { validJson: false, schemaValid: false, methodPathF1: 0, fieldCoverage: 0 };

  const expectedByKey = indexByKey(endpointsOf({ endpoints: expected }));
  const actualByKey = indexByKey(endpointsOf(parsed));

  return {
    validJson: true,
    schemaValid: isSchemaValid(parsed),
    methodPathF1: f1(new Set(expectedByKey.keys()), new Set(actualByKey.keys())),
    fieldCoverage: coverage(expectedByKey, actualByKey),
  };
}
