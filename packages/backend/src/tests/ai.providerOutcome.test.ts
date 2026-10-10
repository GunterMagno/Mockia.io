import http from 'http';
import type { AddressInfo } from 'net';
import { AxiosError } from 'axios';
import { AppError } from '../middlewares/errorHandler.js';
import { createRefundTracker } from '../controllers/ai.controller.js';
import { openRouterConfig } from '../config/ai.js';
import { createFallbackLlm, providerOutcomeOf, resetLlm } from '../modules/ai/providers/index.js';
import { createOpenAiCompatibleProvider, createOpenRouterProvider } from '../modules/ai/providers/openaiCompatible.js';
import { LlmResponseError, type LlmProvider } from '../modules/ai/providers/types.js';

/**
 * Ruling B3-R3: a paid generation (a registered user's monthly unit) comes back only if no provider can have billed it.
 * These are the pieces that decide it: how one failed request is classified, how the chain reports each request, and
 * the tracker the AI controller consults.
 */

const axiosError = (code?: string, status?: number): AxiosError => {
  const err = new AxiosError('boom', code, undefined, undefined, status ? ({ status, statusText: '', headers: {}, config: {} as never, data: {} } as never) : undefined);
  return err;
};

describe('providerOutcomeOf', () => {
  it('a completion that is cut, empty or not a chat envelope is an answer (the provider generated it)', () => {
    for (const kind of ['truncated', 'empty_content', 'invalid_envelope', 'invalid_output'] as const) {
      expect(providerOutcomeOf(new LlmResponseError(kind))).toBe('answered');
    }
  });

  it('an explicit HTTP error or an unreachable server is a refusal: nothing was generated', () => {
    expect(providerOutcomeOf(axiosError('ERR_BAD_RESPONSE', 500))).toBe('refused');
    expect(providerOutcomeOf(axiosError('ERR_BAD_REQUEST', 402))).toBe('refused');
    expect(providerOutcomeOf(axiosError('ECONNREFUSED'))).toBe('refused');
    expect(providerOutcomeOf(axiosError('ENOTFOUND'))).toBe('refused');
    expect(providerOutcomeOf(axiosError('EAI_AGAIN'))).toBe('refused');
  });

  it('a timeout, a reset in flight, a cancellation or an abort is uncertain: it may have been billed', () => {
    expect(providerOutcomeOf(axiosError('ECONNABORTED'))).toBe('uncertain');
    expect(providerOutcomeOf(axiosError('ETIMEDOUT'))).toBe('uncertain');
    expect(providerOutcomeOf(axiosError('ECONNRESET'))).toBe('uncertain');
    expect(providerOutcomeOf(axiosError('ERR_CANCELED'))).toBe('uncertain');
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(providerOutcomeOf(abort)).toBe('uncertain');
    expect(providerOutcomeOf(new DOMException('The operation timed out', 'TimeoutError'))).toBe('uncertain');
    expect(providerOutcomeOf('weird')).toBe('uncertain');
  });

  it('a plain local error (a missing key, a bad URL) happened before anything could be generated', () => {
    expect(providerOutcomeOf(new Error('OPENROUTER_API_KEY environment variable is not set'))).toBe('refused');
  });

  it('an error the OpenRouter client already classified keeps its classification', () => {
    const marked = Object.assign(new AppError('x', 'EXTERNAL_SERVICE_ERROR' as never, 503), { providerOutcome: 'uncertain' });
    expect(providerOutcomeOf(marked)).toBe('uncertain');
  });
});

describe('createRefundTracker', () => {
  it('may refund when nothing ever left for a provider', () => {
    expect(createRefundTracker().mayRefund()).toBe(true);
  });

  it('may refund when every request that left was refused', () => {
    const t = createRefundTracker();
    t.hooks.onProviderCall();
    t.hooks.onProviderResult('refused');
    t.hooks.onProviderCall();
    t.hooks.onProviderResult('refused');
    expect(t.mayRefund()).toBe(true);
  });

  it('may not refund after any answer, any uncertain request, or a request that never reported back', () => {
    const answered = createRefundTracker();
    answered.hooks.onProviderCall();
    answered.hooks.onProviderResult('answered');
    expect(answered.mayRefund()).toBe(false);

    const mixed = createRefundTracker();
    mixed.hooks.onProviderCall();
    mixed.hooks.onProviderResult('refused');
    mixed.hooks.onProviderCall();
    mixed.hooks.onProviderResult('uncertain');
    expect(mixed.mayRefund()).toBe(false);

    const pending = createRefundTracker();
    pending.hooks.onProviderCall();
    expect(pending.mayRefund()).toBe(false);
  });
});

