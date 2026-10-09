import http from 'http';
import type { AddressInfo } from 'net';
import { openRouterConfig, retryConfig } from '../config/ai.js';
import { getLlm, resetLlm } from '../modules/ai/providers/index.js';
import type { LlmRequest } from '../modules/ai/providers/types.js';
import { AppError } from '../middlewares/errorHandler.js';

/**
 * Review focus 5: a model that answers with junk (invalid JSON, wrong shape, cut by max_tokens) must not reach the
 * pipeline as a "success". The chain validates the text with the caller's validator, asks the SAME provider once for a
 * repair (with a content-free reason), and otherwise counts a failure and falls back. Real HTTP servers on 127.0.0.1
 * stand in for the local model and for OpenRouter.
 */

interface Seen {
  body: any;
}
type Handler = (req: Seen, res: http.ServerResponse) => void;
interface FakeServer {
  url: string;
  seen: Seen[];
  setHandler(h: Handler): void;
  close(): Promise<void>;
}

async function startFake(initial: Handler): Promise<FakeServer> {
  let handler = initial;
  const seen: Seen[] = [];
  const sockets = new Set<import('net').Socket>();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const entry: Seen = { body: raw ? JSON.parse(raw) : undefined };
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
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
    setHandler: (h) => (handler = h),
    close: () =>
      new Promise<void>((r) => {
        sockets.forEach((s) => s.destroy());
        server.close(() => r());
      }),
  };
}

const VALID = '{"ok":true}';
const JUNK = 'SECRET-JUNK-OUTPUT {"ok": tru';

const reply =
  (content: string, finishReason = 'stop'): Handler =>
  (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        model: 'served-model',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
      })
    );
  };
/** Answers each request with the next content of the list (the last one repeats). */
const sequence = (...contents: string[]): Handler => {
  let i = 0;
  return (req, res) => reply(contents[Math.min(i++, contents.length - 1)])(req, res);
};
const status =
  (code: number): Handler =>
  (_req, res) => {
    res.statusCode = code;
    res.end('{"error":{"message":"SECRET-UPSTREAM-BODY"}}');
  };
const hang: Handler = () => undefined;

/** Content-free validator, like the pipeline's: null when the text is usable. */
const validate = (text: string): string | null => {
  try {
    const parsed = JSON.parse(text);
    return parsed && parsed.ok === true ? null : 'the JSON does not match the required schema';
  } catch {
    return 'the output is not valid JSON';
  }
};

const MESSAGES = [
  { role: 'system' as const, content: 'SECRET-SYSTEM-PROMPT' },
  { role: 'user' as const, content: 'SECRET-REPO-CONTENT' },
];
const req = (extra: Partial<LlmRequest> = {}): LlmRequest => ({ messages: MESSAGES, validate, ...extra });

