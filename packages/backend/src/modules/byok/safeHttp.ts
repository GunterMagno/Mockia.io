/**
 * Outbound HTTP client hardened against SSRF, for the "bring your own AI" feature.
 *
 * The URL of a user's AI provider is chosen by the user, so the server must never connect to wherever it points: the
 * cloud metadata service (169.254.169.254), localhost, the internal network. The policy lives in three pieces:
 *
 *  - isForbiddenAddress(ip):   which IP addresses are never acceptable (private, loopback, link-local, reserved...);
 *  - normalizeHost(raw):       which host NAMES are acceptable (hostnames only: no IP literal in any notation, no
 *                              userinfo, no port but 443, no localhost, no single-label names);
 *  - createSafeFetch(opts):    a `fetch` on top of node:https whose DNS lookup resolves the name and REFUSES any
 *                              forbidden address at the moment the socket connects, so a host that answers "public" to
 *                              a validation and "127.0.0.1" a second later (DNS rebinding) cannot get through, and every
 *                              address the socket may try has been checked, not only the first one.
 *
 * It also never follows redirects (a 3xx is an error), refuses anything but https, always verifies the TLS
 * certificate, bounds the response size and the total time, and its errors never carry request headers, the request body
 * or the URL (an API key travels in `Authorization`).
 */

import dns from 'node:dns';
import https from 'node:https';
import type { ClientRequest } from 'node:http';
import { domainToASCII } from 'node:url';

/* ------------------------------------------------------------------------------------------------------------------
 * Errors
 * ---------------------------------------------------------------------------------------------------------------- */

export type SafeHttpReason =
  | 'invalid_url'
  | 'forbidden_scheme'
  | 'forbidden_userinfo'
  | 'forbidden_port'
  | 'forbidden_host'
  | 'forbidden_address'
  | 'redirect_not_followed'
  | 'response_too_large'
  | 'unsupported_body'
  | 'unsupported_encoding'
  | 'timeout'
  | 'network_error'
  | 'test_option_forbidden';

/**
 * Every failure of this module. The message is built ONLY from the reason (and, for network failures, the Node error code
 * such as ECONNREFUSED): it never contains headers, the body, the URL or the host, because it can end up in logs.
 */
export class SafeHttpError extends Error {
  readonly reason: SafeHttpReason;
  /** Node/OS error code when there is one (ECONNREFUSED, ENOTFOUND, CERT_HAS_EXPIRED...); ETIMEDOUT for a timeout. */
  readonly code?: string;

  constructor(reason: SafeHttpReason, code?: string) {
    super(code ? `safe_http: ${reason} (${code})` : `safe_http: ${reason}`);
    this.name = 'SafeHttpError';
    this.reason = reason;
    if (code) this.code = code;
    Object.setPrototypeOf(this, SafeHttpError.prototype);
  }
}

const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Any error coming out of node:https/net/tls as a SafeHttpError that keeps only the (well formed) error code. */
function toSafeError(err: unknown): SafeHttpError {
  if (err instanceof SafeHttpError) return err;
  const code = (err as { code?: unknown } | null)?.code;
  return new SafeHttpError(
    'network_error',
    typeof code === 'string' && SAFE_CODE.test(code) ? code : undefined
  );
}

/* ------------------------------------------------------------------------------------------------------------------
 * IP addresses
 * ---------------------------------------------------------------------------------------------------------------- */

type Bytes4 = [number, number, number, number];

/** Strict dotted quad. Anything else (leading zeros = possible octal, short forms, out of range) is not an address. */
function parseIPv4(text: string): Bytes4 | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!m) return null;
  const out: number[] = [];
  for (let i = 1; i <= 4; i++) {
    const part = m[i];
    if (part.length > 1 && part.startsWith('0')) return null;
    const n = Number(part);
    if (n > 255) return null;
    out.push(n);
  }
  return out as Bytes4;
}

