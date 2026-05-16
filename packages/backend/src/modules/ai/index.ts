/**
 * AI Module - Prompt Engineering and Context Management
 * 
 * This module handles:
 * - System prompt definition for AI instruction
 * - Prompt building and context integration
 * - Response validation and extraction
 * - LLM output parsing and validation
 * - End-to-end AI generation pipeline
 */

export { SYSTEM_PROMPT } from './systemPrompt.js';
export { type MockAPIOutput } from '@mockia/shared';
export {
  buildPrompt,
  validateJsonResponse,
  extractMockAPIFromResponse,
} from './prompt.service.js';
export {
  extractJsonFromLLMOutput,
  tryExtractJsonFromLLMOutput,
} from './llmOutputParser.js';
export { validateGeneratedApi } from './llmOutputValidator.js';
export {
  runAIGenerationPipeline,
  tryRunAIGenerationPipeline,
  type AIGenerationPipelineResult,
} from './aiGenerationPipeline.js';
