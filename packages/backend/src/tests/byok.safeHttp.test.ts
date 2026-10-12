/**
 * K2 - outbound HTTP client hardened against SSRF (Review Focus 2).
 *
 * A "bring your own AI" credential carries a URL chosen by the user, so the server would otherwise connect to wherever
 * a user points it (the cloud metadata service, localhost, the internal network). These tests pin the policy:
 * which addresses and hosts are refused, that the check happens when the socket connects (DNS rebinding), that
 * redirects are never followed, that responses and time are bounded and that no error repeats what we sent.
 *
 * Network: no external host is ever contacted. A real HTTPS server on 127.0.0.1 with a throw-away self-signed
 * certificate (generated with openssl) plays the provider; the test-only `testDialOverride` option makes the client
 * connect there AFTER its normal policy accepted a (fake, public) address, so the full path runs without relaxing it.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import { inspect } from 'util';
import { Readable } from 'stream';
import { execFileSync } from 'child_process';
import type { AddressInfo } from 'net';
import {
  SafeHttpError,
  createSafeFetch,
  createSafeLookup,
  isForbiddenAddress,
  normalizeHost,
} from '../modules/byok/safeHttp.js';

/* ------------------------------------------------------------------------------------------------------------------
 * isForbiddenAddress
 * ---------------------------------------------------------------------------------------------------------------- */

