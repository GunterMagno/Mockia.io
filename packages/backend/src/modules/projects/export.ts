/**
 * Exportacion de los mocks de un proyecto: OpenAPI 3.1, coleccion Postman v2.1 y handlers MSW v2.
 *
 * Los tres formatos salen de los mismos datos normalizados (`loadExportProject`) y reflejan lo que el motor mock
 * serviria. Nunca incluyen la API key del proyecto (solo el nombre de la cabecera) ni ningun otro secreto.
 */

import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import { Types } from 'mongoose';
import { ErrorCode } from '@mockia/shared';
import { AppError } from '../../middlewares/errorHandler.js';
import { ProjectModel } from '../../models/Project.js';
import { EndpointModel, MockAPIModel } from '../../models/MockAPI.js';
import { EndpointConfigModel } from '../../models/EndpointConfig.js';
import { appBaseUrl } from '../auth/passwordReset.js';
import { getDefaultErrorBody } from '../mock/errorHelper.js';
import { clampDelay, clampStatus, sanitizeHeaders } from '../mock/mockBehavior.js';
import {
  NO_BODY_STATUSES,
  buildOpenApiDocument,
  pathSegments,
  requestBodyOf,
  toExpressPath,
  type ExportEndpoint,
  type ExportProject,
  type ExportResponse,
  type HttpMethod,
} from '../mock/openapiExport.js';

export type ExportFormat = 'openapi' | 'postman' | 'msw';
export const EXPORT_FORMATS: readonly ExportFormat[] = ['openapi', 'postman', 'msw'];

type Json = Record<string, unknown>;

/** URL publica del mock del proyecto: la que usa la app (`<API>/mock/<slug>`), sin API key. */
export function publicMockBaseUrl(slug: string): string {
  return `${appBaseUrl()}/api/mock/${encodeURIComponent(slug)}`;
}

/** Cuerpo que sirve el motor mock para una respuesta guardada. */
function servedBody(r: { schema?: unknown; examples?: unknown }): unknown {
  const firstExample = Array.isArray(r.examples) ? r.examples[0] : undefined;
  return r.schema || firstExample || {};
}

/** Carga y normaliza el proyecto con todos sus endpoints, respuestas y configuracion. */
async function loadExportProject(projectId: string): Promise<ExportProject> {
  if (!projectId || !Types.ObjectId.isValid(projectId)) {
    throw new AppError('Project not found', ErrorCode.NOT_FOUND, 404);
  }
  const project = await ProjectModel.findById(projectId).lean();
  if (!project) throw new AppError('Project not found', ErrorCode.NOT_FOUND, 404);

  const mockApi = await MockAPIModel.findOne({ projectId: project._id }).lean();
  const docs = mockApi
    ? await EndpointModel.find({ mockApiId: mockApi._id }).populate('responses').sort({ createdAt: 1, _id: 1 }).lean()
    : [];
  const configs = docs.length
    ? await EndpointConfigModel.find({ endpointId: { $in: docs.map((d) => d._id) } }).lean()
    : [];
  const configById = new Map(configs.map((c) => [String(c.endpointId), c]));

  const endpoints: ExportEndpoint[] = docs.map((doc) => {
    const cfg = configById.get(String(doc._id));
    const responses: ExportResponse[] = ((doc.responses ?? []) as unknown as Array<Record<string, unknown>>)
      .filter((r) => r && typeof r === 'object' && 'statusCode' in r)
      .map((r) => ({
        statusCode: Number(r.statusCode),
        name: typeof r.name === 'string' ? r.name : undefined,
        description: typeof r.description === 'string' ? r.description : undefined,
        body: servedBody(r),
      }));
    return {
      method: doc.method as HttpMethod,
      path: toExpressPath(doc.path),
      description: doc.description ?? '',
      requestSchema: doc.requestSchema,
      responses,
      config: cfg
        ? {
            forceStatusCode: cfg.force_status_code || undefined,
            delayMs: cfg.delay_ms,
            jitterMs: cfg.jitter_ms,
            headers: sanitizeHeaders(cfg.headers),
            overrideResponse: cfg.override_response,
          }
        : undefined,
    };
  });

  return {
    title: project.title,
    slug: project.slug,
    description: project.description ?? '',
    apiVersion: mockApi?.apiVersion || '1.0.0',
    hasApiKey: project.visibility === 'key',
    endpoints,
  };
}

