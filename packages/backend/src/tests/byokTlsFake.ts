/**
 * Test helper (BYOK): a real HTTPS server with a throw-away self-signed certificate that stands in for an AI provider.
 *
 * Use it together with the test-only `testDialOverride` option of createSafeFetch (K2): the client resolves the provider
 * host with a FAKE lookup that returns a public address (so the address policy runs untouched), and only then the socket
 * is pointed at this server, trusting only its certificate. The certificate is generated with openssl (Git for Windows and
 * ubuntu-latest both ship it) into a temporary directory that `close()` deletes. Nothing leaves the machine.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import type { AddressInfo } from 'net';
import type { IncomingHttpHeaders, ServerResponse } from 'http';
import { execFileSync } from 'child_process';

export interface SeenRequest {
  method?: string;
  url?: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export type FakeHandler = (req: SeenRequest, res: ServerResponse) => void;

export interface TlsFake {
  port: number;
  /** PEM of the certificate (the only CA the client must trust) */
  ca: string;
  seen: SeenRequest[];
  setHandler(handler: FakeHandler): void;
  close(): Promise<void>;
}

/** Starts the fake provider. `hosts` are the DNS names the certificate is valid for. */
export async function startTlsFake(hosts: string[], initial: FakeHandler): Promise<TlsFake> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockia-byok-tls-'));
  const keyFile = path.join(dir, 'fake.key');
  const crtFile = path.join(dir, 'fake.crt');
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
      keyFile,
      '-out',
      crtFile,
      '-days',
      '2',
      '-subj',
      '/CN=byok-test-only',
      '-addext',
      `subjectAltName=${hosts.map((h) => `DNS:${h}`).join(',')}`,
    ],
    { stdio: 'pipe' }
  );
  const key = fs.readFileSync(keyFile, 'utf8');
  const cert = fs.readFileSync(crtFile, 'utf8');

  let handler = initial;
  const seen: SeenRequest[] = [];
  const sockets = new Set<import('stream').Duplex>();
  const server = https.createServer({ key, cert }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const entry: SeenRequest = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      seen.push(entry);
      handler(entry, res);
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    port: (server.address() as AddressInfo).port,
    ca: cert,
    seen,
    setHandler: (h) => {
      handler = h;
    },
    close: () =>
      new Promise<void>((resolve) => {
        sockets.forEach((s) => s.destroy());
        server.close(() => {
          fs.rmSync(dir, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}

/** A TCP port nobody listens on (for "the provider is unreachable"). */
export async function closedPort(): Promise<number> {
  const net = await import('net');
  return new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}
