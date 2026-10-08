import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { AiRateWindowModel } from '../models/AiRateWindow.js';
import { openRouterConfig, parseAiProviders, getLocalAiConfig, getAiRatePerMinute } from '../config/ai.js';
import { assertProdConfig } from '../config/assertProdConfig.js';
import { getLlm, resetLlm, createFallbackLlm, classifyFailure } from '../modules/ai/providers/index.js';
import type { LlmProvider, LlmRequest } from '../modules/ai/providers/types.js';
import { consumeAiQuota } from '../modules/ai/aiRateLimit.js';
import { AppError } from '../middlewares/errorHandler.js';
import { ErrorCode } from '@mockia/shared';

/* ------------------------------------------------------------------------------------------------------------------
 * A real HTTP server on 127.0.0.1 stands in for Ollama/vLLM and for OpenRouter, so the whole client (axios, timeouts,
 * connection errors, headers, JSON body) is exercised and only the network peer is fake.
 * ---------------------------------------------------------------------------------------------------------------- */

interface Seen {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}
type Handler = (req: Seen, res: http.ServerResponse) => void;

interface FakeServer {
  url: string;
  port: number;
  seen: Seen[];
  setHandler(h: Handler): void;
  close(): Promise<void>;
}

const completion = (content: unknown, extra: Record<string, unknown> = {}) => ({
  id: 'cmpl-1',
  object: 'chat.completion',
  model: 'served-model',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  ...extra,
});

const answer =
  (content: unknown, extra: Record<string, unknown> = {}): Handler =>
  (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(completion(content, extra)));
  };

async function startFake(initial: Handler): Promise<FakeServer> {
  let handler = initial;
  const seen: Seen[] = [];
  const sockets = new Set<import('net').Socket>();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: any;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
      const entry: Seen = { method: req.method, url: req.url, headers: req.headers, body };
      seen.push(entry);
      handler(entry, res);
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    seen,
    setHandler: (h) => (handler = h),
    close: () =>
      new Promise<void>((r) => {
        sockets.forEach((s) => s.destroy());
        server.close(() => r());
      }),
  };
}

/** A port that nothing listens on: the connection is refused immediately. */
async function closedPortUrl(): Promise<string> {
  const s = await startFake(answer('x'));
  const url = s.url;
  await s.close();
  return url;
}

const hang: Handler = () => {
  /* never answers: the client has to give up on its own */
};

const MESSAGES = [
  { role: 'system' as const, content: 'SECRET-SYSTEM-PROMPT' },
  { role: 'user' as const, content: 'SECRET-REPO-CONTENT' },
];

const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };

