/**
 * Constructor puro del documento OpenAPI 3.1 de un proyecto (sin acceso a la BD).
 *
 * `swaggerGenerator.ts` (el generador del Swagger UI) se queda tal cual: emite 3.0.0, usa el cuerpo de ejemplo como
 * "schema" y no declara servidores ni parametros de ruta, asi que su salida no valida como OpenAPI 3.1. La
 * exportacion necesita un documento que lo haga, y lo construye aqui a partir de los datos ya normalizados.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/** Una respuesta guardada del endpoint, con el cuerpo que Mockia serviria. */
export interface ExportResponse {
  statusCode: number;
  name?: string;
  description?: string;
  /** Cuerpo servido (`schema || examples[0] || {}`, como el motor mock). */
  body: unknown;
}

export interface ExportEndpoint {
  method: HttpMethod;
  /** Ruta estilo Express (`/users/:id`). */
  path: string;
  description: string;
  requestSchema?: unknown;
  responses: ExportResponse[];
  config?: {
    forceStatusCode?: number;
    delayMs?: number;
    jitterMs?: number;
    headers?: Record<string, string>;
    overrideResponse?: unknown;
  };
}

export interface ExportProject {
  title: string;
  slug: string;
  description: string;
  apiVersion: string;
  /** El proyecto exige X-Mockia-API-Key. El valor nunca se exporta. */
  hasApiKey: boolean;
  endpoints: ExportEndpoint[];
}

type Json = Record<string, unknown>;

const SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);
const MAX_DEPTH = 8;

/** Estados sin cuerpo: ni `content` en OpenAPI ni `HttpResponse.json` en MSW. */
export const NO_BODY_STATUSES = new Set([204, 205, 304]);

export const isPlainObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Segmentos de una ruta; `{id}` se acepta como alias de `:id`. */
export function pathSegments(path: string): string[] {
  return String(path ?? '')
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      const braces = /^\{(.+)\}$/.exec(seg);
      return braces ? `:${braces[1]}` : seg;
    });
}

const cleanParamName = (raw: string): string => raw.replace(/[{}/]/g, '_') || 'param';

/** `/users/:id` => `/users/{id}`. */
export function toOpenApiPath(path: string): string {
  const segs = pathSegments(path).map((s) => (s.startsWith(':') ? `{${cleanParamName(s.slice(1))}}` : s));
  return `/${segs.join('/')}`;
}

/** `/users/:id` => `/users/:id` normalizada (barra inicial, `{id}` convertido). */
export function toExpressPath(path: string): string {
  return `/${pathSegments(path).join('/')}`;
}

export function pathParamNames(path: string): string[] {
  const names: string[] = [];
  for (const seg of pathSegments(path)) {
    if (!seg.startsWith(':')) continue;
    const name = cleanParamName(seg.slice(1));
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Esquema JSON inferido de un valor de ejemplo. */
export function inferSchema(value: unknown, depth = 0): Json {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH || value.length === 0) return { type: 'array', items: {} };
    return { type: 'array', items: inferSchema(value[0], depth + 1) };
  }
  switch (typeof value) {
    case 'string':
      return { type: 'string' };
    case 'boolean':
      return { type: 'boolean' };
    case 'number':
      return { type: Number.isInteger(value) ? 'integer' : 'number' };
    case 'object': {
      if (depth >= MAX_DEPTH) return { type: 'object' };
      const props = Object.fromEntries(
        Object.entries(value as Json).map(([k, v]) => [k, inferSchema(v, depth + 1)])
      );
      return { type: 'object', properties: props };
    }
    default:
      return {};
  }
}

/** Heuristica: el valor guardado en `requestSchema` es un esquema JSON (no un cuerpo de ejemplo). */
export function looksLikeSchema(value: unknown): value is Json {
  if (!isPlainObject(value)) return false;
  const { type, properties, items } = value;
  const typeOk =
    typeof type === 'string'
      ? SCHEMA_TYPES.has(type)
      : Array.isArray(type) && type.length > 0 && type.every((t) => typeof t === 'string' && SCHEMA_TYPES.has(t));
  if (!typeOk) return false;
  if (properties !== undefined && !isPlainObject(properties)) return false;
  if (items !== undefined && !isPlainObject(items)) return false;
  return true;
}

/** Copia un esquema sin referencias ni identificadores (`$ref`, `$id`...): un `$ref` suelto invalida el documento. */
export function cleanSchema(schema: unknown, depth = 0): unknown {
  if (Array.isArray(schema)) return schema.map((s) => cleanSchema(s, depth + 1));
  if (!isPlainObject(schema) || depth > 20) return schema;
  const out: Json = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k.startsWith('$')) continue;
    out[k] = cleanSchema(v, depth + 1);
  }
  return out;
}

