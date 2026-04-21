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

export { SYSTEM_PROMPT } from './systemPrompt';
export { type MockAPIOutput } from '@mockia/shared';
export {
  buildPrompt,
  validateJsonResponse,
  extractMockAPIFromResponse,
} from './prompt.service';
export {
  extractJsonFromLLMOutput,
  tryExtractJsonFromLLMOutput,
} from './llmOutputParser';
export { validateGeneratedApi } from './llmOutputValidator';
export {
  runAIGenerationPipeline,
  tryRunAIGenerationPipeline,
  type AIGenerationPipelineResult,
} from './aiGenerationPipeline';