/** Eight 16 bit groups of an IPv6 address (zone id ignored, trailing dotted quad understood), or null. */
function parseIPv6(input: string): number[] | null {
  let text = input;
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (!/^[0-9a-fA-F:.]+$/.test(text) || !text.includes(':')) return null;

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    const pieces = part.split(':');
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      if (piece.includes('.')) {
        if (i !== pieces.length - 1) return null; // a dotted quad can only end the address
        const v4 = parseIPv4(piece);
        if (!v4) return null;
        groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
        groups.push(parseInt(piece, 16));
      }
    }
    return groups;
  };

  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null; // "::" must stand for at least one group
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function isForbiddenIPv4([a, b, c]: Bytes4): boolean {
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, includes the cloud metadata service
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast (deprecated)
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast 224/4, reserved 240/4 and the broadcast address
  return false;
}

function isForbiddenIPv6(g: number[]): boolean {
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  const embedded = (hi: number, lo: number): Bytes4 => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];

  // ::/96 (the unspecified address, ::1 and the deprecated IPv4-compatible form): nothing legitimate lives here
  if (zeros(0, 6)) return true;
  // ::ffff:a.b.c.d (IPv4-mapped) and ::ffff:0:a.b.c.d (IPv4-translated): judged by the IPv4 address inside
  if (zeros(0, 5) && g[5] === 0xffff) return isForbiddenIPv4(embedded(g[6], g[7]));
  if (zeros(0, 4) && g[4] === 0xffff && g[5] === 0) return isForbiddenIPv4(embedded(g[6], g[7]));
  // 64:ff9b::/96 (NAT64): judged by the IPv4 address inside; 64:ff9b:1::/48 is local-use
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (zeros(2, 6)) return isForbiddenIPv4(embedded(g[6], g[7]));
    return true;
  }
  // Only global unicast 2000::/3 is acceptable; everything else (fc00::/7 ULA, fe80::/10 link-local, fec0::/10,
  // ff00::/8 multicast, 100::/64 discard, 5f00::/16...) is not
  if ((g[0] & 0xe000) !== 0x2000) return true;
  if (g[0] === 0x2002) return isForbiddenIPv4(embedded(g[1], g[2])); // 6to4: judged by the IPv4 address inside
  if (g[0] === 0x2001 && g[1] < 0x0200) return true; // 2001::/23 IETF protocol assignments (Teredo, ORCHID...)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x3fff && g[1] < 0x1000) return true; // documentation 3fff::/20
  return false;
}

/**
 * True when connecting to this IP address is never acceptable: loopback, private (RFC1918), link-local (including the
 * metadata service 169.254.169.254), CGNAT, 0.0.0.0/8, multicast, reserved and documentation ranges, the broadcast
 * address, ULA fc00::/7, fe80::/10, ::1, ::, and the IPv4-mapped (::ffff:a.b.c.d), NAT64 (64:ff9b::/96) and 6to4 forms
 * of all of those. Anything that is not a well formed address is forbidden too (fail closed).
 */
export function isForbiddenAddress(ip: string): boolean {
  if (typeof ip !== 'string') return true;
  const v4 = parseIPv4(ip);
  if (v4) return isForbiddenIPv4(v4);
  const v6 = parseIPv6(ip);
  if (v6) return isForbiddenIPv6(v6);
  return true;
}

/* ------------------------------------------------------------------------------------------------------------------
 * Host names
 * ---------------------------------------------------------------------------------------------------------------- */

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
/** WHATWG "ends in a number": a last label made of digits or 0x... means the host is an IPv4 address in some notation. */
const NUMERIC_LABEL = /^(\d+|0x[0-9a-f]*)$/i;
/** Names that only make sense inside a private network (RFC 6761, RFC 6762, RFC 8375 and the usual conventions). */
const PRIVATE_SUFFIXES = ['localhost', 'local', 'localdomain', 'internal', 'lan', 'home.arpa'];

/** Whitespace and control characters, path/query/fragment delimiters, backslash, percent-encoding and brackets (IPv6). */
function hasForbiddenHostChar(host: string): boolean {
  for (const char of host) {
    const code = char.codePointAt(0) as number;
    if (code <= 0x20 || code === 0x7f || '/\\?#%[]'.includes(char)) return true;
  }
  return false;
}