/** Documento OpenAPI 3.1.0 con todas las rutas del proyecto. */
export async function exportOpenApi(projectId: string): Promise<object> {
  const project = await loadExportProject(projectId);
  return buildOpenApiDocument(project, publicMockBaseUrl(project.slug));
}

// ---------------------------------------------------------------------------------------------------------------
// Postman v2.1
// ---------------------------------------------------------------------------------------------------------------

const POSTMAN_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
const reason = (status: number): string => STATUS_CODES[status] ?? 'Unknown';

/** Coleccion Postman v2.1 con la variable `{{baseUrl}}` (y `{{apiKey}}` si el proyecto la exige). */
export async function exportPostman(projectId: string): Promise<object> {
  const project = await loadExportProject(projectId);

  const items = project.endpoints.map((endpoint) => {
    const segments = pathSegments(endpoint.path);
    const variableNames = [...new Set(segments.filter((s) => s.startsWith(':')).map((s) => s.slice(1)))];
    const body = requestBodyOf(endpoint);

    const header: Array<{ key: string; value: string }> = [];
    if (body) header.push({ key: 'Content-Type', value: 'application/json' });
    if (project.hasApiKey) header.push({ key: 'X-Mockia-API-Key', value: '{{apiKey}}' });

    const request: Json = {
      method: endpoint.method,
      header,
      url: {
        raw: `{{baseUrl}}/${segments.join('/')}`,
        host: ['{{baseUrl}}'],
        path: segments,
        variable: variableNames.map((key) => ({ key, value: '1' })),
      },
    };
    if (body) {
      request.body = {
        mode: 'raw',
        raw: JSON.stringify(body.example, null, 2),
        options: { raw: { language: 'json' } },
      };
    }
    if (endpoint.description.trim()) request.description = endpoint.description.trim();

    const responses = (endpoint.responses.length ? endpoint.responses : [{ statusCode: 200, body: {} } as ExportResponse]).map((r) => ({
      name: r.name?.trim() || `${r.statusCode} ${reason(r.statusCode)}`,
      originalRequest: request,
      status: reason(r.statusCode),
      code: r.statusCode,
      _postman_previewlanguage: 'json',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      cookie: [],
      body: NO_BODY_STATUSES.has(r.statusCode) ? '' : JSON.stringify(r.body, null, 2),
    }));

    return { name: `${endpoint.method} /${segments.join('/')}`, request, response: responses };
  });

  const variable: Array<Json> = [{ key: 'baseUrl', value: publicMockBaseUrl(project.slug), type: 'string' }];
  if (project.hasApiKey) variable.push({ key: 'apiKey', value: '', type: 'secret' });

  const info: Json = { _postman_id: randomUUID(), name: project.title || project.slug, schema: POSTMAN_SCHEMA };
  if (project.description.trim()) info.description = project.description.trim();
  return { info, item: items, variable };
}

// ---------------------------------------------------------------------------------------------------------------
// MSW v2
// ---------------------------------------------------------------------------------------------------------------

/** JSON seguro para incrustar en codigo TS: `<` y los separadores de linea Unicode se escapan. */
function tsLiteral(value: unknown, indent = ''): string {
  const json = JSON.stringify(value, null, 2) ?? 'null';
  return json
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .split('\n')
    .join(`\n${indent}`);
}

const tsString = (value: string): string => tsLiteral(value);

/** Texto de una sola linea para comentarios `//` (un salto de linea sacaria el resto del comentario). */
const oneLine = (text: string, max = 200): string =>
  text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/</g, '&lt;').trim().slice(0, max);

interface Outcome {
  status: number;
  body: unknown;
}

/** Respuesta que Mockia da por defecto a un endpoint, aplicando status forzado y override de su configuracion. */
function defaultOutcome(endpoint: ExportEndpoint): Outcome {
  const first = endpoint.responses[0];
  let status = clampStatus(first?.statusCode, 200);
  let body: unknown = first ? first.body : {};
  const cfg = endpoint.config;
  if (cfg?.forceStatusCode) {
    status = clampStatus(cfg.forceStatusCode, status);
    const match = endpoint.responses.find((r) => r.statusCode === status);
    if (match) body = match.body;
    else if (status === 204) body = null;
    else if (status >= 400) body = getDefaultErrorBody(status);
  }
  if (cfg?.overrideResponse !== undefined && cfg.overrideResponse !== null) body = cfg.overrideResponse;
  return { status, body };
}

