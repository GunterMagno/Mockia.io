/**
 * LLM Output Parser
 * Extracts and cleans JSON from LLM responses that may include markdown
 * or other extraneous text
 */

import { AppError } from '../../middlewares/errorHandler.js';
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

  if (rawOutput.length > MAX_LLM_OUTPUT_CHARS) {
    throw new AppError('AI output too large', ErrorCode.VALIDATION_ERROR, 400);
  }

  const text = rawOutput.replace(/^﻿/, '').trim();

  // Candidatos en orden de preferencia: bloques markdown, objeto {..}, array [..], texto completo.
  // Antes solo se probaba UN candidato: un bloque de codigo no-JSON o un array rompian el parseo.
  const candidates: string[] = [];
  for (const m of text.matchAll(/```[a-zA-Z]*\s*([\s\S]*?)```/g)) candidates.push(m[1].trim());
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const first = text.indexOf(open);
    const last = text.lastIndexOf(close);
    if (first !== -1 && last > first) candidates.push(text.substring(first, last + 1));
  }
  candidates.push(text);

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      // Un primitivo suelto ("42", "true") no es una respuesta estructurada valida
      if (parsed !== null && typeof parsed === 'object') return parsed;
    } catch (error) {
      lastError = error;
    }
  }

  console.error('Failed to parse extracted JSON:', text.substring(0, 200));
  throw new AppError(
    `Failed to parse AI output as JSON: ${lastError instanceof Error ? lastError.message : 'no JSON object or array found'}`,
    ErrorCode.INTERNAL_SERVER_ERROR,
    500
  );
}

const MAX_LLM_OUTPUT_CHARS = 2_000_000;

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
