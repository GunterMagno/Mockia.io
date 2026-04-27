/**
 * AI Configuration
 * Centralized configuration for AI services (OpenRouter, etc.)
 */

/**
 * OpenRouter API configuration
 */
export const openRouterConfig = {
  apiKey: process.env.OPENROUTER_API_KEY || '',
  model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-2-7b-chat',
  baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
};

/**
 * Retry configuration for API calls
 */
export const retryConfig = {
  maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
  initialDelayMs: parseInt(process.env.INITIAL_RETRY_DELAY_MS || '1000', 10),
  maxDelayMs: parseInt(process.env.MAX_RETRY_DELAY_MS || '30000', 10),
};

/**
 * Get OpenRouter API key
 * @throws Error if API key is not configured
 */
export function getOpenRouterApiKey(): string {
  if (!openRouterConfig.apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is not set');
  }
  return openRouterConfig.apiKey;
}

/**
 * Get OpenRouter model name
 */
export function getOpenRouterModel(): string {
  return openRouterConfig.model;
}

/**
 * Get OpenRouter base URL
 */
export function getOpenRouterBaseUrl(): string {
  return openRouterConfig.baseUrl;
}
