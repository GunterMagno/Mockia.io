/**
 * Provider-neutral LLM interface. Controllers talk to `LlmProvider` (see ./index.ts: getLlm()) and never to a vendor.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  messages: ChatMessage[];
  /** JSON Schema of the expected answer: sent as a strict `response_format` (and lowers the default temperature to 0.2). */
  jsonSchema?: object;
  /** Ask for "some JSON object" without a schema (`response_format: json_object`). Ignored when `jsonSchema` is set. */
  json?: boolean;
  /** Default 5000, as before providers existed. */
  maxTokens?: number;
  /** Default 0.2 with `jsonSchema`, 0.7 otherwise. */
  temperature?: number;
  /** Aborting it cancels the HTTP call and is never treated as a provider failure (no fallback). */
  signal?: AbortSignal;
}

export interface LlmCompletion {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
  /** Name of the provider that actually answered ("local", "openrouter"). */
  provider: string;
  /** Model that answered, as reported by the server (falls back to the configured one). */
  model: string;
}

export interface LlmProvider {
  name: string;
  complete(req: LlmRequest): Promise<LlmCompletion>;
}

/** The provider answered, but not with a usable chat completion. Always a reason to try the next provider. */
export class LlmResponseError extends Error {
  constructor(public readonly kind: 'invalid_envelope' | 'empty_content') {
    // The message carries only the kind: it can end up in logs, and a response body must never be logged.
    super(kind);
    this.name = 'LlmResponseError';
    Object.setPrototypeOf(this, LlmResponseError.prototype);
  }
}
