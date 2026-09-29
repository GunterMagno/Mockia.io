import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies a Stripe `Stripe-Signature` header (scheme v1) without the Stripe SDK.
 *
 * Header: `t=<unix seconds>,v1=<hex hmac>[,v1=<hex hmac>...]`
 * Signed payload: `${t}.${rawBody}` with HMAC-SHA256 keyed by the webhook secret.
 * The body MUST be the raw bytes as received; a re-serialized JSON body never matches.
 *
 * @param toleranceSec max clock skew / replay window (Stripe default: 300s)
 */
export function verifyStripeSignature(
  rawBody: Buffer | string,
  header: string | undefined,
  secret: string,
  toleranceSec = 300,
  nowMs = Date.now()
): boolean {
  if (!header || !secret) return false;

  let timestamp: string | undefined;
  const candidates: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') candidates.push(value);
  }
  if (!timestamp || !/^\d+$/.test(timestamp) || candidates.length === 0) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > toleranceSec) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  return candidates.some((sig) => {
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
