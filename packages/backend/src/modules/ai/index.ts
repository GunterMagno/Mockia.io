/**
 * AI Module - Prompt Engineering and Context Management
 * 
 * This module handles:
 * - System prompt definition for AI instruction
 * - Prompt building and context integration
 * - Response validation and extraction
 */

export { SYSTEM_PROMPT } from './systemPrompt';
export { type MockAPIOutput } from '@mockia/shared';
export {
  buildPrompt,
  validateJsonResponse,
  extractMockAPIFromResponse,
} from './prompt.service';
