/**
 * Content-free description of an error, safe to log.
 *
 * Never pass an HTTP client error (axios) or a Mongoose error straight to console.*: AxiosError carries `config.data`
 * (the whole prompt, repository context included), the request headers (Authorization key) and the response body, and
 * parse/validation error messages quote the text they choked on. This keeps only the class, the HTTP status and the
 * low-level error code.
 */
export function describeError(err: unknown): string {
  if (err === null || typeof err !== 'object') return 'unknown';
  const e = err as { name?: unknown; code?: unknown; statusCode?: unknown; status?: unknown; response?: { status?: unknown } };
  const parts: string[] = [typeof e.name === 'string' && e.name ? e.name : 'Error'];
  const status = e.response?.status ?? e.statusCode ?? e.status;
  if (typeof status === 'number') parts.push(`status=${status}`);
  if (typeof e.code === 'string' || typeof e.code === 'number') parts.push(`code=${String(e.code)}`);
  return parts.join(' ');
}