describe('AI chain: output validation, one repair retry and fallback', () => {
  const savedEnv = { ...process.env };
  const savedOr = { ...openRouterConfig };
  const savedRetries = retryConfig.maxRetries;
  let local: FakeServer;
  let remote: FakeServer;
  let logs: jest.SpyInstance[];

  const allLogs = () =>
    logs
      .flatMap((spy) => spy.mock.calls)
      .map((args) => args.map(String).join(' '))
      .join('\n');

  beforeEach(async () => {
    process.env = { ...savedEnv };
    local = await startFake(reply(VALID));
    remote = await startFake(reply(VALID));
    process.env.AI_PROVIDERS = 'local,openrouter';
    process.env.AI_LOCAL_BASE_URL = local.url;
    process.env.AI_LOCAL_TIMEOUT_MS = '2000';
    openRouterConfig.baseUrl = remote.url;
    openRouterConfig.apiKey = 'sk-or-test-key';
    openRouterConfig.model = 'or-model';
    retryConfig.maxRetries = 1;
    resetLlm();
    logs = (['warn', 'log', 'error', 'info'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
  });

  afterEach(async () => {
    logs.forEach((s) => s.mockRestore());
    await local.close();
    await remote.close();
    Object.assign(openRouterConfig, savedOr);
    retryConfig.maxRetries = savedRetries;
    process.env = savedEnv;
    resetLlm();
  });

  it('local answers junk, then a valid repair: the local answer is used (second try), OpenRouter untouched', async () => {
    local.setHandler(sequence(JUNK, VALID));
    const out = await getLlm().complete(req());
    expect(out).toMatchObject({ text: VALID, provider: 'local' });
    expect(local.seen).toHaveLength(2);
    expect(remote.seen).toHaveLength(0);
    // The repair request repeats the conversation plus ONE user message with the content-free reason
    const repair = local.seen[1].body.messages;
    expect(repair.slice(0, 2)).toEqual(MESSAGES);
    expect(repair).toHaveLength(3);
    expect(repair[2].role).toBe('user');
    expect(repair[2].content).toContain('the output is not valid JSON');
    expect(repair[2].content).not.toContain('SECRET-JUNK');
  });

  it('local answers junk twice: falls back to OpenRouter', async () => {
    local.setHandler(reply(JUNK));
    const out = await getLlm().complete(req());
    expect(out).toMatchObject({ text: VALID, provider: 'openrouter' });
    expect(local.seen).toHaveLength(2);
    expect(remote.seen).toHaveLength(1);
  });

  it('a truncated answer (finish_reason "length") is a failure: no repair, straight to the fallback', async () => {
    local.setHandler(reply('{"ok": tr', 'length'));
    const out = await getLlm().complete(req());
    expect(out.provider).toBe('openrouter');
    expect(local.seen).toHaveLength(1);
    expect(allLogs()).toContain('truncated');
  });

  it('a truncated answer is a failure even without a validator', async () => {
    local.setHandler(reply(VALID, 'length'));
    const out = await getLlm().complete({ messages: MESSAGES });
    expect(out.provider).toBe('openrouter');
  });

  it('the repair respects the overall deadline (504, the reserve is not tried after the budget)', async () => {
    process.env.AI_TOTAL_TIMEOUT_MS = '400';
    resetLlm();
    let calls = 0;
    local.setHandler((r, res) => (calls++ === 0 ? reply(JUNK)(r, res) : hang(r, res)));
    const started = Date.now();
    await expect(getLlm().complete(req())).rejects.toMatchObject({ statusCode: 504 });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(remote.seen).toHaveLength(0);
  });

  it('repeated junk opens the local breaker (junk is no longer counted as a success)', async () => {
    local.setHandler(reply(JUNK));
    for (let i = 0; i < 3; i++) expect((await getLlm().complete(req())).provider).toBe('openrouter');
    const before = local.seen.length;
    expect((await getLlm().complete(req())).provider).toBe('openrouter');
    expect(local.seen.length).toBe(before); // circuit open: local not called
  });

  it('no prompt, answer or upstream body ever reaches the logs', async () => {
    local.setHandler(reply(JUNK));
    remote.setHandler(sequence(JUNK, VALID));
    await getLlm().complete(req());
    const log = allLogs();
    for (const secret of ['SECRET-JUNK', 'SECRET-SYSTEM-PROMPT', 'SECRET-REPO-CONTENT', 'sk-or-test-key']) {
      expect(log).not.toContain(secret);
    }
    expect(log).toContain('invalid_output');
  });

  it('OpenRouter only (the default): invalid JSON gets ONE repair retry, then a 502 AppError', async () => {
    delete process.env.AI_PROVIDERS;
    resetLlm();
    remote.setHandler(reply(JUNK));
    const err = await getLlm()
      .complete(req())
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(502);
    expect(err.message).not.toContain('SECRET');
    expect(remote.seen).toHaveLength(2);
  });

  it('OpenRouter only: a valid repair is returned', async () => {
    delete process.env.AI_PROVIDERS;
    resetLlm();
    remote.setHandler(sequence(JUNK, VALID));
    expect((await getLlm().complete(req())).text).toBe(VALID);
  });

  // C2: a request-dependent rejection says nothing about the model server's health
  it.each([400, 413, 422])('an input-dependent HTTP %i still falls back but does not count toward the breaker', async (code) => {
    local.setHandler(status(code));
    for (let i = 0; i < 4; i++) expect((await getLlm().complete({ messages: MESSAGES })).provider).toBe('openrouter');
    expect(local.seen).toHaveLength(4); // never skipped
  });

  it('a 500 from local still counts (control): the 4th request skips it', async () => {
    local.setHandler(status(500));
    for (let i = 0; i < 4; i++) await getLlm().complete({ messages: MESSAGES });
    expect(local.seen).toHaveLength(3);
  });
});
