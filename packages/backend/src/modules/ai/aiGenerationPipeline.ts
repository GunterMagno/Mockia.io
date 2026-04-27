/**
 * End-to-end AI Generation Pipeline
 * Orchestrates parser -> validator -> database population
 */

import {
  extractJsonFromLLMOutput,
  tryExtractJsonFromLLMOutput,
} from './llmOutputParser';
import { validateGeneratedApi } from './llmOutputValidator';
import { populateEndpointsFromLLM } from '../mock/mockPopulation.service';
import { MockAPIOutput } from '@mockia/shared';
import { AppError } from '../../middlewares/errorHandler';
import { ErrorCode } from '@mockia/shared';

/**
 * Result of the complete pipeline
 */
export interface AIGenerationPipelineResult {
  specification: MockAPIOutput;
  databaseResult: {
    mockApiId: string;
    endpointsCreated: number;
    responsesCreated: number;
  };
  totalTokens?: number;
  timestamp: string;
}

/**
 * Runs the complete AI generation pipeline:
 * 1. Extract JSON from raw LLM output
 * 2. Validate the structure
 * 3. Save endpoints to database
 * 4. Return the complete result
 * 
 * @param projectId - The project ID to save the mock API for
 * @param rawLLMOutput - The raw text response from the LLM
 * @param tokenUsage - Optional token usage statistics
 * @returns Complete result with specification and database info
 * @throws AppError if any step fails
 */
export async function runAIGenerationPipeline(
  projectId: string,
  rawLLMOutput: string,
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }
): Promise<AIGenerationPipelineResult> {
  try {
    // Step 1: Extract JSON from raw output
    console.log('[Pipeline] Step 1: Extracting JSON from LLM output...');
    const extractedJson = extractJsonFromLLMOutput(rawLLMOutput);
    console.log('[Pipeline] ✓ JSON extracted successfully');

    // Step 2: Validate the structure
    console.log('[Pipeline] Step 2: Validating API specification...');
    const specification = validateGeneratedApi(extractedJson);
    console.log(
      `[Pipeline] ✓ Validation passed - ${specification.endpoints.length} endpoints found`
    );

    // Step 3: Save to database
    console.log('[Pipeline] Step 3: Saving endpoints to database...');
    const databaseResult = await populateEndpointsFromLLM(
      projectId,
      specification
    );
    console.log(
      `[Pipeline] ✓ Database save successful - ${databaseResult.endpointsCreated} endpoints created`
    );

    // Return complete result
    return {
      specification,
      databaseResult: {
        mockApiId: databaseResult.mockApiId,
        endpointsCreated: databaseResult.endpointsCreated,
        responsesCreated: databaseResult.responsesCreated,
      },
      totalTokens: tokenUsage?.totalTokens,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[Pipeline] ✗ Pipeline failed:', error);
    throw error;
  }
}

/**
 * Safely runs the pipeline, returning null if any step fails
 * (instead of throwing)
 * 
 * Useful for non-critical generation attempts
 * 
 * @param projectId - The project ID
 * @param rawLLMOutput - The raw LLM output
 * @param tokenUsage - Optional token statistics
 * @returns Pipeline result or null if failed
 */
export async function tryRunAIGenerationPipeline(
  projectId: string,
  rawLLMOutput: string,
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }
): Promise<AIGenerationPipelineResult | null> {
  try {
    return await runAIGenerationPipeline(projectId, rawLLMOutput, tokenUsage);
  } catch (error) {
    console.error('AI Generation Pipeline failed:', error);
    return null;
  }
}
