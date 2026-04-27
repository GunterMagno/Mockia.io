/**
 * LLM Output Parser
 * Extracts and cleans JSON from LLM responses that may include markdown
 * or other extraneous text
 */

import { AppError } from '../../middlewares/errorHandler';
import { ErrorCode } from '@mockia/shared';

/**
 * Extracts JSON from LLM output that may be wrapped in markdown or contain extra text
 * 
 * Handles cases like:
 * - Pure JSON: {"key": "value"}
 * - Markdown wrapped: ```json\n{"key": "value"}\n```
 * - Text with JSON: "Here's the JSON: {...}"
 * 
 * @param rawOutput - The raw text output from the LLM
 * @returns Parsed JSON object
 * @throws AppError if JSON cannot be extracted or parsed
 */
export function extractJsonFromLLMOutput(rawOutput: string): unknown {
  if (!rawOutput || typeof rawOutput !== 'string') {
    throw new AppError(
      'Invalid input: expected non-empty string',
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  let jsonString = rawOutput.trim();

  // Try to extract JSON from markdown code blocks first
  const markdownMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (markdownMatch) {
    jsonString = markdownMatch[1].trim();
  } else {
    // Try to find JSON by looking for first { and last }
    const firstBrace = jsonString.indexOf('{');
    const lastBrace = jsonString.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonString = jsonString.substring(firstBrace, lastBrace + 1);
    }
  }

  // Attempt to parse the extracted JSON
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    // Log the problematic string for debugging
    console.error('Failed to parse extracted JSON:', jsonString.substring(0, 200));
    throw new AppError(
      `Failed to parse AI output as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}

/**
 * Safety wrapper that returns null instead of throwing if JSON extraction fails
 * Useful for non-critical parsing attempts
 * 
 * @param rawOutput - The raw text output from the LLM
 * @returns Parsed JSON object or null if parsing failed
 */
export function tryExtractJsonFromLLMOutput(rawOutput: string): unknown | null {
  try {
    return extractJsonFromLLMOutput(rawOutput);
  } catch {
    return null;
  }
}