describe('the provider chain reports how each request ended', () => {
  const MESSAGES = [{ role: 'user' as const, content: 'hi' }];
  const stub = (complete: LlmProvider['complete']): LlmProvider => ({ name: 'stub', complete });
  const record = () => {
    const events: string[] = [];
    return {
      events,
      hooks: {
        onProviderCall: () => events.push('call'),
        onProviderResult: (o: string) => events.push(o),
      },
    };
  };
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('answered once for a good completion', async () => {
    const r = record();
    const chain = createFallbackLlm([{ provider: stub(async () => ({ text: 'ok', provider: 'stub', model: 'm' })) }]);
    await chain.complete({ messages: MESSAGES, ...r.hooks });
    expect(r.events).toEqual(['call', 'answered']);
  });

  it('a repair retry is a second request, and an answer that stays invalid is still an answer', async () => {
    const r = record();
    const chain = createFallbackLlm([{ provider: stub(async () => ({ text: 'nope', provider: 'stub', model: 'm' })) }]);
    await expect(chain.complete({ messages: MESSAGES, validate: () => 'bad', ...r.hooks })).rejects.toBeInstanceOf(AppError);
    expect(r.events).toEqual(['call', 'answered', 'call', 'answered']);
  });

  it('a truncated answer from the first provider and an HTTP error from the second', async () => {
    const r = record();
    const chain = createFallbackLlm([
      {
        provider: stub(async () => {
          throw new LlmResponseError('truncated');
        }),
      },
      { provider: stub(async () => Promise.reject(axiosError('ERR_BAD_RESPONSE', 500))) },
    ]);
    await expect(chain.complete({ messages: MESSAGES, ...r.hooks })).rejects.toBeInstanceOf(AppError);
    expect(r.events).toEqual(['call', 'answered', 'call', 'refused']);
  });

  it('a request cut by the overall deadline is uncertain', async () => {
    const r = record();
    const chain = createFallbackLlm(
      [
        {
          provider: stub(
            (req) =>
              new Promise((_resolve, reject) => {
                req.signal?.addEventListener('abort', () => reject(axiosError('ERR_CANCELED')));
              }),
          ),
        },
      ],
      { totalTimeoutMs: 100 },
    );
    await expect(chain.complete({ messages: MESSAGES, ...r.hooks })).rejects.toMatchObject({ statusCode: 504 });
    expect(r.events).toEqual(['call', 'uncertain']);
  });
});

describe('real clients against a fake server', () => {
  const MESSAGES = [{ role: 'user' as const, content: 'hi' }];
  const savedOr = { ...openRouterConfig };
  let server: http.Server;
  let url: string;
  let reply: (res: http.ServerResponse) => void;
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(async () => {
    reply = (res) => {
      res.statusCode = 500;
      res.end('boom');
    };
    server = http.createServer((req, res) => {
      req.on('data', () => undefined);
      req.on('end', () => reply(res));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    openRouterConfig.baseUrl = url;
    openRouterConfig.apiKey = 'sk-or-test-key';
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    warn.mockRestore();
    log.mockRestore();
    error.mockRestore();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    Object.assign(openRouterConfig, savedOr);
    resetLlm();
  });

  const outcomeOf = async (provider: LlmProvider): Promise<string> => {
    try {
      await provider.complete({ messages: MESSAGES });
      return 'completed';
    } catch (err) {
      return providerOutcomeOf(err);
    }
  };

  it('the local client: HTTP 500 is refused, a refused connection is refused, a timeout is uncertain', async () => {
    const local = (baseUrl: string, timeoutMs = 2000) => createOpenAiCompatibleProvider({ name: 'local', baseUrl, model: 'm', timeoutMs });
    expect(await outcomeOf(local(url))).toBe('refused');
    expect(await outcomeOf(local('http://127.0.0.1:1'))).toBe('refused');
    reply = () => undefined; // never answers
    expect(await outcomeOf(local(url, 200))).toBe('uncertain');
  });

  it('the OpenRouter client keeps the distinction its AppError loses: 401 refused, 400 refused', async () => {
    reply = (res) => {
      res.statusCode = 401;
      res.end('{}');
    };
    expect(await outcomeOf(createOpenRouterProvider())).toBe('refused');
    reply = (res) => {
      res.statusCode = 400;
      res.end('{}');
    };
    expect(await outcomeOf(createOpenRouterProvider())).toBe('refused');
  });

  it('the OpenRouter client: a cancelled request (deadline) is uncertain even though the AppError would look like any other', async () => {
    reply = () => undefined; // never answers
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    try {
      await createOpenRouterProvider().complete({ messages: MESSAGES, signal: controller.signal });
      throw new Error('expected a failure');
    } catch (err) {
      expect(providerOutcomeOf(err)).toBe('uncertain');
    }
  });
});