function hostFail(reason: SafeHttpReason): never {
  throw new SafeHttpError(reason);
}

/**
 * Validates and normalises the host part of a URL (`host` or `host:443`): punycode (IDNA), lower case, no trailing dot.
 * Only HOST NAMES are accepted: IP literals in any notation (dotted, decimal, octal, hex, short, IPv6, v4-mapped), userinfo
 * (`user@host`), ports other than 443, `localhost` (and `*.localhost`, `*.local`, `*.internal`...) and names with a single
 * label are all rejected with a SafeHttpError. Names that look public but resolve to a private address are caught later,
 * when the socket connects.
 */
export function normalizeHost(raw: string): string {
  if (typeof raw !== 'string') return hostFail('forbidden_host');
  let host = raw.trim();
  if (host.includes('@')) return hostFail('forbidden_userinfo');
  if (host === '' || hasForbiddenHostChar(host)) return hostFail('forbidden_host');

  const colon = host.indexOf(':');
  if (colon !== -1) {
    if (host.indexOf(':', colon + 1) !== -1) return hostFail('forbidden_host'); // bare IPv6
    if (host.slice(colon + 1) !== '443') return hostFail('forbidden_port');
    host = host.slice(0, colon);
  }

  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host === '') return hostFail('forbidden_host');
  if (NUMERIC_LABEL.test(host.slice(host.lastIndexOf('.') + 1))) return hostFail('forbidden_host');

  const ascii = domainToASCII(host); // IDNA/punycode; lower case; '' when the name is invalid
  if (ascii === '' || ascii.length > 253) return hostFail('forbidden_host');
  const labels = ascii.split('.');
  if (labels.length < 2) return hostFail('forbidden_host'); // localhost, intranet, a bare label
  if (!labels.every((label) => LABEL.test(label))) return hostFail('forbidden_host');
  if (NUMERIC_LABEL.test(labels[labels.length - 1])) return hostFail('forbidden_host');
  if (PRIVATE_SUFFIXES.some((suffix) => ascii === suffix || ascii.endsWith(`.${suffix}`))) {
    return hostFail('forbidden_host');
  }
  return ascii;
}

/* ------------------------------------------------------------------------------------------------------------------
 * The DNS lookup that enforces the address policy when the socket connects
 * ---------------------------------------------------------------------------------------------------------------- */

export interface ResolvedAddress {
  address: string;
  family: number;
}

/** Resolves a host name to ALL its addresses. The default asks the system resolver. */
export type LookupFn = (hostname: string) => Promise<ResolvedAddress[]>;

const systemResolve: LookupFn = async (hostname) => {
  const found = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return found.map((entry) => ({ address: entry.address, family: entry.family }));
};

type NodeLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | ResolvedAddress[],
  family?: number
) => void;

/**
 * A `lookup` function for node:https/net. Each time the socket is about to connect it resolves the name and refuses the
 * connection if ANY of the addresses is forbidden; only addresses that passed are handed to the socket, so whichever one it
 * ends up trying (or falls back to) has been checked. Nothing is cached: every connection is a fresh resolution and a
 * fresh check, which is what defeats DNS rebinding.
 *
 * `dialTo` is for tests only (see SafeFetchOptions.testDialOverride): the policy runs on what the resolver returned and,
 * if it passes, the socket is pointed at this address instead.
 */