describe('isForbiddenAddress', () => {
  const forbidden: Array<[string, string]> = [
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback (whole /8)'],
    ['10.0.0.1', 'RFC1918 10/8'],
    ['10.255.255.255', 'RFC1918 10/8 top'],
    ['172.16.0.1', 'RFC1918 172.16/12'],
    ['172.31.255.255', 'RFC1918 172.16/12 top'],
    ['192.168.1.1', 'RFC1918 192.168/16'],
    ['169.254.169.254', 'cloud metadata'],
    ['169.254.0.1', 'link-local'],
    ['100.64.0.1', 'CGNAT'],
    ['100.127.255.255', 'CGNAT top'],
    ['0.0.0.0', 'unspecified'],
    ['0.1.2.3', '0/8'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.255', 'multicast top'],
    ['240.0.0.1', 'reserved 240/4'],
    ['255.255.255.255', 'broadcast'],
    ['192.0.0.1', 'IETF protocol assignments'],
    ['192.0.2.1', 'documentation TEST-NET-1'],
    ['198.51.100.1', 'documentation TEST-NET-2'],
    ['203.0.113.1', 'documentation TEST-NET-3'],
    ['198.18.0.1', 'benchmarking'],
    ['::1', 'IPv6 loopback'],
    ['::', 'IPv6 unspecified'],
    ['fd00::1', 'ULA'],
    ['fc00::1', 'ULA fc00'],
    ['fe80::1', 'link-local'],
    ['febf::1', 'link-local top'],
    ['fec0::1', 'site-local (deprecated)'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'documentation'],
    ['::ffff:127.0.0.1', 'v4-mapped loopback (dotted)'],
    ['::ffff:7f00:1', 'v4-mapped loopback (hex)'],
    ['::FFFF:7F00:0001', 'v4-mapped loopback (upper case, padded)'],
    ['0:0:0:0:0:ffff:7f00:1', 'v4-mapped loopback (expanded)'],
    ['::ffff:10.0.0.1', 'v4-mapped private'],
    ['::ffff:169.254.169.254', 'v4-mapped metadata'],
    ['::ffff:0.0.0.0', 'v4-mapped unspecified'],
    ['64:ff9b::7f00:1', 'NAT64 of loopback (hex)'],
    ['64:ff9b::169.254.169.254', 'NAT64 of metadata (dotted)'],
    ['64:ff9b::a00:1', 'NAT64 of 10.0.0.1'],
    ['64:ff9b:1::1', 'local-use NAT64'],
    ['2002:7f00:1::1', '6to4 of loopback'],
    ['2002:a9fe:a9fe::1', '6to4 of metadata'],
    ['::127.0.0.1', 'IPv4-compatible loopback'],
    ['fe80::1%eth0', 'zone id'],
    ['not-an-ip', 'garbage fails closed'],
    ['', 'empty fails closed'],
    ['1.2.3', 'short dotted quad fails closed'],
    ['999.1.1.1', 'out-of-range octet fails closed'],
  ];

  it.each(forbidden)('refuses %s (%s)', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(true);
  });

  const allowed: Array<[string, string]> = [
    ['93.184.216.34', 'public'],
    ['8.8.8.8', 'public'],
    ['1.1.1.1', 'public'],
    ['172.15.255.255', 'just below 172.16/12'],
    ['172.32.0.1', 'just above 172.16/12'],
    ['100.63.255.255', 'just below CGNAT'],
    ['100.128.0.0', 'just above CGNAT'],
    ['169.253.1.1', 'just below link-local'],
    ['2606:4700:4700::1111', 'public IPv6'],
    ['2001:4860:4860::8888', 'public IPv6 (outside 2001::/23)'],
    ['::ffff:8.8.8.8', 'v4-mapped public'],
    ['64:ff9b::808:808', 'NAT64 of 8.8.8.8'],
  ];

  it.each(allowed)('accepts %s (%s)', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------------------------
 * normalizeHost
 * ---------------------------------------------------------------------------------------------------------------- */

describe('normalizeHost', () => {
  const accepted: Array<[string, string]> = [
    ['api.openai.com', 'api.openai.com'],
    ['API.OpenAI.com', 'api.openai.com'],
    ['api.openai.com.', 'api.openai.com'],
    ['api.openai.com:443', 'api.openai.com'],
    ['bücher.example', 'xn--bcher-kva.example'],
    ['openrouter.ai', 'openrouter.ai'],
    ['a-b.c-d.example.org', 'a-b.c-d.example.org'],
    ['xn--bcher-kva.example', 'xn--bcher-kva.example'],
  ];
  it.each(accepted)('accepts %s as %s', (raw, expected) => {
    expect(normalizeHost(raw)).toBe(expected);
  });

  const rejected: Array<[string, string]> = [
    ['user@api.example.com', 'userinfo'],
    ['user:pw@api.example.com', 'userinfo with password'],
    ['api.example.com@127.0.0.1', 'userinfo that hides the real host'],
    ['api.example.com:8443', 'port other than 443'],
    ['api.example.com:80', 'port 80'],
    ['api.example.com:abc', 'non numeric port'],
    ['api.example.com:', 'empty port'],
    ['127.0.0.1', 'IPv4 literal'],
    ['93.184.216.34', 'public IPv4 literal (hostnames only)'],
    ['2130706433', 'decimal IPv4'],
    ['0x7f000001', 'hex IPv4'],
    ['0x7f.0.0.1', 'dotted hex IPv4'],
    ['0177.0.0.1', 'octal IPv4'],
    ['127.1', 'short IPv4'],
    ['[::1]', 'bracketed IPv6'],
    ['[::ffff:127.0.0.1]', 'bracketed v4-mapped IPv6'],
    ['[fd00::1]', 'bracketed ULA'],
    ['::1', 'bare IPv6'],
    ['localhost', 'localhost'],
    ['localhost.', 'localhost with trailing dot'],
    ['LOCALHOST', 'localhost upper case'],
    ['foo.localhost', '*.localhost'],
    ['intranet', 'single label name'],
    ['printer.local', '.local'],
    ['db.internal', '.internal'],
    ['router.lan', '.lan'],
    ['', 'empty'],
    ['   ', 'blank'],
    ['exa mple.com', 'whitespace'],
    ['a..example.com', 'empty label'],
    ['-a.example.com', 'label starting with a hyphen'],
    ['a.example.com/path', 'path'],
    ['a.example.com?x=1', 'query'],
    ['a.example.com#frag', 'fragment'],
    ['a.example.com\\@127.0.0.1', 'backslash'],
    ['%31%32%37.0.0.1', 'percent encoded'],
    [`${'a'.repeat(64)}.example.com`, 'label longer than 63'],
  ];
  it.each(rejected)('rejects %j (%s)', (raw) => {
    expect(() => normalizeHost(raw)).toThrow(SafeHttpError);
  });

  it('does not echo the rejected input in the error', () => {
    try {
      normalizeHost('user:SENTINEL-PASSWORD@api.example.com');
      throw new Error('should have thrown');
    } catch (err) {
      expect(String(err)).not.toContain('SENTINEL-PASSWORD');
      expect(inspect(err)).not.toContain('SENTINEL-PASSWORD');
    }
  });
});

/* ------------------------------------------------------------------------------------------------------------------
 * createSafeLookup: the address check at connect time
 * ---------------------------------------------------------------------------------------------------------------- */

type Addr = { address: string; family: number };

function runLookup(
  lookup: ReturnType<typeof createSafeLookup>,
  host: string,
  options: Record<string, unknown>
): Promise<{ err: Error | null; result: unknown; family?: number }> {
  return new Promise((resolve) => {
    (lookup as any)(host, options, (err: Error | null, result: unknown, family?: number) =>
      resolve({ err, result, family })
    );
  });
}

describe('createSafeLookup (checked when the socket connects)', () => {
  const pub: Addr = { address: '93.184.216.34', family: 4 };
  const pub6: Addr = { address: '2606:4700:4700::1111', family: 6 };

  it('returns the addresses (all:true) when every one is public', async () => {
    const lookup = createSafeLookup(async () => [pub, pub6]);
    const { err, result } = await runLookup(lookup, 'api.example.com', { all: true });
    expect(err).toBeNull();
    expect(result).toEqual([pub, pub6]);
  });

  it('returns a single address in the classic (address, family) shape when all is not asked', async () => {
    const lookup = createSafeLookup(async () => [pub]);
    const { err, result, family } = await runLookup(lookup, 'api.example.com', {});
    expect(err).toBeNull();
    expect(result).toBe(pub.address);
    expect(family).toBe(4);
  });

  it('honours a requested family', async () => {
    const lookup = createSafeLookup(async () => [pub, pub6]);
    const { result, family } = await runLookup(lookup, 'api.example.com', { family: 6 });
    expect(result).toBe(pub6.address);
    expect(family).toBe(6);
  });

  it('refuses the whole lookup when ANY of the addresses is forbidden (not only the first)', async () => {
    const lookup = createSafeLookup(async () => [pub, { address: '127.0.0.1', family: 4 }]);
    const { err, result } = await runLookup(lookup, 'api.example.com', { all: true });
    expect(err).toBeInstanceOf(SafeHttpError);
    expect((err as SafeHttpError).reason).toBe('forbidden_address');
    expect(result).toBeUndefined();
  });

  it('refuses a v4-mapped loopback returned by the resolver', async () => {
    const lookup = createSafeLookup(async () => [{ address: '::ffff:127.0.0.1', family: 6 }]);
    const { err } = await runLookup(lookup, 'api.example.com', { all: true });
    expect((err as SafeHttpError).reason).toBe('forbidden_address');
  });

  it('refuses an empty answer', async () => {
    const lookup = createSafeLookup(async () => []);
    const { err } = await runLookup(lookup, 'api.example.com', { all: true });
    expect(err).toBeInstanceOf(SafeHttpError);
  });

  it('reports a resolver failure without leaking the host', async () => {
    const lookup = createSafeLookup(async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND secret-host.example.com'), {
        code: 'ENOTFOUND',
      });
    });
    const { err } = await runLookup(lookup, 'secret-host.example.com', { all: true });
    expect(err).toBeInstanceOf(SafeHttpError);
    expect((err as SafeHttpError).code).toBe('ENOTFOUND');
    expect(String(err)).not.toContain('secret-host');
  });

  it('DNS rebinding: validates every resolution on its own (public first, loopback the next time)', async () => {
    let calls = 0;
    const lookup = createSafeLookup(async () => {
      calls += 1;
      return calls === 1 ? [pub] : [{ address: '127.0.0.1', family: 4 }];
    });
    const first = await runLookup(lookup, 'rebind.example.com', { all: true });
    const second = await runLookup(lookup, 'rebind.example.com', { all: true });
    expect(first.err).toBeNull();
    expect(second.err).toBeInstanceOf(SafeHttpError);
    expect((second.err as SafeHttpError).reason).toBe('forbidden_address');
    expect(calls).toBe(2); // nothing is cached between connections
  });
});

