/**
 * Generador de snippets de código para consumir un endpoint mock.
 * Función pura: sin I/O, sin dependencias, apta para frontend y backend.
 */

export interface SnippetRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  /** Objeto/array/primitivo => se envía como JSON. string => se envía tal cual. */
  body?: unknown;
}

export interface CodeSnippets {
  curl: string;
  fetch: string;
  axios: string;
  python: string;
}

const NO_BODY_METHODS = new Set(['GET', 'HEAD']);

const normalizeMethod = (method: string): string => {
  const m = String(method ?? '').trim().toUpperCase();
  // Solo tokens alfabéticos: evita inyección de shell/código vía el verbo.
  return /^[A-Z]+$/.test(m) ? m : 'GET';
};

/** Quita CR/LF para que un header no pueda romper el snippet ni inyectar líneas. */
const cleanHeaders = (headers?: Record<string, string>): Array<[string, string]> =>
  Object.entries(headers ?? {})
    .filter(([k]) => k.trim() !== '')
    .map(([k, v]) => [k.replace(/[\r\n]/g, '').trim(), String(v ?? '').replace(/[\r\n]/g, '')] as [string, string]);

const hasContentType = (h: Array<[string, string]>) => h.some(([k]) => k.toLowerCase() === 'content-type');

/** Escapa para comillas simples de shell: ' => '\'' */
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** String literal JS/JSON (comillas dobles, escapes correctos). */
const js = (s: string): string => JSON.stringify(s);

/** Literal Python (True/False/None; strings con escapes JSON, válidos en Python). */
const py = (v: unknown, indent = 0): string => {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'None';
  if (typeof v === 'string') return JSON.stringify(v);
  const pad = '    '.repeat(indent + 1);
  const end = '    '.repeat(indent);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return `[\n${v.map((x) => pad + py(x, indent + 1)).join(',\n')},\n${end}]`;
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([k, x]) => `${pad}${JSON.stringify(k)}: ${py(x, indent + 1)}`).join(',\n')},\n${end}}`;
  }
  return 'None';
};

const indentBlock = (s: string, spaces: number) => s.replace(/\n/g, '\n' + ' '.repeat(spaces));

/**
 * Genera snippets cURL, Fetch, Axios y Python (requests) para una petición.
 * GET/HEAD nunca llevan cuerpo. Un cuerpo no-string añade Content-Type JSON si falta.
 */
export function generateSnippets(req: SnippetRequest): CodeSnippets {
  const method = normalizeMethod(req.method);
  const url = String(req.url ?? '');
  const headers = cleanHeaders(req.headers);

  const hasBody = req.body !== undefined && req.body !== null && !NO_BODY_METHODS.has(method);
  const bodyIsString = typeof req.body === 'string';
  if (hasBody && !bodyIsString && !hasContentType(headers)) headers.push(['Content-Type', 'application/json']);

  // Cuerpo serializado: string tal cual, resto JSON.
  const rawBody = hasBody ? (bodyIsString ? (req.body as string) : (JSON.stringify(req.body) ?? '')) : '';
  const prettyBody = hasBody && !bodyIsString ? (JSON.stringify(req.body, null, 2) ?? '') : '';

  // ---- cURL ----
  const curlParts: string[] = [`curl ${method === 'HEAD' ? '-I ' : method === 'GET' ? '' : `-X ${method} `}${shq(url)}`];
  headers.forEach(([k, v]) => curlParts.push(`-H ${shq(`${k}: ${v}`)}`));
  if (hasBody) curlParts.push(`-d ${shq(rawBody)}`);
  const curl = curlParts.join(' \\\n  ');

  // ---- Fetch ----
  const fetchOpts: string[] = [`  method: ${js(method)},`];
  if (headers.length) {
    fetchOpts.push(`  headers: {\n${headers.map(([k, v]) => `    ${js(k)}: ${js(v)},`).join('\n')}\n  },`);
  }
  if (hasBody) {
    fetchOpts.push(
      bodyIsString ? `  body: ${js(rawBody)},` : `  body: JSON.stringify(${indentBlock(prettyBody, 2)}),`
    );
  }
  const fetchSnippet =
    `const response = await fetch(${js(url)}, {\n${fetchOpts.join('\n')}\n});\n` +
    `const data = await response.json();\nconsole.log(data);`;

  // ---- Axios ----
  const axiosOpts: string[] = [`  method: ${js(method.toLowerCase())},`, `  url: ${js(url)},`];
  if (headers.length) {
    axiosOpts.push(`  headers: {\n${headers.map(([k, v]) => `    ${js(k)}: ${js(v)},`).join('\n')}\n  },`);
  }
  if (hasBody) {
    axiosOpts.push(bodyIsString ? `  data: ${js(rawBody)},` : `  data: ${indentBlock(prettyBody, 2)},`);
  }
  const axiosSnippet =
    `import axios from "axios";\n\nconst { data } = await axios({\n${axiosOpts.join('\n')}\n});\nconsole.log(data);`;

  // ---- Python (requests) ----
  const pyArgs: string[] = [`    ${js(method)},`, `    ${js(url)},`];
  if (headers.length) {
    pyArgs.push(`    headers={\n${headers.map(([k, v]) => `        ${js(k)}: ${js(v)},`).join('\n')}\n    },`);
  }
  if (hasBody) {
    pyArgs.push(bodyIsString ? `    data=${js(rawBody)},` : `    json=${py(req.body, 1)},`);
  }
  const python = `import requests\n\nresponse = requests.request(\n${pyArgs.join('\n')}\n)\nprint(response.status_code)\nprint(response.text)`;

  return { curl, fetch: fetchSnippet, axios: axiosSnippet, python };
}