export function createSafeLookup(
  resolve: LookupFn = systemResolve,
  dialTo?: ResolvedAddress
): (hostname: string, options: unknown, callback?: NodeLookupCallback) => void {
  return (hostname, optionsOrCallback, maybeCallback) => {
    const callback = (
      typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
    ) as NodeLookupCallback;
    const options = (
      optionsOrCallback && typeof optionsOrCallback === 'object' ? optionsOrCallback : {}
    ) as { all?: boolean; family?: number | string };

    resolve(hostname).then(
      (addresses) => {
        let failure: SafeHttpError | null = null;
        let allowed: ResolvedAddress[] = [];
        if (!Array.isArray(addresses) || addresses.length === 0) {
          failure = new SafeHttpError('network_error', 'ENOTFOUND');
        } else if (addresses.some((entry) => isForbiddenAddress(entry.address))) {
          failure = new SafeHttpError('forbidden_address');
        } else {
          allowed = dialTo ? [dialTo] : addresses;
          const wanted = Number(options.family);
          if (wanted === 4 || wanted === 6) {
            allowed = allowed.filter((entry) => entry.family === wanted);
            if (allowed.length === 0) failure = new SafeHttpError('network_error', 'ENOTFOUND');
          }
        }
        if (failure) callback(failure);
        else if (options.all) callback(null, allowed);
        else callback(null, allowed[0].address, allowed[0].family);
      },
      (err: unknown) => callback(toSafeError(err))
    );
  };
}

/* ------------------------------------------------------------------------------------------------------------------
 * The fetch
 * ---------------------------------------------------------------------------------------------------------------- */

export const DEFAULT_MAX_BYTES = 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface SafeFetchOptions {
  /** Total time for the whole exchange (connect, TLS, request, response). Default 30 s. */
  timeoutMs?: number;
  /** Largest response body accepted, in bytes. Default 1 MiB. */
  maxBytes?: number;
  /** Name resolution (injectable for tests). Default: the system resolver, asked for every address. */
  lookup?: LookupFn;
  /**
   * TESTS ONLY. The address policy runs as usual on what `lookup` returns (so a fake public address must be returned);
   * if it passes, the socket is pointed at `host:port` instead (default host 127.0.0.1) and only `ca` is trusted, which
   * lets a local HTTPS server with a throw-away certificate stand in for a provider while certificate and host name
   * verification stay on. It is a constructor argument only (never read from the environment) and createSafeFetch throws
   * unless NODE_ENV is exactly "test".
   */
  testDialOverride?: { port: number; ca: string | Buffer; host?: string };
}

const HEADERS_MANAGED_HERE = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'accept-encoding',
  'upgrade',
  'expect',
]);
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function abortError(signal: AbortSignal): unknown {
  return (
    signal.reason ?? Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
  );
}

async function toBuffer(body: unknown): Promise<Buffer | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), 'utf8');
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof Blob !== 'undefined' && body instanceof Blob)
    return Buffer.from(await body.arrayBuffer());
  throw new SafeHttpError('unsupported_body');
}

/**
 * A `fetch` that only talks to public https hosts (see the header of this file). Non-2xx answers are returned as
 * responses for the caller to judge; everything the policy refuses, and every network failure, is a SafeHttpError.
 */