/* ------------------------------------------------------------------------------------------------------------------
 * createSafeFetch: refusals that never reach the network
 * ---------------------------------------------------------------------------------------------------------------- */

const SENTINEL_KEY = 'sk-SENTINEL-9f3a1c77';
const SENTINEL_AUTH = `Bearer ${SENTINEL_KEY}`;
const SENTINEL_BODY = 'BODY-SENTINEL-77e2d0';

/** Nothing we sent (header names or values, body) may appear in an error: it can end up in logs. */
function assertNoLeak(err: unknown): void {
  const text = [
    String(err),
    (err as Error)?.message,
    (err as Error)?.stack,
    inspect(err, { depth: 6, showHidden: true }),
    JSON.stringify(err, Object.getOwnPropertyNames(err as object)),
  ].join('\n');
  expect(text).not.toContain(SENTINEL_KEY);
  expect(text).not.toContain(SENTINEL_BODY);
  expect(text.toLowerCase()).not.toContain('authorization');
  expect(text.toLowerCase()).not.toContain('bearer');
}

const SENT_INIT = {
  method: 'POST',
  headers: { Authorization: SENTINEL_AUTH, 'Content-Type': 'application/json' },
  body: JSON.stringify({ secret: SENTINEL_BODY }),
};

async function rejection(promise: Promise<unknown>): Promise<SafeHttpError> {
  try {
    await promise;
  } catch (err) {
    assertNoLeak(err);
    expect(err).toBeInstanceOf(SafeHttpError);
    return err as SafeHttpError;
  }
  throw new Error('expected the request to be rejected');
}

