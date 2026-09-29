/**
 * Helpers puros del comportamiento del motor mock: latencia, jitter, status y headers custom.
 * Todo valor viene de la BD (editable por el usuario), asi que se acota antes de usarlo.
 */

import type { Response } from 'express';

export const MAX_DELAY_MS = 30_000;

/** Headers que un mock nunca puede fijar: cookies arbitrarias, hop-by-hop, framing y CORS/seguridad del propio servidor. */
const FORBIDDEN_HEADERS = new Set([
  'set-cookie', 'set-cookie2', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length', 'content-encoding',
  'host', 'access-control-allow-origin', 'access-control-allow-credentials', 'strict-transport-security',
  'content-security-policy', 'x-mockia-request-id',
]);

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const MAX_CUSTOM_HEADERS = 20;

/** Entero en [0, MAX_DELAY_MS]; NaN/negativo/no numerico => 0. */
export function clampDelay(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), MAX_DELAY_MS);
}

/** Latencia final: base + aleatorio uniforme en [-jitter, +jitter], acotada a [0, MAX_DELAY_MS]. */
export function computeDelay(delayMs: unknown, jitterMs: unknown, rand: () => number = Math.random): number {
  const base = clampDelay(delayMs);
  const jitter = clampDelay(jitterMs);
  if (jitter === 0) return base;
  return clampDelay(base + Math.round((rand() * 2 - 1) * jitter));
}

/** Status HTTP valido para res.status(): entero 200-599, si no el fallback. */
export function clampStatus(value: unknown, fallback = 200): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 200 && n <= 599 ? n : fallback;
}

/** Devuelve solo headers seguros: nombre/valor validos, sin CR/LF, sin lista negra, maximo 20. */
export function sanitizeHeaders(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return out;
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_CUSTOM_HEADERS) break;
    const name = k.trim();
    if (!HEADER_NAME.test(name) || FORBIDDEN_HEADERS.has(name.toLowerCase())) continue;
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const value = String(v);
    if (/[\r\n\0]/.test(value) || value.length > 1024) continue;
    out[name] = value;
  }
  return out;
}

export function applyCustomHeaders(res: Response, headers: unknown): void {
  for (const [k, v] of Object.entries(sanitizeHeaders(headers))) res.setHeader(k, v);
}

/** Espera `computeDelay(...)` menos lo ya transcurrido desde startTime. */
export async function waitDelay(startTime: number, delayMs: unknown, jitterMs: unknown): Promise<void> {
  const remaining = computeDelay(delayMs, jitterMs) - (Date.now() - startTime);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}
