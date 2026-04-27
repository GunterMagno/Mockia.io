/**
 * OpenRouter utilities
 * Helper functions for OpenRouter integration
 */

import { retryConfig } from '../config/ai';

/**
 * Rate limiter state for tracking calls
 */
interface RateLimiterState {
  calls: number;
  resetTime: number;
}

const rateLimiterState: RateLimiterState = {
  calls: 0,
  resetTime: Date.now(),
};

/**
 * Check if we should rate limit based on a simple sliding window
 * This is a client-side optimization to avoid hitting the server rate limiter
 *
 * @param maxCallsPerMinute - Maximum calls allowed per minute
 * @returns true if we should rate limit (wait before calling)
 */
export function shouldRateLimit(maxCallsPerMinute: number = 60): boolean {
  const now = Date.now();
  const oneMinuteInMs = 60 * 1000;

  // Reset counter if the window has passed
  if (now - rateLimiterState.resetTime > oneMinuteInMs) {
    rateLimiterState.calls = 0;
    rateLimiterState.resetTime = now;
  }

  // Check if we've exceeded the limit
  if (rateLimiterState.calls >= maxCallsPerMinute) {
    return true;
  }

  // Increment and allow
  rateLimiterState.calls++;
  return false;
}

/**
 * Reset rate limiter state (useful for testing)
 */
export function resetRateLimiter(): void {
  rateLimiterState.calls = 0;
  rateLimiterState.resetTime = Date.now();
}

/**
 * Get current rate limiter state (for monitoring/debugging)
 */
export function getRateLimiterState(): RateLimiterState {
  return { ...rateLimiterState };
}

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