describe('createSafeFetch: refused before any connection', () => {
  const urls: Array<[string, string]> = [
    ['https://127.0.0.1/v1/chat/completions', 'loopback literal'],
    ['https://10.0.0.1/', 'private literal'],
    ['https://169.254.169.254/latest/meta-data/', 'metadata literal'],
    ['https://2130706433/', 'decimal IPv4 (URL parser canonicalises it)'],
    ['https://0x7f000001/', 'hex IPv4'],
    ['https://0177.0.0.1/', 'octal IPv4'],
    ['https://127.1/', 'short IPv4'],
    ['https://[::1]/', 'IPv6 loopback'],
    ['https://[::ffff:127.0.0.1]/', 'v4-mapped loopback'],
    ['https://[fd00::1]/', 'ULA'],
    ['https://93.184.216.34/', 'even a public literal (hostnames only)'],
    ['https://localhost/', 'localhost'],
    ['https://localhost./', 'localhost with trailing dot'],
    ['https://foo.localhost/', '*.localhost'],
    ['https://intranet/', 'single label'],
    ['https://user@api.example.com/', 'userinfo'],
    ['https://user:pass@api.example.com/', 'userinfo and password'],
    ['https://api.example.com@127.0.0.1/', 'userinfo that hides the real host'],
    ['https://api.example.com:8443/', 'port 8443'],
    ['https://api.example.com:80/', 'port 80'],
    ['http://api.example.com/', 'http:'],
    ['file:///etc/passwd', 'file:'],
    ['ftp://api.example.com/', 'ftp:'],
    ['gopher://api.example.com/', 'gopher:'],
    ['not a url', 'not a URL'],
    ['', 'empty'],
  ];

  it.each(urls)('%s -> rejected (%s) without resolving or connecting', async (url) => {
    const resolver = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const safeFetch = createSafeFetch({ lookup: resolver });
    await rejection(safeFetch(url, SENT_INIT));
    expect(resolver).not.toHaveBeenCalled();
  });

  it('accepts a URL object and rejects a forbidden one the same way', async () => {
    const safeFetch = createSafeFetch({ lookup: async () => [] });
    await rejection(safeFetch(new URL('https://127.0.0.1/'), SENT_INIT));
  });

  it('accepts a Request object and rejects a forbidden one the same way', async () => {
    const safeFetch = createSafeFetch({ lookup: async () => [] });
    await rejection(safeFetch(new Request('https://127.0.0.1/', SENT_INIT)));
  });

  it('a public host name whose DNS answer is a forbidden address -> rejected at connect time', async () => {
    const answers: Array<[string, Addr[]]> = [
      ['foo.localtest.me', [{ address: '127.0.0.1', family: 4 }]],
      ['meta.example.com', [{ address: '169.254.169.254', family: 4 }]],
      ['mapped.example.com', [{ address: '::ffff:127.0.0.1', family: 6 }]],
      ['ula.example.com', [{ address: 'fd00::1', family: 6 }]],
      [
        'mixed.example.com',
        [
          { address: '93.184.216.34', family: 4 },
          { address: '10.0.0.1', family: 4 },
        ],
      ],
    ];
    for (const [host, addrs] of answers) {
      const safeFetch = createSafeFetch({ lookup: async () => addrs });
      const err = await rejection(safeFetch(`https://${host}/v1/chat/completions`, SENT_INIT));
      expect(err.reason).toBe('forbidden_address');
    }
  });

  it('a DNS failure is an error that does not repeat the host or what we sent', async () => {
    const safeFetch = createSafeFetch({
      lookup: async () => {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND nope.example.com'), {
          code: 'ENOTFOUND',
        });
      },
    });
    const err = await rejection(safeFetch('https://nope.example.com/', SENT_INIT));
    expect(err.code).toBe('ENOTFOUND');
  });

  it('rejects a body type it cannot send safely', async () => {
    const safeFetch = createSafeFetch({
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    });
    const err = await rejection(
      safeFetch('https://api.example.com/', {
        method: 'POST',
        body: Readable.from(['x']) as any,
        headers: { Authorization: SENTINEL_AUTH },
      })
    );
    expect(err.reason).toBe('unsupported_body');
  });
});

