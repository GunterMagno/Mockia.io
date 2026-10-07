import type { Response } from 'supertest';

/** Name of the HttpOnly cookie that carries the refresh token. */
export const RT_COOKIE = 'mockia_rt';

/** Header the SPA sends on the cookie-based endpoints (refresh / logout): the CSRF defence. */
export const CSRF_HEADERS = { 'X-Requested-With': 'mockia' } as const;

/** Every Set-Cookie line of a response. */
function setCookieLines(res: Response): string[] {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

/** Raw Set-Cookie line of the refresh cookie, or undefined when the response does not touch it. */
export function refreshSetCookie(res: Response): string | undefined {
  return setCookieLines(res).find((line) => line.startsWith(`${RT_COOKIE}=`));
}

/** Refresh token carried by a response's Set-Cookie ('' when the cookie is being cleared), undefined if untouched. */
export function refreshTokenOf(res: Response): string | undefined {
  const line = refreshSetCookie(res);
  return line === undefined ? undefined : line.split(';')[0].slice(RT_COOKIE.length + 1);
}

/** Attributes of a Set-Cookie line, names lower-cased (`httponly: true`, `path: '/api/auth'`, `max-age: '604800'`). */
export function cookieAttributes(line: string): Record<string, string | true> {
  const attrs: Record<string, string | true> = {};
  for (const part of line.split(';').slice(1)) {
    const [name, ...value] = part.trim().split('=');
    attrs[name.toLowerCase()] = value.length > 0 ? value.join('=') : true;
  }
  return attrs;
}
