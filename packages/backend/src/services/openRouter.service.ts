import axios, { AxiosError } from 'axios';
import {
  getOpenRouterApiKey,
  getOpenRouterModel,
  getOpenRouterBaseUrl,
  retryConfig,
} from '../config/ai.js';
import type {
  OpenRouterPayload,
  OpenRouterResponse,
  OpenRouterMessage,
  OpenRouterError,
} from '../types/ai.js';
import { AppError } from '../middlewares/errorHandler.js';
import { ErrorCode } from '@mockia/shared';
import { describeError } from '../utils/safeErrorLog.js';

/**
 * Sleep utility for delays between retries
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sleep that ends early when the signal aborts (the next attempt then fails fast and the abort is rethrown), so a
 * retry backoff never outlives the caller's overall deadline.
 */
function sleepUnlessAborted(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms);
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal!.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * Calculate exponential backoff delay
 * @param attemptNumber - Current attempt number (0-based)
 * @param baseDelayMs - Base delay in milliseconds
 * @param maxDelayMs - Maximum delay in milliseconds
 * @returns Delay in milliseconds with jitter
 */
export function calculateBackoffDelay(
  attemptNumber: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attemptNumber);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  // Add jitter: random value between 0-20% of the capped delay
  const jitter = cappedDelay * Math.random() * 0.2;
  return cappedDelay + jitter;
}

/**
 * Check if an error is retryable
 * @param error - Axios error or any error
 * @returns true if the error is retryable (429, 503, or network errors)
 */
function isRetryableError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    // 429: Too Many Requests (rate limiting)
    // 503: Service Unavailable
    // Network errors are also retryable
    return status === 429 || status === 503 || !error.response;
  }
  return false;
}

/**
 * Call OpenRouter API with automatic retry on rate limiting/service unavailable
 * Implements exponential backoff strategy
 *
 * @param messages - Array of messages for the chat completion
 * @param options - Optional parameters (temperature, max_tokens, etc.)
 * @param requestOptions - Transport options that are not part of the request body (`signal`: aborting it cancels the
 *   call and stops the retries)
 * @returns OpenRouter response
 * @throws AppError if API call fails after all retries
 */
export async function callOpenRouterWithRetry(
  messages: OpenRouterMessage[],
  options?: Partial<OpenRouterPayload>,
  requestOptions?: { signal?: AbortSignal }
): Promise<OpenRouterResponse> {
  const signal = requestOptions?.signal;
  const apiKey = getOpenRouterApiKey();
  const model = getOpenRouterModel();
  const baseUrl = getOpenRouterBaseUrl();

  const payload: OpenRouterPayload = {
    model,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.max_tokens ?? 5000,
    ...options,
  };

  let lastError: AxiosError | null = null;

  for (let attempt = 0; attempt < retryConfig.maxRetries; attempt++) {
    try {
      console.log(
        `[OpenRouter] Attempt ${attempt + 1}/${retryConfig.maxRetries} - Calling OpenRouter API`
      );

      const response = await axios.post<OpenRouterResponse>(
        `${baseUrl}/chat/completions`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': process.env.APP_URL || 'https://mockia.io',
            'X-Title': 'Mockia.io',
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 second timeout
          ...(signal ? { signal } : {}),
        }
      );

      console.log('[OpenRouter] ✓ API call successful');
      return response.data;
    } catch (error) {
      lastError = error as AxiosError;

      // The caller gave up: no retries and no error translation, whoever cancelled wants out.
      if (signal?.aborted) throw error;

      if (!isRetryableError(error)) {
        // Special handling for credit/token limit errors from OpenRouter
        if (axios.isAxiosError(error) && error.response?.data) {
          const data = error.response.data as any;
          const errorMessage = data?.error?.message || '';

          if (errorMessage.includes('requires more credits, or fewer max_tokens')) {
            const affordMatch = errorMessage.match(/can only afford (\d+)/);
            if (affordMatch && affordMatch[1]) {
              const affordableTokens = parseInt(affordMatch[1], 10);
              console.warn(
                `[OpenRouter] ⚠ Credit limit reached. Adjusting max_tokens to ${affordableTokens} and retrying...`
              );
              payload.max_tokens = affordableTokens;
              // Reset attempt counter or just continue? 
              // Continuing is safer to prevent infinite loops if something goes wrong.
              continue;
            }
          }
        }

        // Non-retryable error, throw immediately
        // Only the status/code: the raw AxiosError holds the prompt (config.data), the API key and the response body
        console.error(`[OpenRouter] ✗ Non-retryable error (${describeError(error)})`);
        throw transformOpenRouterError(error);
      }

      // Retryable error, but check if it's the last attempt
      if (attempt === retryConfig.maxRetries - 1) {
        console.error('[OpenRouter] ✗ Max retries exceeded');
        throw transformOpenRouterError(error);
      }

      // Calculate backoff delay and retry
      const delayMs = calculateBackoffDelay(
        attempt,
        retryConfig.initialDelayMs,
        retryConfig.maxDelayMs
      );

      const status = axios.isAxiosError(error) ? error.response?.status : 'unknown';
      const statusText = axios.isAxiosError(error) ? error.response?.statusText : '';

      console.warn(
        `[OpenRouter] ⚠ Retryable error (${status} ${statusText}), waiting ${delayMs.toFixed(0)}ms before retry`
      );

      await sleepUnlessAborted(delayMs, signal);
    }
  }

  // This should not be reached due to the throw in the loop, but for type safety
  throw new AppError(
    'OpenRouter API call failed after all retries',
    ErrorCode.EXTERNAL_SERVICE_ERROR,
    503
  );
}