export function createSafeFetch(opts: SafeFetchOptions = {}): typeof fetch {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be > 0');
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new RangeError('maxBytes must be > 0');

  const override = opts.testDialOverride;
  if (override && process.env.NODE_ENV !== 'test') throw new SafeHttpError('test_option_forbidden');

  const lookup = createSafeLookup(
    opts.lookup ?? systemResolve,
    override ? { address: override.host ?? '127.0.0.1', family: 4 } : undefined
  );

  const safeFetch = async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    // 1. What is being asked: URL, method, headers, body, abort signal
    let rawUrl: string;
    let headersInit: ConstructorParameters<typeof Headers>[0] | undefined;
    let bodyInit: unknown;
    let signal: AbortSignal | null | undefined = init?.signal;

    if (typeof input === 'string') {
      rawUrl = input;
    } else if (input instanceof URL) {
      rawUrl = input.href;
    } else {
      const request = input as Request;
      rawUrl = request.url;
      headersInit = request.headers;
      signal = signal ?? request.signal;
      if (init?.body === undefined && request.method !== 'GET' && request.method !== 'HEAD') {
        bodyInit = Buffer.from(await request.arrayBuffer());
      }
    }
    const method = (
      init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
    )
      .toString()
      .toUpperCase();
    if (init?.headers !== undefined) headersInit = init.headers;
    if (init?.body !== undefined) bodyInit = init.body;

    // 2. The policy on the URL, before anything is resolved or connected
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new SafeHttpError('invalid_url');
    }
    if (url.protocol !== 'https:') throw new SafeHttpError('forbidden_scheme');
    if (url.username !== '' || url.password !== '') throw new SafeHttpError('forbidden_userinfo');
    if (url.port !== '') throw new SafeHttpError('forbidden_port'); // an explicit :443 is dropped by the URL parser
    const host = normalizeHost(url.hostname);

    const body = await toBuffer(bodyInit);
    const headers: Record<string, string> = {};
    new Headers(headersInit).forEach((value, name) => {
      if (!HEADERS_MANAGED_HERE.has(name.toLowerCase())) headers[name] = value;
    });
    headers.host = host;
    headers.connection = 'close';
    headers['accept-encoding'] = 'identity'; // we never inflate: an unbounded decompression would defeat maxBytes
    if (body) headers['content-length'] = String(body.length);
    if (
      bodyInit instanceof URLSearchParams &&
      !Object.keys(headers).some((n) => n.toLowerCase() === 'content-type')
    ) {
      headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    }

    if (signal?.aborted) throw abortError(signal);

    // 3. The exchange
    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      let onAbort: (() => void) | undefined;

      const timer: NodeJS.Timeout = setTimeout(
        () => finish({ error: new SafeHttpError('timeout', 'ETIMEDOUT') }),
        timeoutMs
      );

      const finish = (outcome: { ok: Response } | { error: unknown }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
        if ('ok' in outcome) resolve(outcome.ok);
        else {
          request?.destroy();
          reject(outcome.error);
        }
      };

      let request: ClientRequest | undefined;
      try {
        request = https.request(
          {
            host,
            port: override ? override.port : 443,
            method,
            path: `${url.pathname}${url.search}`,
            headers,
            lookup: lookup as never,
            servername: host,
            agent: false, // a fresh connection (and a fresh lookup) per request, never a pooled one
            rejectUnauthorized: true,
            ...(override ? { ca: override.ca } : {}),
          },
          (res) => {
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400) {
              res.destroy();
              return finish({ error: new SafeHttpError('redirect_not_followed') });
            }
            const encoding = String(res.headers['content-encoding'] ?? 'identity')
              .trim()
              .toLowerCase();
            if (encoding !== '' && encoding !== 'identity') {
              res.destroy();
              return finish({ error: new SafeHttpError('unsupported_encoding') });
            }
            const declared = Number(res.headers['content-length']);
            if (Number.isFinite(declared) && declared > maxBytes) {
              res.destroy();
              return finish({ error: new SafeHttpError('response_too_large') });
            }

            const chunks: Buffer[] = [];
            let received = 0;
            res.on('data', (chunk: Buffer) => {
              received += chunk.length;
              if (received > maxBytes) {
                res.destroy();
                return finish({ error: new SafeHttpError('response_too_large') });
              }
              chunks.push(chunk);
            });
            res.on('end', () => {
              const responseHeaders = new Headers();
              for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) {
                try {
                  responseHeaders.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
                } catch {
                  /* a header the Headers class refuses is not worth failing the request for */
                }
              }
              const payload =
                method === 'HEAD' || NULL_BODY_STATUS.has(status)
                  ? null
                  : new Uint8Array(Buffer.concat(chunks));
              try {
                finish({
                  ok: new Response(payload, {
                    status,
                    statusText: res.statusMessage ?? '',
                    headers: responseHeaders,
                  }),
                });
              } catch {
                finish({ error: new SafeHttpError('network_error') });
              }
            });
            res.on('error', (err) => finish({ error: toSafeError(err) }));
            res.on('close', () => {
              if (!res.complete) finish({ error: new SafeHttpError('network_error') });
            });
          }
        );
        request.on('error', (err) => finish({ error: toSafeError(err) }));
      } catch (err) {
        return finish({ error: toSafeError(err) });
      }

      if (signal) {
        onAbort = () => finish({ error: abortError(signal as AbortSignal) });
        signal.addEventListener('abort', onAbort, { once: true });
      }

      request.end(body);
    });
  };

  return safeFetch as typeof fetch;
}
