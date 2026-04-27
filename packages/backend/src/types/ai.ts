/**
 * AI-related types
 * Types for OpenRouter API and AI integration
 */

export interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface OpenRouterPayload {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  [key: string]: unknown;
}

export interface OpenRouterChoice {
  index: number;
  message: OpenRouterMessage;
  finish_reason: string;
}

export interface OpenRouterResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenRouterChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenRouterError {
  error?: {
    message: string;
    code: string;
    status?: number;
  };
}
