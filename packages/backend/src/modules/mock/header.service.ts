/**
 * Header utilities for Mock Router responses
 * - Ensures JSON content type, permissive CORS headers for mocks,
 *   and injects a unique Mockia request ID per response.
 */

import { Response } from 'express';

/**
 * Apply standard headers to a Mock Router response.
 * Modifies the response in-place.
 */
export function applyMockHeaders(res: Response): void {
  // Ensure JSON content type if not already set
  const currentContentType = res.getHeader('Content-Type');
  if (!currentContentType) {
    res.setHeader('Content-Type', 'application/json');
  }

  // Basic CORS header for mocks (open origin)
  const currentOrigin = res.getHeader('Access-Control-Allow-Origin');
  if (!currentOrigin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  // Prevent browser and proxy caching to ensure live simulation (e.g. delays) works consistently
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Inject an identifiable request ID for tracing
  const requestId = generateRequestId();
  res.setHeader('X-Mockia-Request-ID', requestId);
}

/**
 * Lightweight UUID v4 generator fallback.
 * Tries to use crypto.randomUUID if available; otherwise falls back to a hex-based generator.
 */
function generateRequestId(): string {
  // Try to use crypto.randomUUID if available (modern Node.js)
  try {
    const cryptoObj: any = (globalThis as any).crypto || undefined;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
      return cryptoObj.randomUUID();
    }
  } catch {
    // ignore and fallback
  }

  // Fallback: RFC4122-like pseudo UUID
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `mock-${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}