describe('createSafeFetch: the test-only option cannot be switched on outside tests', () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it.each(['production', 'development', 'staging', ''])('throws when NODE_ENV=%j', (env) => {
    process.env.NODE_ENV = env;
    expect(() => createSafeFetch({ testDialOverride: { port: 1234, ca: 'irrelevant' } })).toThrow(
      SafeHttpError
    );
  });

  it('is only a constructor option: the module reads no environment variable but NODE_ENV and has no way to skip TLS verification', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'modules', 'byok', 'safeHttp.ts'),
      'utf8'
    );
    const envReads = source.match(/process\.env(\.\w+|\[[^\]]+\])/g) ?? [];
    expect(envReads.filter((r) => r !== 'process.env.NODE_ENV')).toEqual([]);
    expect(source).not.toMatch(/rejectUnauthorized\s*:\s*(false|!|0)/);
    expect(source).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/);
  });
});

/* ------------------------------------------------------------------------------------------------------------------
 * createSafeFetch against a real TLS server
 * ---------------------------------------------------------------------------------------------------------------- */

interface Seen {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface TlsFake {
  port: number;
  ca: string;
  seen: Seen[];
  setHandler(h: (req: Seen, res: import('http').ServerResponse) => void): void;
  close(): Promise<void>;
}

function makeCert(dir: string, name: string, san: string) {
  const key = path.join(dir, `${name}.key`);
  const crt = path.join(dir, `${name}.crt`);
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-keyout',
      key,
      '-out',
      crt,
      '-days',
      '2',
      '-subj',
      '/CN=safehttp-test-only',
      '-addext',
      `subjectAltName=${san}`,
    ],
    { stdio: 'pipe' }
  );
  return { key: fs.readFileSync(key, 'utf8'), cert: fs.readFileSync(crt, 'utf8') };
}