/** Ejemplo de cuerpo a partir de un esquema (usa `example`, `default`, `enum` o un valor por tipo). */
export function exampleFromSchema(schema: unknown, depth = 0): unknown {
  if (!isPlainObject(schema) || depth > MAX_DEPTH) return {};
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  switch (type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    case 'array':
      return [exampleFromSchema(schema.items, depth + 1)];
    default: {
      const props = isPlainObject(schema.properties) ? schema.properties : {};
      return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, exampleFromSchema(v, depth + 1)]));
    }
  }
}

/** Cuerpo de peticion de un endpoint (para OpenAPI y Postman), o null si no hay. */
export function requestBodyOf(endpoint: ExportEndpoint): { schema: unknown; example: unknown } | null {
  const raw = endpoint.requestSchema;
  if (!isPlainObject(raw) || Object.keys(raw).length === 0) return null;
  if (looksLikeSchema(raw)) {
    const schema = cleanSchema(raw);
    return { schema, example: exampleFromSchema(schema) };
  }
  // No es un esquema: se trata como cuerpo de ejemplo.
  return { schema: inferSchema(raw), example: raw };
}

const slugPart = (s: string): string => s.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');

/** Estados validos como clave de respuesta OpenAPI. */
const validStatus = (n: number): boolean => Number.isInteger(n) && n >= 100 && n <= 599;

const exampleKey = (resp: ExportResponse, index: number, used: Set<string>): string => {
  const base = (resp.name ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || `example_${index + 1}`;
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
  used.add(key);
  return key;
};

function buildResponses(endpoint: ExportEndpoint): Json {
  const byStatus = new Map<number, ExportResponse[]>();
  for (const resp of endpoint.responses) {
    if (!validStatus(resp.statusCode)) continue;
    byStatus.set(resp.statusCode, [...(byStatus.get(resp.statusCode) ?? []), resp]);
  }
  // Sin respuestas guardadas el motor mock contesta 200 con {}.
  if (byStatus.size === 0) byStatus.set(200, [{ statusCode: 200, body: {} }]);

  const out: Json = {};
  for (const [status, list] of byStatus) {
    const first = list[0];
    const response: Json = { description: first.description?.trim() || first.name?.trim() || `HTTP ${status}` };
    if (!NO_BODY_STATUSES.has(status)) {
      const used = new Set<string>();
      response.content = {
        'application/json': {
          schema: inferSchema(first.body),
          examples: Object.fromEntries(
            list.map((resp, i) => [exampleKey(resp, i, used), { ...(resp.name ? { summary: resp.name } : {}), value: resp.body }])
          ),
        },
      };
    }
    out[String(status)] = response;
  }
  return out;
}

/** Documento OpenAPI 3.1.0 del proyecto. `serverUrl` es la URL publica del mock (sin la API key). */
export function buildOpenApiDocument(project: ExportProject, serverUrl: string): Json {
  const paths: Record<string, Json> = {};
  const usedOperationIds = new Set<string>();

  for (const endpoint of project.endpoints) {
    const template = toOpenApiPath(endpoint.path);
    const method = endpoint.method.toLowerCase();
    paths[template] ??= {};
    if (paths[template][method]) continue; // el mismo metodo+ruta dos veces: OpenAPI solo admite una operacion

    let operationId = `${method}${slugPart(template) || 'Root'}`;
    for (let n = 2; usedOperationIds.has(operationId); n++) operationId = `${method}${slugPart(template) || 'Root'}${n}`;
    usedOperationIds.add(operationId);

    const operation: Json = { operationId };
    if (endpoint.description?.trim()) operation.summary = endpoint.description.trim();

    const names = pathParamNames(endpoint.path);
    if (names.length > 0) {
      operation.parameters = names.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
    }

    const body = requestBodyOf(endpoint);
    if (body) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: body.schema, example: body.example } },
      };
    }
    operation.responses = buildResponses(endpoint);
    paths[template][method] = operation;
  }

  const info: Json = { title: project.title || project.slug || 'Mockia API', version: project.apiVersion || '1.0.0' };
  if (project.description?.trim()) info.description = project.description.trim();

  const doc: Json = {
    openapi: '3.1.0',
    info,
    servers: [{ url: serverUrl, description: 'Mockia mock server' }],
    paths,
  };
  if (project.hasApiKey) {
    doc.components = {
      securitySchemes: { MockiaApiKey: { type: 'apiKey', in: 'header', name: 'X-Mockia-API-Key' } },
    };
    doc.security = [{ MockiaApiKey: [] }];
  }
  return doc;
}