function returnExpression(outcome: Outcome, headers: Record<string, string>, indent: string): string {
  const hasHeaders = Object.keys(headers).length > 0;
  const init = hasHeaders
    ? `{ status: ${outcome.status}, headers: ${tsLiteral(headers, indent)} }`
    : `{ status: ${outcome.status} }`;
  if (NO_BODY_STATUSES.has(outcome.status) || outcome.body === null) {
    return `new HttpResponse(null, ${init})`;
  }
  return `HttpResponse.json(${tsLiteral(outcome.body, indent)}, ${init})`;
}

function delayExpression(cfg: ExportEndpoint['config']): string | null {
  const base = clampDelay(cfg?.delayMs);
  const jitter = clampDelay(cfg?.jitterMs);
  if (base === 0 && jitter === 0) return null;
  if (jitter === 0) return String(base);
  return `Math.min(30000, Math.max(0, ${base} + Math.round((Math.random() * 2 - 1) * ${jitter})))`;
}

const MSW_METHOD: Record<HttpMethod, string> = { GET: 'get', POST: 'post', PUT: 'put', DELETE: 'delete', PATCH: 'patch' };

/** Codigo TypeScript con los handlers MSW v2 del proyecto (`export const handlers = [...]`). */
export async function exportMswHandlers(projectId: string): Promise<string> {
  const project = await loadExportProject(projectId);

  let usesDelay = false;
  let usesVariants = false;
  const handlers: string[] = [];

  for (const endpoint of project.endpoints) {
    const path = toExpressPath(endpoint.path);
    const main = defaultOutcome(endpoint);
    const headers = endpoint.config?.headers ?? {};
    const seen = new Set<number>([main.status]);
    const variants: Outcome[] = [];
    for (const r of endpoint.responses) {
      const status = clampStatus(r.statusCode, 200);
      if (seen.has(status)) continue;
      seen.add(status);
      variants.push({ status, body: r.body });
    }

    const delayExpr = delayExpression(endpoint.config);
    if (delayExpr) usesDelay = true;
    if (variants.length > 0) usesVariants = true;

    const params = variants.length > 0 ? '{ request }' : '';
    const lines: string[] = [];
    const description = endpoint.description.trim() === `${endpoint.method} ${path}` ? '' : oneLine(endpoint.description);
    lines.push(`  // ${endpoint.method} ${oneLine(path)}${description ? ` - ${description}` : ''}`);
    lines.push(`  http.${MSW_METHOD[endpoint.method]}(${tsString(path)}, ${delayExpr ? 'async ' : ''}(${params}) => {`);
    if (delayExpr) lines.push(`    await delay(${delayExpr});`);
    if (variants.length > 0) {
      lines.push('    const status = requestedStatus(request);');
      for (const v of variants) {
        lines.push(`    if (status === ${v.status}) {`);
        lines.push(`      return ${returnExpression(v, headers, '      ')};`);
        lines.push('    }');
      }
    }
    lines.push(`    return ${returnExpression(main, headers, '    ')};`);
    lines.push('  }),');
    handlers.push(lines.join('\n'));
  }

  const out: string[] = [
    '/**',
    ' * MSW v2 request handlers generated by Mockia.io.',
    ` * Project: ${oneLine(project.title || project.slug).replace(/\*\//g, '* /')} (${oneLine(project.slug).replace(/\*\//g, '* /')})`,
    ' *',
    ' * Browser:  import { setupWorker } from "msw/browser";  setupWorker(...handlers).start();',
    ' * Node:     import { setupServer } from "msw/node";     setupServer(...handlers).listen();',
    ' *',
    ' * Paths are relative. If your app calls an absolute URL, prefix them (for example "*" + path, or your API base URL).',
    ' * Send "?_status=404" or the "x-mockia-response-status" header to get a non-default stored response.',
    ' */',
    handlers.length > 0
      ? `import { http, HttpResponse${usesDelay ? ', delay' : ''} } from 'msw';`
      : "import type { RequestHandler } from 'msw';",
    '',
  ];
  if (usesVariants) {
    out.push(
      'function requestedStatus(request: Request): number | null {',
      "  const raw = new URL(request.url).searchParams.get('_status') ?? request.headers.get('x-mockia-response-status');",
      '  const status = raw === null ? Number.NaN : Number.parseInt(raw, 10);',
      '  return Number.isNaN(status) ? null : status;',
      '}',
      ''
    );
  }
  if (handlers.length === 0) out.push('export const handlers: RequestHandler[] = [];', '');
  else out.push('export const handlers = [', ...handlers, '];', '');
  return out.join('\n');
}