async function startTls(
  cert: { key: string; cert: string },
  initial: Parameters<TlsFake['setHandler']>[0]
): Promise<TlsFake> {
  let handler = initial;
  const seen: Seen[] = [];
  const sockets = new Set<import('stream').Duplex>();
  const server = https.createServer({ key: cert.key, cert: cert.cert }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const entry: Seen = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      seen.push(entry);
      handler(entry, res);
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: (server.address() as AddressInfo).port,
    ca: cert.cert,
    seen,
    setHandler: (h) => (handler = h),
    close: () =>
      new Promise<void>((r) => {
        sockets.forEach((s) => s.destroy());
        server.close(() => r());
      }),
  };
}

describe('createSafeFetch against a TLS server (test-only dial override)', () => {
  let dir: string;
  let tls: TlsFake;
  let otherCert: { key: string; cert: string };
  const PUBLIC: Addr = { address: '93.184.216.34', family: 4 };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockia-safehttp-'));
    const good = makeCert(dir, 'good', 'DNS:*.example.com,DNS:foo.localtest.me');
    otherCert = makeCert(dir, 'other', 'DNS:*.example.com');
    tls = await startTls(good, (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end('{"ok":true}');
    });
  });

  afterAll(async () => {
    await tls.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    tls.seen.length = 0;
    tls.setHandler((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end('{"ok":true}');
    });
  });

  const build = (opts: Parameters<typeof createSafeFetch>[0] = {}) =>
    createSafeFetch({
      lookup: async () => [PUBLIC],
      testDialOverride: { port: tls.port, ca: tls.ca },
      ...opts,
    });

  it('a public host that resolves to a public IP passes: the request, headers and body arrive intact', async () => {
    const response = await build()('https://api.example.com/v1/chat/completions?x=1', SENT_INIT);
    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('content-type')).toBe('application/json');

    expect(tls.seen).toHaveLength(1);
    const seen = tls.seen[0];
    expect(seen.method).toBe('POST');
    expect(seen.url).toBe('/v1/chat/completions?x=1');
    expect(seen.headers.authorization).toBe(SENTINEL_AUTH);
    expect(seen.headers['content-type']).toBe('application/json');
    expect(seen.headers.host).toBe('api.example.com');
    expect(JSON.parse(seen.body)).toEqual({ secret: SENTINEL_BODY });
  });

  it('works with the default method (GET), a URL object and an explicit :443', async () => {
    const response = await build()(new URL('https://api.example.com:443/models'));
    expect(response.status).toBe(200);
    expect(tls.seen[0].method).toBe('GET');
    expect(tls.seen[0].url).toBe('/models');
  });

  it('sends a Request object (method, headers and body)', async () => {
    const response = await build()(
      new Request('https://api.example.com/v1/x', {
        method: 'POST',
        headers: { Authorization: SENTINEL_AUTH },
        body: 'hello',
      })
    );
    expect(response.status).toBe(200);
    expect(tls.seen[0].method).toBe('POST');
    expect(tls.seen[0].headers.authorization).toBe(SENTINEL_AUTH);
    expect(tls.seen[0].body).toBe('hello');
  });

  it('returns 4xx/5xx answers as responses (the caller decides), with their body', async () => {
    tls.setHandler((_req, res) => {
      res.statusCode = 429;
      res.end('{"error":"slow down"}');
    });
    const response = await build()('https://api.example.com/', SENT_INIT);
    expect(response.status).toBe(429);
    expect(response.ok).toBe(false);
    expect(await response.text()).toBe('{"error":"slow down"}');
  });

  it('handles an answer with no body (204)', async () => {
    tls.setHandler((_req, res) => {
      res.statusCode = 204;
      res.end();
    });
    const response = await build()('https://api.example.com/', SENT_INIT);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('DNS rebinding end to end: first resolution public (served), the next one loopback (refused)', async () => {
    let calls = 0;
    const safeFetch = build({
      lookup: async () => {
        calls += 1;
        return calls === 1 ? [PUBLIC] : [{ address: '127.0.0.1', family: 4 }];
      },
    });
    expect((await safeFetch('https://rebind.example.com/', SENT_INIT)).status).toBe(200);
    const err = await rejection(safeFetch('https://rebind.example.com/', SENT_INIT));
    expect(err.reason).toBe('forbidden_address');
    expect(tls.seen).toHaveLength(1);
  });

  it('a host that resolves to loopback never reaches the server even though the server is on loopback', async () => {
    const err = await rejection(
      build({ lookup: async () => [{ address: '127.0.0.1', family: 4 }] })(
        'https://foo.localtest.me/',
        SENT_INIT
      )
    );
    expect(err.reason).toBe('forbidden_address');
    expect(tls.seen).toHaveLength(0);
  });

  it.each([301, 302, 303, 307, 308])(
    'a %i redirect to http://169.254.169.254/ is an error and is not followed',
    async (status) => {
      tls.setHandler((_req, res) => {
        res.statusCode = status;
        res.setHeader('Location', 'http://169.254.169.254/latest/meta-data/');
        res.end();
      });
      const err = await rejection(build()('https://api.example.com/', SENT_INIT));
      expect(err.reason).toBe('redirect_not_followed');
      expect(err.message).not.toContain('169.254');
      expect(tls.seen).toHaveLength(1); // only the original request ever left
    }
  );

  it('a redirect to another https host is not followed either', async () => {
    tls.setHandler((_req, res) => {
      res.statusCode = 302;
      res.setHeader('Location', 'https://other.example.com/');
      res.end();
    });
    const err = await rejection(build()('https://api.example.com/', SENT_INIT));
    expect(err.reason).toBe('redirect_not_followed');
    expect(tls.seen).toHaveLength(1);
  });

  it('a response larger than maxBytes (declared length) is cut with an error', async () => {
    tls.setHandler((_req, res) => {
      res.setHeader('Content-Length', '5000');
      res.end('x'.repeat(5000));
    });
    const err = await rejection(build({ maxBytes: 1024 })('https://api.example.com/', SENT_INIT));
    expect(err.reason).toBe('response_too_large');
  });

  it('a streamed response with no length that outgrows maxBytes is cut with an error', async () => {
    tls.setHandler((_req, res) => {
      res.write('x'.repeat(700));
      setTimeout(() => res.end('y'.repeat(700)), 20);
    });
    const err = await rejection(build({ maxBytes: 1024 })('https://api.example.com/', SENT_INIT));
    expect(err.reason).toBe('response_too_large');
  });

  it('a response of exactly maxBytes is allowed', async () => {
    tls.setHandler((_req, res) => {
      res.end('z'.repeat(1024));
    });
    const response = await build({ maxBytes: 1024 })('https://api.example.com/', SENT_INIT);
    expect((await response.text()).length).toBe(1024);
  });

  it('the default cap is 1 MiB', async () => {
    tls.setHandler((_req, res) => {
      res.end(Buffer.alloc(1024 * 1024 + 1, 0x61));
    });
    const err = await rejection(build()('https://api.example.com/', SENT_INIT));
    expect(err.reason).toBe('response_too_large');
  });

  it('a server that never answers hits the timeout', async () => {
    tls.setHandler(() => {
      /* never answers */
    });
    const started = Date.now();
    const err = await rejection(build({ timeoutMs: 250 })('https://api.example.com/', SENT_INIT));
    expect(err.reason).toBe('timeout');
    expect(err.code).toBe('ETIMEDOUT');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('a server that stalls while sending the body hits the timeout too', async () => {
    tls.setHandler((_req, res) => {
      res.write('partial');
      /* and never ends */
    });
    const err = await rejection(build({ timeoutMs: 250 })('https://api.example.com/', SENT_INIT));
    expect(err.reason).toBe('timeout');
  });

  it('honours the caller abort signal (the provider chain relies on it)', async () => {
    tls.setHandler(() => {
      /* never answers */
    });
    const controller = new AbortController();
    const pending = build()('https://api.example.com/', {
      ...SENT_INIT,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    try {
      await pending;
    } catch (err) {
      assertNoLeak(err);
    }
  });

  it('rejects at once when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      build()('https://api.example.com/', { ...SENT_INIT, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(tls.seen).toHaveLength(0);
  });

  it('rejects a compressed answer it would have to inflate without a bound', async () => {
    tls.setHandler((_req, res) => {
      res.setHeader('Content-Encoding', 'gzip');
      res.end('not really gzip');
    });
    const err = await rejection(build()('https://api.example.com/', SENT_INIT));
    expect(err.reason).toBe('unsupported_encoding');
  });

  it('asks for an uncompressed answer', async () => {
    await build()('https://api.example.com/', SENT_INIT);
    expect(tls.seen[0].headers['accept-encoding']).toBe('identity');
  });

  it('verifies the certificate chain: a server whose certificate is not trusted is refused', async () => {
    const err = await rejection(
      createSafeFetch({
        lookup: async () => [PUBLIC],
        testDialOverride: { port: tls.port, ca: otherCert.cert }, // trusts a different CA
      })('https://api.example.com/', SENT_INIT)
    );
    expect(err.reason).toBe('network_error');
    expect(tls.seen).toHaveLength(0); // the request was never sent
  });

  it('verifies the host name: a certificate for other names is refused', async () => {
    const err = await rejection(build()('https://not-in-the-san.example.org/', SENT_INIT));
    expect(err.reason).toBe('network_error');
    expect(tls.seen).toHaveLength(0);
  });

  it('refuses a connection that is closed on us without leaking what we sent', async () => {
    const dead = await startTls(
      { key: fs.readFileSync(path.join(dir, 'good.key'), 'utf8'), cert: tls.ca },
      () => undefined
    );
    const deadPort = dead.port;
    await dead.close();
    const err = await rejection(
      createSafeFetch({
        lookup: async () => [PUBLIC],
        testDialOverride: { port: deadPort, ca: tls.ca },
      })('https://api.example.com/', SENT_INIT)
    );
    expect(err.reason).toBe('network_error');
    expect(err.code).toBe('ECONNREFUSED');
  });

  it('no failure mode repeats the Authorization header or the body in its message', async () => {
    const failures: Array<() => Promise<unknown>> = [
      () => build()('https://127.0.0.1/', SENT_INIT),
      () => build()('http://api.example.com/', SENT_INIT),
      () =>
        build({ lookup: async () => [{ address: '10.0.0.1', family: 4 }] })(
          'https://x.example.com/',
          SENT_INIT
        ),
      () => {
        tls.setHandler((_q, res) => {
          res.statusCode = 302;
          res.setHeader('Location', 'https://evil.example.com/?k=' + SENTINEL_KEY);
          res.end();
        });
        return build()('https://api.example.com/', SENT_INIT);
      },
      () => {
        tls.setHandler((_q, res) => res.end('x'.repeat(4000)));
        return build({ maxBytes: 100 })('https://api.example.com/', SENT_INIT);
      },
      () => {
        tls.setHandler(() => undefined);
        return build({ timeoutMs: 100 })('https://api.example.com/', SENT_INIT);
      },
    ];
    for (const run of failures) {
      await rejection(run()); // rejection() runs assertNoLeak
    }
  });
});
