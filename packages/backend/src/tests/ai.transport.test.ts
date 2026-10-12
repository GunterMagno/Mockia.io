/**
 * K2 - `transport` option of createOpenAiCompatibleProvider: a fetch-like function (the SSRF-hardened client for a user's
 * own AI provider) used INSTEAD of axios. Without it nothing changes (ai.providers.test.ts covers that path).
 */
import { createOpenAiCompatibleProvider } from '../modules/ai/providers/openaiCompatible.js';
import { LlmResponseError } from '../modules/ai/providers/types.js';
import { providerOutcomeOf } from '../modules/ai/providers/outcome.js';
import { SafeHttpError } from '../modules/byok/safeHttp.js';

const KEY = 'sk-TRANSPORT-SENTINEL-1';
const MESSAGES = [{ role: 'user' as const, content: 'hi' }];
const OK_BODY = {
  model: 'served',
  choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 3, completion_tokens: 2 },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function provider(transport: typeof fetch, extra: Record<string, unknown> = {}) {
  return createOpenAiCompatibleProvider({
    name: 'user-ai',
    baseUrl: 'https://api.example.com',
    model: 'm1',
    timeoutMs: 5000,
    apiKey: KEY,
    transport,
    ...extra,
  });
}

describe('openai-compatible provider with an injected transport', () => {
  it('posts the same request through the transport and reads the completion', async () => {
    const transport = jest.fn(async () => json(OK_BODY)) as unknown as jest.MockedFunction<
      typeof fetch
    >;
    const out = await provider(transport).complete({ messages: MESSAGES, json: true });

    expect(out).toEqual({
      text: 'hello',
      provider: 'user-ai',
      model: 'served',
      usage: { inputTokens: 3, outputTokens: 2 },
    });
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'm1',
      messages: MESSAGES,
      response_format: { type: 'json_object' },
    });
  });

  it('an HTTP error status is a failure that did not generate anything (refused), without the body in the message', async () => {
    const transport = (async () =>
      json({ error: `bad key ${KEY}` }, 401)) as unknown as typeof fetch;
    const err = await provider(transport)
      .complete({ messages: MESSAGES })
      .then(
        () => null,
        (e) => e as Error
      );
    expect(err).toBeInstanceOf(Error);
    expect(providerOutcomeOf(err)).toBe('refused');
    expect(`${err!.message} ${err!.name} ${err!.stack}`).not.toContain(KEY);
    expect(err!.name).toBe('http_401'); // what classifyFailure reports in the logs
  });

  it('a body that is not JSON is an invalid envelope (the answer was produced, unusable)', async () => {
    const transport = (async () =>
      new Response('<html>nope</html>', { status: 200 })) as unknown as typeof fetch;
    await expect(provider(transport).complete({ messages: MESSAGES })).rejects.toBeInstanceOf(
      LlmResponseError
    );
  });

  it('a policy refusal (forbidden address) happens before anything is sent: refused', async () => {
    const transport = (async () => {
      throw new SafeHttpError('forbidden_address');
    }) as unknown as typeof fetch;
    const err = await provider(transport)
      .complete({ messages: MESSAGES })
      .catch((e) => e);
    expect(err).toBeInstanceOf(SafeHttpError);
    expect(providerOutcomeOf(err)).toBe('refused');
  });

  it('a transport timeout may have been generating: uncertain', async () => {
    const transport = (async () => {
      throw new SafeHttpError('timeout', 'ETIMEDOUT');
    }) as unknown as typeof fetch;
    const err = await provider(transport)
      .complete({ messages: MESSAGES })
      .catch((e) => e);
    expect(providerOutcomeOf(err)).toBe('uncertain');
  });

  it('a refused connection is refused, a mid-flight network failure is uncertain', async () => {
    const refused = (async () => {
      throw new SafeHttpError('network_error', 'ECONNREFUSED');
    }) as unknown as typeof fetch;
    const reset = (async () => {
      throw new SafeHttpError('network_error', 'ECONNRESET');
    }) as unknown as typeof fetch;
    expect(
      providerOutcomeOf(
        await provider(refused)
          .complete({ messages: MESSAGES })
          .catch((e) => e)
      )
    ).toBe('refused');
    expect(
      providerOutcomeOf(
        await provider(reset)
          .complete({ messages: MESSAGES })
          .catch((e) => e)
      )
    ).toBe('uncertain');
  });

  it('passes the caller signal and the provider timeout to the transport', async () => {
    let seen: AbortSignal | null | undefined;
    const transport = (async (_url: unknown, init?: RequestInit) => {
      seen = init?.signal;
      return json(OK_BODY);
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    await provider(transport).complete({ messages: MESSAGES, signal: controller.signal });
    expect(seen).toBeDefined();
    expect(seen!.aborted).toBe(false);
    controller.abort();
    expect(seen!.aborted).toBe(true); // aborting the caller aborts the transport call
  });

  it('the provider timeout aborts a transport that never answers', async () => {
    const transport = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as unknown as typeof fetch;
    const err = await provider(transport, { timeoutMs: 50 })
      .complete({ messages: MESSAGES })
      .catch((e) => e);
    expect(providerOutcomeOf(err)).toBe('uncertain');
  });
});