describe('AI providers (local first, OpenRouter as reserve)', () => {
  const savedEnv = { ...process.env };
  const savedOr = { ...openRouterConfig };
  let local: FakeServer;
  let remote: FakeServer;
  let warn: jest.SpyInstance;

  beforeEach(async () => {
    process.env = { ...savedEnv };
    delete process.env.AI_LOCAL_API_KEY;
    local = await startFake(answer('from-local'));
    remote = await startFake(answer('from-openrouter'));
    process.env.AI_PROVIDERS = 'local,openrouter';
    process.env.AI_LOCAL_BASE_URL = local.url;
    process.env.AI_LOCAL_MODEL = 'qwen-test';
    process.env.AI_LOCAL_TIMEOUT_MS = '300';
    openRouterConfig.baseUrl = remote.url;
    openRouterConfig.apiKey = 'sk-or-test-key';
    openRouterConfig.model = 'or-model';
    resetLlm();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    warn.mockRestore();
    await local.close();
    await remote.close();
    Object.assign(openRouterConfig, savedOr);
    process.env = savedEnv;
    resetLlm();
  });

  const warned = () => warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n');

  describe('local provider', () => {
    it('answers first: POST {base}/v1/chat/completions, provider and model reported, OpenRouter untouched', async () => {
      const out = await getLlm().complete({ messages: MESSAGES });

      expect(out).toEqual({
        text: 'from-local',
        provider: 'local',
        model: 'served-model',
        usage: { inputTokens: 11, outputTokens: 7 },
      });
      expect(local.seen).toHaveLength(1);
      expect(local.seen[0].method).toBe('POST');
      expect(local.seen[0].url).toBe('/v1/chat/completions');
      expect(local.seen[0].body.model).toBe('qwen-test');
      expect(local.seen[0].body.messages).toEqual(MESSAGES);
      expect(remote.seen).toHaveLength(0);
    });

    it('a base URL that already ends in /v1 or a slash is tolerated', async () => {
      process.env.AI_LOCAL_BASE_URL = `${local.url}/v1/`;
      resetLlm();
      await getLlm().complete({ messages: MESSAGES });
      expect(local.seen[0].url).toBe('/v1/chat/completions');
    });

    it('sends no Authorization header unless AI_LOCAL_API_KEY is set', async () => {
      await getLlm().complete({ messages: MESSAGES });
      expect(local.seen[0].headers.authorization).toBeUndefined();

      process.env.AI_LOCAL_API_KEY = 'local-secret';
      resetLlm();
      await getLlm().complete({ messages: MESSAGES });
      expect(local.seen[1].headers.authorization).toBe('Bearer local-secret');
    });

    it('usage is optional (servers that do not report it)', async () => {
      local.setHandler((_r, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }));
      });
      const out = await getLlm().complete({ messages: MESSAGES });
      expect(out.text).toBe('hi');
      expect(out.usage).toBeUndefined();
      expect(out.model).toBe('qwen-test');
    });
  });

  describe('request shaping', () => {
    it('with jsonSchema the body carries a strict json_schema response_format and temperature 0.2', async () => {
      await getLlm().complete({ messages: MESSAGES, jsonSchema: SCHEMA });
      expect(local.seen[0].body.response_format).toEqual({
        type: 'json_schema',
        json_schema: { name: 'mockia_output', strict: true, schema: SCHEMA },
      });
      expect(local.seen[0].body.temperature).toBe(0.2);
    });

    it('without a schema: temperature 0.7, max_tokens 5000 and no response_format (today\'s defaults)', async () => {
      await getLlm().complete({ messages: MESSAGES });
      expect(local.seen[0].body.temperature).toBe(0.7);
      expect(local.seen[0].body.max_tokens).toBe(5000);
      expect(local.seen[0].body.response_format).toBeUndefined();
    });

    it('the caller keeps control of temperature and max tokens, also with a schema', async () => {
      await getLlm().complete({ messages: MESSAGES, jsonSchema: SCHEMA, temperature: 0.9, maxTokens: 123 });
      expect(local.seen[0].body.temperature).toBe(0.9);
      expect(local.seen[0].body.max_tokens).toBe(123);
      await getLlm().complete({ messages: MESSAGES, temperature: 0 });
      expect(local.seen[1].body.temperature).toBe(0);
    });

    it('json:true asks for a JSON object without a schema; a schema wins over it', async () => {
      await getLlm().complete({ messages: MESSAGES, json: true });
      expect(local.seen[0].body.response_format).toEqual({ type: 'json_object' });
      await getLlm().complete({ messages: MESSAGES, json: true, jsonSchema: SCHEMA });
      expect(local.seen[1].body.response_format.type).toBe('json_schema');
    });

    it('the OpenRouter provider (AI_PROVIDERS=openrouter) sends the same shaping through callOpenRouterWithRetry', async () => {
      process.env.AI_PROVIDERS = 'openrouter';
      resetLlm();
      const out = await getLlm().complete({ messages: MESSAGES, jsonSchema: SCHEMA });
      expect(out).toMatchObject({ text: 'from-openrouter', provider: 'openrouter', model: 'served-model' });
      expect(local.seen).toHaveLength(0);
      expect(remote.seen[0].url).toBe('/chat/completions');
      expect(remote.seen[0].headers.authorization).toBe('Bearer sk-or-test-key');
      expect(remote.seen[0].body.model).toBe('or-model');
      expect(remote.seen[0].body.temperature).toBe(0.2);
      expect(remote.seen[0].body.response_format.type).toBe('json_schema');
      expect(out.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
    });

    it('defaults to OpenRouter only when AI_PROVIDERS is unset or blank (nothing changes by default)', async () => {
      for (const value of [undefined, '', '   ']) {
        if (value === undefined) delete process.env.AI_PROVIDERS;
        else process.env.AI_PROVIDERS = value;
        resetLlm();
        const out = await getLlm().complete({ messages: MESSAGES });
        expect(out.provider).toBe('openrouter');
      }
      expect(local.seen).toHaveLength(0);
    });
  });

  describe('fallback to the next provider', () => {
    const cases: Array<[string, string, () => Promise<void> | void]> = [
      [
        'connection refused',
        'connection_refused',
        async () => {
          process.env.AI_LOCAL_BASE_URL = await closedPortUrl();
        },
      ],
      ['timeout', 'timeout', () => local.setHandler(hang)],
      [
        'HTTP 500',
        'http_500',
        () =>
          local.setHandler((_r, res) => {
            res.statusCode = 500;
            res.end('boom');
          }),
      ],
      [
        'HTTP 429',
        'http_429',
        () =>
          local.setHandler((_r, res) => {
            res.statusCode = 429;
            res.end('slow down');
          }),
      ],
      [
        'HTTP 400',
        'http_400',
        () =>
          local.setHandler((_r, res) => {
            res.statusCode = 400;
            res.end('model not found');
          }),
      ],
      ['an envelope that is not JSON', 'invalid_envelope', () => local.setHandler((_r, res) => res.end('<html>nope</html>'))],
      [
        'a JSON body that is not a chat completion',
        'invalid_envelope',
        () => local.setHandler((_r, res) => res.end(JSON.stringify({ hello: 'world' }))),
      ],
      ['empty content', 'empty_content', () => local.setHandler(answer(''))],
      ['null content', 'empty_content', () => local.setHandler(answer(null))],
    ];

    it.each(cases)('%s -> OpenRouter answers and the reason is logged without any content', async (_n, reason, arrange) => {
      await arrange();
      resetLlm();

      const out = await getLlm().complete({ messages: MESSAGES });

      expect(out.provider).toBe('openrouter');
      expect(out.text).toBe('from-openrouter');
      expect(remote.seen).toHaveLength(1);
      const log = warned();
      expect(log).toContain('local');
      expect(log).toContain(reason);
      expect(log).toContain('openrouter');
      for (const secret of ['SECRET-SYSTEM-PROMPT', 'SECRET-REPO-CONTENT', 'sk-or-test-key', 'boom', 'model not found', 'nope']) {
        expect(log).not.toContain(secret);
      }
    });

    it('when every provider fails the caller gets an AppError (no raw 500) and nothing is leaked', async () => {
      local.setHandler((_r, res) => {
        res.statusCode = 500;
        res.end('x');
      });
      remote.setHandler((_r, res) => {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: 'bad' } }));
      });
      await expect(getLlm().complete({ messages: MESSAGES })).rejects.toBeInstanceOf(AppError);
    });

    it('a non-AppError failure of the last provider is wrapped as a 503', async () => {
      process.env.AI_PROVIDERS = 'local';
      process.env.AI_LOCAL_BASE_URL = await closedPortUrl();
      resetLlm();
      await expect(getLlm().complete({ messages: MESSAGES })).rejects.toMatchObject({
        statusCode: 503,
        code: ErrorCode.EXTERNAL_SERVICE_ERROR,
      });
    });
  });

  describe('caller abort', () => {
    it('aborting while the local model answers rejects and does NOT fall back', async () => {
      local.setHandler(hang);
      process.env.AI_LOCAL_TIMEOUT_MS = '5000';
      resetLlm();
      const ac = new AbortController();
      const pending = getLlm().complete({ messages: MESSAGES, signal: ac.signal });
      const settled = pending.then(
        () => 'resolved',
        (e) => e
      );
      await new Promise((r) => setTimeout(r, 60));
      ac.abort();

      const err = await settled;
      expect(err).not.toBe('resolved');
      expect(remote.seen).toHaveLength(0);
    });

    it('an already aborted signal does not even call the first provider', async () => {
      const ac = new AbortController();
      ac.abort();
      await expect(getLlm().complete({ messages: MESSAGES, signal: ac.signal })).rejects.toBeDefined();
      expect(local.seen).toHaveLength(0);
      expect(remote.seen).toHaveLength(0);
    });

    it('aborting an OpenRouter request stops it and is not retried', async () => {
      process.env.AI_PROVIDERS = 'openrouter';
      resetLlm();
      remote.setHandler(hang);
      const ac = new AbortController();
      const settled = getLlm()
        .complete({ messages: MESSAGES, signal: ac.signal })
        .then(
          () => 'resolved',
          (e) => e
        );
      await new Promise((r) => setTimeout(r, 60));
      ac.abort();
      expect(await settled).not.toBe('resolved');
      expect(remote.seen).toHaveLength(1);
    });
  });

  describe('AI_PROVIDERS parsing', () => {
    it('parses the ordered list, case and spaces insensitive, without duplicates', () => {
      expect(parseAiProviders(' Local , openrouter,LOCAL ')).toEqual({ providers: ['local', 'openrouter'], ignored: [] });
      expect(parseAiProviders('openrouter,local').providers).toEqual(['openrouter', 'local']);
      expect(parseAiProviders(undefined)).toEqual({ providers: ['openrouter'], ignored: [] });
      expect(parseAiProviders('  ')).toEqual({ providers: ['openrouter'], ignored: [] });
    });

    it('unknown names are ignored and reported', () => {
      expect(parseAiProviders('gpt-magic,local')).toEqual({ providers: ['local'], ignored: ['gpt-magic'] });
    });

    it('unknown names are ignored with a warning and the rest still works', async () => {
      process.env.AI_PROVIDERS = 'gpt-magic,local';
      resetLlm();
      const out = await getLlm().complete({ messages: MESSAGES });
      expect(out.provider).toBe('local');
      expect(warned()).toContain('gpt-magic');
    });

    it('a list with no valid provider is an error', () => {
      process.env.AI_PROVIDERS = 'nope, also-nope';
      resetLlm();
      expect(() => getLlm()).toThrow(/AI_PROVIDERS/);
      process.env.AI_PROVIDERS = ' , ';
      resetLlm();
      expect(() => getLlm()).toThrow(/AI_PROVIDERS/);
    });

    it('local settings: defaults and overrides', () => {
      expect(getLocalAiConfig({})).toEqual({
        baseUrl: '',
        model: 'qwen2.5-coder:7b-instruct',
        timeoutMs: 120000,
        apiKey: undefined,
      });
      expect(
        getLocalAiConfig({ AI_LOCAL_BASE_URL: ' http://llm:11434/ ', AI_LOCAL_MODEL: 'm', AI_LOCAL_TIMEOUT_MS: '5000', AI_LOCAL_API_KEY: 'k' })
      ).toEqual({ baseUrl: 'http://llm:11434', model: 'm', timeoutMs: 5000, apiKey: 'k' });
      expect(getLocalAiConfig({ AI_LOCAL_TIMEOUT_MS: 'abc' }).timeoutMs).toBe(120000);
      expect(getLocalAiConfig({ AI_LOCAL_TIMEOUT_MS: '-5' }).timeoutMs).toBe(120000);
    });

    it('rate limit setting: default 20, positive integers only', () => {
      expect(getAiRatePerMinute({})).toBe(20);
      expect(getAiRatePerMinute({ AI_RATE_PER_MINUTE: '5' })).toBe(5);
      expect(getAiRatePerMinute({ AI_RATE_PER_MINUTE: '0' })).toBe(20);
      expect(getAiRatePerMinute({ AI_RATE_PER_MINUTE: 'x' })).toBe(20);
    });

    it('a local provider without AI_LOCAL_BASE_URL fails (and falls back) instead of calling a bogus URL', async () => {
      delete process.env.AI_LOCAL_BASE_URL;
      resetLlm();
      const out = await getLlm().complete({ messages: MESSAGES });
      expect(out.provider).toBe('openrouter');
      expect(warned()).toContain('local');
    });
  });

  describe('circuit breaker (injectable clock)', () => {
    const ok = (name: string): LlmProvider => ({
      name,
      complete: jest.fn(async () => ({ text: name, provider: name, model: 'm' })),
    });
    const failing = (name: string, err: unknown = new Error('down')): LlmProvider => ({
      name,
      complete: jest.fn(async () => {
        throw err;
      }),
    });
    const req: LlmRequest = { messages: MESSAGES };

    function build(primary: LlmProvider, reserve: LlmProvider) {
      let now = 1_000_000;
      const llm = createFallbackLlm(
        [
          { provider: primary, breaker: { failureThreshold: 3, cooldownMs: 60_000 } },
          { provider: reserve },
        ],
        { now: () => now }
      );
      return { llm, tick: (ms: number) => (now += ms) };
    }

    it('opens after 3 consecutive failures: the 4th request does not call the primary at all', async () => {
      const primary = failing('local');
      const reserve = ok('openrouter');
      const { llm } = build(primary, reserve);

      for (let i = 0; i < 3; i++) expect((await llm.complete(req)).provider).toBe('openrouter');
      expect(primary.complete).toHaveBeenCalledTimes(3);

      expect((await llm.complete(req)).provider).toBe('openrouter');
      expect(primary.complete).toHaveBeenCalledTimes(3);
      expect(reserve.complete).toHaveBeenCalledTimes(4);
      expect(warned()).toContain('circuit');
    });

    it('a success in between resets the count (failures must be consecutive)', async () => {
      let n = 0;
      const primary: LlmProvider = {
        name: 'local',
        complete: jest.fn(async () => {
          n++;
          if (n === 3) return { text: 'fine', provider: 'local', model: 'm' };
          throw new Error('down');
        }),
      };
      const { llm } = build(primary, ok('openrouter'));
      for (let i = 0; i < 6; i++) await llm.complete(req);
      // fail, fail, ok, fail, fail, fail(3rd consecutive): 6 calls reached the primary, none skipped yet
      expect(primary.complete).toHaveBeenCalledTimes(6);
      await llm.complete(req);
      expect(primary.complete).toHaveBeenCalledTimes(6);
    });

    it('half-opens after the cooldown with ONE trial; a failed trial re-opens, a successful one closes', async () => {
      let healthy = false;
      const primary: LlmProvider = {
        name: 'local',
        complete: jest.fn(async () => {
          if (!healthy) throw new Error('down');
          return { text: 'back', provider: 'local', model: 'm' };
        }),
      };
      const { llm, tick } = build(primary, ok('openrouter'));
      for (let i = 0; i < 3; i++) await llm.complete(req);
      const callsWhenOpen = (primary.complete as jest.Mock).mock.calls.length;

      tick(59_999); // still cooling down
      await llm.complete(req);
      expect(primary.complete).toHaveBeenCalledTimes(callsWhenOpen);

      tick(2); // cooldown over -> one trial, which fails and re-opens the circuit
      expect((await llm.complete(req)).provider).toBe('openrouter');
      expect(primary.complete).toHaveBeenCalledTimes(callsWhenOpen + 1);
      await llm.complete(req);
      expect(primary.complete).toHaveBeenCalledTimes(callsWhenOpen + 1);

      tick(60_001); // second trial succeeds -> closed again
      healthy = true;
      expect((await llm.complete(req)).provider).toBe('local');
      expect((await llm.complete(req)).provider).toBe('local');
      expect(primary.complete).toHaveBeenCalledTimes(callsWhenOpen + 3);
    });

    it('while the trial is in flight other requests skip the primary (no stampede on a slow model)', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let calls = 0;
      const primary: LlmProvider = {
        name: 'local',
        complete: jest.fn(async () => {
          calls++;
          if (calls <= 3) throw new Error('down');
          await gate;
          return { text: 'slow but alive', provider: 'local', model: 'm' };
        }),
      };
      const { llm, tick } = build(primary, ok('openrouter'));
      for (let i = 0; i < 3; i++) await llm.complete(req);
      tick(60_001);

      const trial = llm.complete(req);
      const others = await Promise.all([llm.complete(req), llm.complete(req)]);
      expect(others.map((o) => o.provider)).toEqual(['openrouter', 'openrouter']);
      expect(primary.complete).toHaveBeenCalledTimes(4);
      release();
      expect((await trial).provider).toBe('local');
    });

    it('only providers declared with a breaker are ever skipped (the reserve is always tried)', async () => {
      const reserve = failing('openrouter', new AppError('upstream', ErrorCode.EXTERNAL_SERVICE_ERROR, 503));
      const { llm } = build(failing('local'), reserve);
      for (let i = 0; i < 6; i++) await expect(llm.complete(req)).rejects.toBeInstanceOf(AppError);
      expect(reserve.complete).toHaveBeenCalledTimes(6);
    });

    it('with only a tripped local provider the error is a 503, not a hang or a 500', async () => {
      const local1 = failing('local');
      const llm = createFallbackLlm([{ provider: local1, breaker: { failureThreshold: 1, cooldownMs: 1000 } }], {
        now: () => 5,
      });
      await expect(llm.complete(req)).rejects.toMatchObject({ statusCode: 503 });
      await expect(llm.complete(req)).rejects.toMatchObject({ statusCode: 503 });
      expect(local1.complete).toHaveBeenCalledTimes(1);
    });

    it('a caller abort is not a provider failure: it neither falls back nor counts toward the breaker', async () => {
      const ac = new AbortController();
      const primary: LlmProvider = {
        name: 'local',
        complete: jest.fn(async () => {
          ac.abort();
          throw new Error('canceled');
        }),
      };
      const reserve = ok('openrouter');
      const { llm } = build(primary, reserve);
      await expect(llm.complete({ ...req, signal: ac.signal })).rejects.toThrow('canceled');
      expect(reserve.complete).not.toHaveBeenCalled();

      for (let i = 0; i < 2; i++) await llm.complete(req).catch(() => undefined);
      // 1 aborted call + 2 failures = still below the threshold of 3 consecutive failures
      expect(primary.complete).toHaveBeenCalledTimes(3);
      await llm.complete(req);
      expect(primary.complete).toHaveBeenCalledTimes(4);
    });

    it('through getLlm(): once local failed 3 times the next request makes no HTTP call to it', async () => {
      local.setHandler((_r, res) => {
        res.statusCode = 503;
        res.end('loading model');
      });
      for (let i = 0; i < 3; i++) await getLlm().complete({ messages: MESSAGES });
      expect(local.seen).toHaveLength(3);

      const out = await getLlm().complete({ messages: MESSAGES });
      expect(out.provider).toBe('openrouter');
      expect(local.seen).toHaveLength(3);
      expect(remote.seen).toHaveLength(4);
    });
  });

  describe('classifyFailure', () => {
    it('names the failure without including messages', () => {
      expect(classifyFailure(new AppError('secret text', ErrorCode.EXTERNAL_SERVICE_ERROR, 503))).toBe('http_503');
      expect(classifyFailure(Object.assign(new Error('x'), { code: 'ECONNABORTED' }))).toBe('timeout');
      expect(classifyFailure(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toBe('dns_error');
      expect(classifyFailure(new TypeError('whatever secret'))).toBe('TypeError');
      expect(classifyFailure('weird')).toBe('unknown');
    });
  });

  describe('per-user AI limiter (Mongo)', () => {
    beforeAll(async () => {
      await connectDB();
      await AiRateWindowModel.init();
    });
    beforeEach(async () => {
      await AiRateWindowModel.deleteMany({});
    });
    afterAll(async () => {
      await AiRateWindowModel.deleteMany({});
    });

    const u1 = new mongoose.Types.ObjectId().toString();
    const u2 = new mongoose.Types.ObjectId().toString();
    const T0 = Date.UTC(2026, 9, 8, 12, 0, 10, 0); // 10 s into a minute

    it('allows up to the limit then rejects with the seconds until the window ends', async () => {
      for (let i = 1; i <= 3; i++) {
        const r = await consumeAiQuota(u1, { limit: 3, now: () => T0 });
        expect(r).toMatchObject({ allowed: true, count: i, limit: 3 });
      }
      const denied = await consumeAiQuota(u1, { limit: 3, now: () => T0 });
      expect(denied.allowed).toBe(false);
      expect(denied.retryAfterSeconds).toBe(50);
    });

    it('two users never share a bucket', async () => {
      for (let i = 0; i < 3; i++) await consumeAiQuota(u1, { limit: 3, now: () => T0 });
      expect((await consumeAiQuota(u1, { limit: 3, now: () => T0 })).allowed).toBe(false);
      expect(await consumeAiQuota(u2, { limit: 3, now: () => T0 })).toMatchObject({ allowed: true, count: 1 });
    });

    it('window rollover: a new minute starts from zero', async () => {
      for (let i = 0; i < 4; i++) await consumeAiQuota(u1, { limit: 3, now: () => T0 });
      expect((await consumeAiQuota(u1, { limit: 3, now: () => T0 + 49_999 })).allowed).toBe(false);
      const next = await consumeAiQuota(u1, { limit: 3, now: () => T0 + 50_000 });
      expect(next).toMatchObject({ allowed: true, count: 1 });
    });

    it('concurrent calls are counted exactly (atomic upsert-$inc, no lost updates, no duplicate-key crash)', async () => {
      const results = await Promise.all(Array.from({ length: 25 }, () => consumeAiQuota(u1, { limit: 10, now: () => T0 })));
      expect(results.filter((r) => r.allowed)).toHaveLength(10);
      expect(results.filter((r) => !r.allowed)).toHaveLength(15);
      expect(new Set(results.map((r) => r.count)).size).toBe(25);
      const doc = await AiRateWindowModel.findOne({ userId: u1 }).lean();
      expect(doc?.count).toBe(25);
      expect(await AiRateWindowModel.countDocuments({ userId: u1 })).toBe(1);
    });

    it('state lives in Mongo (survives a process restart) and expires through a TTL index', async () => {
      await consumeAiQuota(u1, { limit: 3, now: () => T0 });
      const doc = await AiRateWindowModel.findOne({ userId: u1 }).lean();
      expect(doc?.expireAt.getTime()).toBeGreaterThan(T0);
      const indexes = await AiRateWindowModel.collection.indexes();
      expect(indexes.some((i) => i.key.expireAt === 1 && i.expireAfterSeconds === 0)).toBe(true);
      expect(indexes.some((i) => i.unique && i.key.userId === 1 && i.key.windowStart === 1)).toBe(true);
    });

    it('uses AI_RATE_PER_MINUTE when no explicit limit is given', async () => {
      process.env.AI_RATE_PER_MINUTE = '2';
      await consumeAiQuota(u1, { now: () => T0 });
      await consumeAiQuota(u1, { now: () => T0 });
      expect((await consumeAiQuota(u1, { now: () => T0 })).allowed).toBe(false);
    });
  });

  describe('through the HTTP routes (supertest): local down -> no 500 for the user', () => {
    const PASSWORD = 'providers-test-password-1';

    async function createUser(email: string) {
      const user = await UserModel.create({
        email,
        username: email.split('@')[0],
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        emailVerifiedAt: new Date(),
      });
      const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
      return {
        id: user._id,
        auth: { Authorization: `Bearer ${login.body.data.tokens.accessToken as string}` },
      };
    }

    let log: jest.SpyInstance;
    let errorLog: jest.SpyInstance;

    beforeAll(async () => {
      await connectDB();
      await AiRateWindowModel.init();
    });
    beforeEach(async () => {
      await UserModel.deleteMany({});
      await ProjectModel.deleteMany({});
      await AiRateWindowModel.deleteMany({});
      process.env.AI_LOCAL_BASE_URL = await closedPortUrl(); // Ollama is down
      resetLlm();
      log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
      log.mockRestore();
      errorLog.mockRestore();
    });
    afterAll(async () => {
      await UserModel.deleteMany({});
      await ProjectModel.deleteMany({});
      await AiRateWindowModel.deleteMany({});
      await disconnectDB();
    });

    it('generate-description: 200 with the OpenRouter text and the same response shape', async () => {
      const { auth } = await createUser('d1@example.com');
      const res = await request(app)
        .post('/api/ai/generate-description')
        .set(auth)
        .send({ prompt: 'be nice', userMessage: 'describe GET /users' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ generatedContent: 'from-openrouter' });
      expect(remote.seen[0].body.messages).toEqual([
        { role: 'system', content: 'be nice' },
        { role: 'user', content: 'describe GET /users' },
      ]);
      expect(remote.seen[0].body.temperature).toBe(0.7);
      expect(remote.seen[0].body.max_tokens).toBe(1000);
    });

    it('generate-mock-data: JSON object mode, parsed result, local answers when it is up', async () => {
      const { auth } = await createUser('d2@example.com');
      remote.setHandler(answer('{"id":1,"name":"Ada"}'));
      const down = await request(app).post('/api/ai/generate-mock-data').set(auth).send({ schema: { id: 'number' } });
      expect(down.status).toBe(200);
      expect(down.body.data.mockData).toEqual({ id: 1, name: 'Ada' });
      expect(remote.seen[0].body.response_format).toEqual({ type: 'json_object' });
      expect(remote.seen[0].body.temperature).toBe(0.8);

      process.env.AI_LOCAL_BASE_URL = local.url; // Ollama is back
      local.setHandler(answer('[{"id":2}]'));
      resetLlm();
      const up = await request(app).post('/api/ai/generate-mock-data').set(auth).send({ schema: { id: 'number' } });
      expect(up.status).toBe(200);
      expect(up.body.data.mockData).toEqual([{ id: 2 }]);
      expect(local.seen).toHaveLength(1);
    });

    it('generate-mock-api-spec: usage keeps its shape (promptTokens/completionTokens/totalTokens)', async () => {
      const { id, auth } = await createUser('d3@example.com');
      const project = await ProjectModel.create({ title: 'Gym', slug: 'gym-t12', ownerId: id, members: [{ userId: id, role: 'owner' }] });
      remote.setHandler(
        answer(JSON.stringify({ apiVersion: '1.0.0', title: 'Gym API', description: 'd', endpoints: [], dataModels: [] }))
      );
      const res = await request(app)
        .post('/api/ai/generate-mock-api-spec')
        .set(auth)
        .send({ projectId: project._id.toString(), requirement: 'members CRUD' });
      expect(res.status).toBe(200);
      expect(res.body.data.specification.title).toBe('Gym API');
      expect(res.body.data.usage).toEqual({ promptTokens: 11, completionTokens: 7, totalTokens: 18 });
      expect(remote.seen[0].body.response_format).toEqual({ type: 'json_object' });
    });

    it('the generation log names the provider but never the prompt or the answer', async () => {
      const { auth } = await createUser('d4@example.com');
      remote.setHandler(answer('PRIVATE-ANSWER-TEXT'));
      await request(app)
        .post('/api/ai/generate-description')
        .set(auth)
        .send({ prompt: 'PRIVATE-PROMPT', userMessage: 'PRIVATE-USER-MESSAGE' });
      const all = [...log.mock.calls, ...warn.mock.calls].map((c) => c.map(String).join(' ')).join('\n');
      expect(all).toMatch(/provider=openrouter/);
      for (const secret of ['PRIVATE-PROMPT', 'PRIVATE-USER-MESSAGE', 'PRIVATE-ANSWER-TEXT']) {
        expect(all).not.toContain(secret);
      }
    });

    it('rate limit is per user: 429 + Retry-After for the one who exceeds, the other user is unaffected', async () => {
      process.env.AI_RATE_PER_MINUTE = '2';
      const a = await createUser('rl-a@example.com');
      const b = await createUser('rl-b@example.com');
      const call = (auth: Record<string, string>) =>
        request(app).post('/api/ai/generate-description').set(auth).send({ prompt: 'p', userMessage: 'm' });

      expect((await call(a.auth)).status).toBe(200);
      expect((await call(a.auth)).status).toBe(200);
      const blocked = await call(a.auth);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe(ErrorCode.RATE_LIMIT_ERROR);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
      expect(remote.seen).toHaveLength(2); // the blocked call never reached the model

      expect((await call(b.auth)).status).toBe(200);
    });

    it('every generation route shares the user bucket', async () => {
      process.env.AI_RATE_PER_MINUTE = '2';
      const a = await createUser('rl-c@example.com');
      remote.setHandler(answer('{"a":1}'));
      await request(app).post('/api/ai/generate-description').set(a.auth).send({ prompt: 'p', userMessage: 'm' });
      await request(app).post('/api/ai/generate-mock-data').set(a.auth).send({ schema: { a: 'n' } });
      const third = await request(app).post('/api/ai/generate-mock-api-spec').set(a.auth).send({});
      expect(third.status).toBe(429);
    });
  });

  describe('assertProdConfig for the AI providers', () => {
    const prod = (extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://app.mockia.io',
      MONGODB_URI: 'mongodb://mockia:s3cr3t-Pr0d-pass@mongo:27017/mockia?authSource=admin',
      APP_URL: 'https://app.mockia.io',
      JWT_ACCESS_SECRET: 'a'.repeat(48),
      JWT_REFRESH_SECRET: 'b'.repeat(48),
      ...extra,
    });

    it('openrouter only (default) needs nothing new', () => {
      expect(() => assertProdConfig(prod())).not.toThrow();
      expect(() => assertProdConfig(prod({ AI_PROVIDERS: 'openrouter' }))).not.toThrow();
    });

    it('local requires AI_LOCAL_BASE_URL', () => {
      expect(() => assertProdConfig(prod({ AI_PROVIDERS: 'local,openrouter' }))).toThrow(/AI_LOCAL_BASE_URL/);
      expect(() => assertProdConfig(prod({ AI_PROVIDERS: 'local', AI_LOCAL_BASE_URL: '  ' }))).toThrow(/AI_LOCAL_BASE_URL/);
    });

    it.each(['llm:11434', 'ftp://llm:11434', 'javascript:alert(1)', 'not a url'])('rejects a non-http(s) base URL (%p) without echoing it', (value) => {
      let message = '';
      try {
        assertProdConfig(prod({ AI_PROVIDERS: 'local', AI_LOCAL_BASE_URL: value }));
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/AI_LOCAL_BASE_URL/);
      expect(message).not.toContain(value);
    });

    it('accepts http and https base URLs', () => {
      expect(() => assertProdConfig(prod({ AI_PROVIDERS: 'local,openrouter', AI_LOCAL_BASE_URL: 'http://llm:11434' }))).not.toThrow();
      expect(() => assertProdConfig(prod({ AI_PROVIDERS: 'local', AI_LOCAL_BASE_URL: 'https://llm.internal' }))).not.toThrow();
    });

    it('a list without any valid provider is rejected; the local checks do not run outside production', () => {
      expect(() => assertProdConfig(prod({ AI_PROVIDERS: 'nope' }))).toThrow(/AI_PROVIDERS/);
      expect(() => assertProdConfig({ NODE_ENV: 'development', AI_PROVIDERS: 'local' })).not.toThrow();
    });
  });
});
