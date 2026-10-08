/**
 * OpenRouter utilities
 * Helper functions for OpenRouter integration
 */

import { retryConfig } from '../config/ai.js';

/*
 * The old process-wide in-memory limiter (shouldRateLimit / resetRateLimiter / getRateLimiterState) was removed: it was
 * shared by all users and reset on every restart. AI calls are limited per user in Mongo, see modules/ai/aiRateLimit.ts.
 */

/**
 * Format retry configuration for logging
 */
export function formatRetryConfig(): string {
  return `Max retries: ${retryConfig.maxRetries}, Initial delay: ${retryConfig.initialDelayMs}ms, Max delay: ${retryConfig.maxDelayMs}ms`;
}

/**
 * Estimate wait time for exponential backoff
 * Useful for giving users feedback
 *
 * @param attemptNumber - Current attempt number (0-based)
 * @returns Estimated wait time in milliseconds
 */
export function estimateBackoffWaitTime(attemptNumber: number): number {
  const exponentialDelay = retryConfig.initialDelayMs * Math.pow(2, attemptNumber);
  return Math.min(exponentialDelay, retryConfig.maxDelayMs);
}
