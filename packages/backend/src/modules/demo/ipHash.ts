import crypto from 'crypto';
import net from 'net';
import { demoKey } from './config.js';

/**
 * The visitor's IP is personal data. The demo never stores it: it stores HMAC-SHA256(key, utcDate | address) where
 * the date is part of the input, so the same visitor has a different pseudonym every UTC day (no tracking across
 * days) and it cannot be reversed without the secret. IPv6 is reduced to its /64 first (a visitor controls the
 * whole interface id and could otherwise dodge every limit by rotating it); an IPv4-mapped IPv6 address is the IPv4.
 */

/** Eight 16-bit groups of an IPv6 address (handles "::" and a trailing dotted IPv4), or null if it is not valid. */
function ipv6Groups(address: string): number[] | null {
  const text0 = address.split('%')[0];
  if (!net.isIPv6(text0)) return null;
  let text = text0.toLowerCase();
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    text = text.replace(dotted[1], `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`);
  }
  const [head, tail] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail === undefined ? [] : tail ? tail.split(':') : [];
  const fill = tail === undefined ? 0 : 8 - left.length - right.length;
  const groups = [...left, ...Array(fill).fill('0'), ...right].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** Canonical form that the limits are keyed on: "v4:a.b.c.d", "v6:xxxx:xxxx:xxxx:xxxx" (the /64) or the raw text. */
export function normalizeIp(ip: string): string {
  const text = ip.trim();
  if (net.isIPv4(text)) return `v4:${text}`;
  const groups = ipv6Groups(text);
  if (!groups) return `raw:${text.toLowerCase()}`;
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) return `v4:${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  return `v6:${groups.slice(0, 4).map((g) => g.toString(16).padStart(4, '0')).join(':')}`;
}

export const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

export function pseudonymizeIp(ip: string, now: Date = new Date()): string {
  return crypto.createHmac('sha256', demoKey('demo-ip')).update(`${utcDay(now)}|${normalizeIp(ip)}`).digest('hex');
}