/**
 * Transform OpenRouter API errors into AppError.
 *
 * Only 429 and 503 keep their status. Every other upstream answer (401 bad key, 402 no credits, 404 unknown model,
 * 400/422 rejected request, other 5xx) is OUR problem, not the user's request or session: it becomes a 502 with a
 * generic message. Passing a 401 through made the SPA read it as an expired session, refresh and repeat the whole
 * generation; the upstream message is not echoed either (the global error handler logs and returns `message`).
 * @param error - Error from axios or any error
 * @returns AppError
 */
function transformOpenRouterError(error: unknown): AppError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;

    if (status === 429) {
      return new AppError(
        'OpenRouter API rate limited. Please try again later.',
        ErrorCode.RATE_LIMIT_ERROR,
        429
      );
    }

    if (status === 503 || status === undefined) {
      return new AppError(
        'OpenRouter API temporarily unavailable. Please try again later.',
        ErrorCode.EXTERNAL_SERVICE_ERROR,
        503
      );
    }

    if (status === 401 || status === 403) {
      return new AppError(
        'OpenRouter API authentication failed',
        ErrorCode.EXTERNAL_SERVICE_ERROR,
        502
      );
    }

    return new AppError(
      `OpenRouter API error (upstream status ${status}). Please try again later.`,
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      502
    );
  }

  if (error instanceof Error) {
    return new AppError(
      `OpenRouter API error: ${error.message}`,
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      500
    );
  }

  return new AppError(
    'OpenRouter API error: Unknown error',
    ErrorCode.EXTERNAL_SERVICE_ERROR,
    500
  );
}

/**
 * Call OpenRouter API for generating mock data/descriptions
 * Convenience wrapper around callOpenRouterWithRetry
 *
 * @param prompt - User prompt/system message
 * @param userMessage - The actual user message
 * @param options - Optional parameters
 * @returns Generated response from the model
 */
export async function generateWithOpenRouter(
  prompt: string,
  userMessage: string,
  options?: Partial<OpenRouterPayload>
): Promise<string> {
  const messages: OpenRouterMessage[] = [
    { role: 'system', content: prompt },
    { role: 'user', content: userMessage },
  ];

  const response = await callOpenRouterWithRetry(messages, options);

  if (response.choices && response.choices.length > 0) {
    const firstChoice = response.choices[0];
    if (firstChoice.message && firstChoice.message.content) {
      return firstChoice.message.content;
    }
  }

  throw new AppError(
    'No response received from OpenRouter',
    ErrorCode.EXTERNAL_SERVICE_ERROR,
    500
  );
}
