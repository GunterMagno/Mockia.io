/**
 * Clients for OpenAI-style `chat/completions` servers.
 *
 * - createOpenAiCompatibleProvider: a single POST to any such server (Ollama, vLLM, llama.cpp expose
 *   `{root}/v1/chat/completions`). No retries: when it fails, the fallback chain moves on to the next provider.
 * - createOpenRouterProvider: OpenRouter through the existing callOpenRouterWithRetry, which keeps its own
 *   retry/backoff and credit-limit handling.
 */

import axios from 'axios';
import { callOpenRouterWithRetry } from '../../../services/openRouter.service.js';
import { getOpenRouterModel } from '../../../config/ai.js';
import { LlmResponseError, type LlmCompletion, type LlmProvider, type LlmRequest } from './types.js';

export const DEFAULT_MAX_TOKENS = 5000;
export const DEFAULT_TEMPERATURE = 0.7;
export const STRUCTURED_TEMPERATURE = 0.2;
export const SCHEMA_NAME = 'mockia_output';

type ResponseFormat =
  | { type: 'json_object' }
  | { type: 'json_schema'; json_schema: { name: string; strict: true; schema: object } };

/** Sampling parameters shared by every provider (the model name and messages are added by each one). */
export function buildChatParams(req: LlmRequest): {
  temperature: number;
  max_tokens: number;
  response_format?: ResponseFormat;
} {
  const params: { temperature: number; max_tokens: number; response_format?: ResponseFormat } = {
    temperature: req.temperature ?? (req.jsonSchema ? STRUCTURED_TEMPERATURE : DEFAULT_TEMPERATURE),
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
  if (req.jsonSchema) {
    params.response_format = {
      type: 'json_schema',
      json_schema: { name: SCHEMA_NAME, strict: true, schema: req.jsonSchema },
    };
  } else if (req.json) {
    params.response_format = { type: 'json_object' };
  }
  return params;
}

/** Validates the chat completion envelope and extracts text, usage and model. Throws LlmResponseError otherwise. */
export function readCompletion(data: unknown, provider: string, configuredModel: string): LlmCompletion {
  const body = data as {
    model?: unknown;
    choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  } | null;
  if (!body || typeof body !== 'object' || !Array.isArray(body.choices) || body.choices.length === 0) {
    throw new LlmResponseError('invalid_envelope');
  }
  const message = body.choices[0]?.message;
  if (!message || typeof message !== 'object') throw new LlmResponseError('invalid_envelope');
  // Cut by max_tokens: whatever came back is an incomplete document, never a usable answer
  if (body.choices[0]?.finish_reason === 'length') throw new LlmResponseError('truncated');
  const content = message.content;
  if (typeof content !== 'string' || content.trim() === '') throw new LlmResponseError('empty_content');

  const usage = body.usage;
  const completion: LlmCompletion = {
    text: content,
    provider,
    model: typeof body.model === 'string' && body.model ? body.model : configuredModel,
  };
  if (usage && typeof usage.prompt_tokens === 'number' && typeof usage.completion_tokens === 'number') {
    completion.usage = { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens };
  }
  return completion;
}

export interface OpenAiCompatibleConfig {
  name: string;
  /** Server root WITHOUT /v1 (a trailing /v1 or slash is tolerated). */
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** Sent as `Authorization: Bearer ...` only when set. */
  apiKey?: string;
}

/** `http://llm:11434`, `http://llm:11434/` and `http://llm:11434/v1` all give `http://llm:11434/v1/chat/completions`. */
export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/chat/completions`;
}

export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): LlmProvider {
  return {
    name: config.name,
    async complete(req) {
      if (!config.baseUrl) throw new Error(`${config.name}: base URL is not configured`);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

      const response = await axios.post(
        chatCompletionsUrl(config.baseUrl),
        { model: config.model, messages: req.messages, ...buildChatParams(req) },
        {
          headers,
          timeout: config.timeoutMs,
          // Any 4xx/5xx is a failure for the chain to handle; never let axios hand an error page to readCompletion.
          validateStatus: (status) => status >= 200 && status < 300,
          ...(req.signal ? { signal: req.signal } : {}),
        }
      );
      return readCompletion(response.data, config.name, config.model);
    },
  };
}

/**
 * Whether OpenRouter gets strict `json_schema` structured outputs. Off by default: only some of the models OpenRouter
 * serves support it and the others answer 400 (the whole request would fail). Set OPENROUTER_JSON_SCHEMA=1 when
 * OPENROUTER_MODEL is known to support it. Otherwise a schema is downgraded to `json_object`: the prompt already
 * describes the format and the pipeline validates the answer.
 */
export function openRouterSupportsJsonSchema(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'yes'].includes((env.OPENROUTER_JSON_SCHEMA ?? '').trim().toLowerCase());
}

/** The request as OpenRouter should get it: the schema is kept only when the operator opted in. */
export function toOpenRouterRequest(req: LlmRequest, env: NodeJS.ProcessEnv = process.env): LlmRequest {
  if (!req.jsonSchema || openRouterSupportsJsonSchema(env)) return req;
  const { jsonSchema: _dropped, ...rest } = req;
  return { ...rest, json: true, temperature: req.temperature ?? STRUCTURED_TEMPERATURE };
}

export function createOpenRouterProvider(): LlmProvider {
  return {
    name: 'openrouter',
    async complete(req) {
      const response = await callOpenRouterWithRetry(req.messages, buildChatParams(toOpenRouterRequest(req)), {
        signal: req.signal,
      });
      return readCompletion(response, 'openrouter', getOpenRouterModel());
    },
  };
}
