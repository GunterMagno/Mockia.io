/**
 * Provider-neutral LLM interface. Controllers talk to `LlmProvider` (see ./index.ts: getLlm()) and never to a vendor.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  messages: ChatMessage[];
  /**
   * JSON Schema of the expected answer: sent as a strict `response_format` (and lowers the default temperature to 0.2).
   * OpenRouter gets `json_object` instead unless OPENROUTER_JSON_SCHEMA=1 (not every model it serves supports json_schema).
   */
  jsonSchema?: object;
  /** Ask for "some JSON object" without a schema (`response_format: json_object`). Ignored when `jsonSchema` is set. */
  json?: boolean;
  /** Default 5000, as before providers existed. */
  maxTokens?: number;
  /** Default 0.2 with `jsonSchema`, 0.7 otherwise. */
  temperature?: number;
  /** Aborting it cancels the HTTP call and is never treated as a provider failure (no fallback). */
  signal?: AbortSignal;
  /**
   * Checks the answer text with the SAME parse + validation the caller applies afterwards. Returns null when it is
   * usable, or a short CONTENT-FREE reason (it is sent back to the model and may be logged: never quote the output).
   * An invalid answer gets one repair retry on the same provider; a second invalid answer is a provider failure.
   */
  validate?: (text: string) => string | null;
  /**
   * Called (possibly several times) as soon as a provider has PRODUCED an answer, usable or not: a completion came back,
   * or the provider reported one that was cut by max_tokens / empty / rejected by `validate`. It is never called for a
   * transport failure (refused connection, timeout, HTTP error, a body that is not a chat completion), so a caller that
   * pays per model call can tell "the model never answered" (safe to refund) from "the model answered" (cost incurred).
   */
  onModelAnswer?: () => void;
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

/**
 * The provider answered, but not with a usable chat completion. Always a reason to try the next provider.
 *  - truncated: finish_reason "length" (cut by max_tokens: the JSON is incomplete)
 *  - invalid_output: the text failed the caller's validator twice (first answer + one repair)
 */
export class LlmResponseError extends Error {
  constructor(public readonly kind: 'invalid_envelope' | 'empty_content' | 'truncated' | 'invalid_output') {
    // The message carries only the kind: it can end up in logs, and a response body must never be logged.
    super(kind);
    this.name = 'LlmResponseError';
    Object.setPrototypeOf(this, LlmResponseError.prototype);
  }
}
