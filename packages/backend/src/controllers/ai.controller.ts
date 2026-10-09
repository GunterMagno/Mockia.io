/**
 * AI Controller
 * Handles HTTP requests for AI-related operations
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authenticateToken.js';
import { asyncHandler } from '../middlewares/errorHandler.js';
import { consumeAiQuota } from '../modules/ai/aiRateLimit.js';
import { aiQuotaClock, reserveAiGeneration } from '../modules/billing/aiQuota.js';
import { parseAiProviders, getSpecGenerationSampling } from '../config/ai.js';
import { describeError } from '../utils/safeErrorLog.js';
import { getLlm, type LlmCompletion, type LlmRequest } from '../modules/ai/providers/index.js';
import { newGenerationId, persistGeneration } from '../modules/ai/generationStore.js';
import { recordFeedback } from '../modules/ai/feedback.js';
import { AppError } from '../middlewares/errorHandler.js';
import { ErrorCode } from '@mockia/shared';
import {
  buildPrompt,
  extractMockAPIFromResponse,
  extractJsonFromLLMOutput,
  validateGeneratedApi,
  runAIGenerationPipeline,
  MOCK_SPEC_JSON_SCHEMA,
} from '../modules/ai/index.js';

/**
 * Per-user limit on AI calls (AI_RATE_PER_MINUTE, default 20), kept in Mongo: it survives restarts and holds across
 * instances. Answers 429 with Retry-After; the other users are not affected.
 */
async function enforceAiRateLimit(userId: string, res: Response): Promise<void> {
  const quota = await consumeAiQuota(userId);
  if (quota.allowed) return;
  res.set('Retry-After', String(quota.retryAfterSeconds));
  throw new AppError(
    'Too many AI generation requests. Please wait a moment.',
    ErrorCode.RATE_LIMIT_ERROR,
    429
  );
}

/**
 * Monthly AI generation quota of the user's plan (modules/billing/aiQuota.ts). Reserves ONE generation before any model
 * is called. Spent: answers 429 AI_QUOTA_EXCEEDED itself (used, limit, resetsAt in the body, Retry-After = seconds to
 * the next UTC month) and returns null, so the caller stops without touching the LLM. Otherwise returns the `release`
 * function, which the caller invokes on EVERY failure path and never after a successful answer.
 */
async function reserveOrReject(userId: string, res: Response): Promise<(() => Promise<void>) | null> {
  const now = aiQuotaClock.now();
  const reservation = await reserveAiGeneration(userId, now);
  if (reservation.ok) return reservation.release;
  const retryAfter = Math.max(1, Math.ceil((reservation.resetsAt.getTime() - now.getTime()) / 1000));
  res.set('Retry-After', String(retryAfter));
  res.status(429).json({
    success: false,
    error: {
      code: ErrorCode.AI_QUOTA_EXCEEDED,
      message: `Monthly AI generation quota reached (${reservation.used} of ${reservation.limit}). It resets on ${reservation.resetsAt.toISOString()}.`,
      used: reservation.used,
      limit: reservation.limit,
      resetsAt: reservation.resetsAt.toISOString(),
    },
    timestamp: now.toISOString(),
  });
  return null;
}

/**
 * Runs one completion through the configured provider chain (local model first, OpenRouter as reserve, per
 * AI_PROVIDERS) and logs which provider answered. The log never carries the prompt or the answer.
 */
async function complete(operation: string, req: LlmRequest): Promise<LlmCompletion> {
  const result = await getLlm().complete(req);
  console.log(
    `[AI] ${operation} done provider=${result.provider} model=${result.model} ` +
      `inputTokens=${result.usage?.inputTokens ?? 'n/a'} outputTokens=${result.usage?.outputTokens ?? 'n/a'}`
  );
  return result;
}

/** Token usage in the shape the API has always returned (zeros when the provider does not report it). */
function usageOf(result: LlmCompletion) {
  const promptTokens = result.usage?.inputTokens ?? 0;
  const completionTokens = result.usage?.outputTokens ?? 0;
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

/** Content-free reasons the validators hand back to the model in a repair request (never quote the output). */
const NOT_JSON = 'the output is not valid JSON';
const WRONG_SHAPE = 'the JSON does not match the required schema (an object with apiVersion, title, description, endpoints and dataModels)';

/** Which content-free reason applies to a text the downstream step rejected. */
function invalidReason(text: string): string {
  try {
    extractJsonFromLLMOutput(text, { silent: true });
    return WRONG_SHAPE;
  } catch {
    return NOT_JSON;
  }
}

/** Validator of generate-mock-api-spec: exactly the parse the route applies to the answer (extractMockAPIFromResponse). */
export function specRouteValidator(text: string): string | null {
  try {
    extractMockAPIFromResponse(text);
    return null;
  } catch {
    return invalidReason(text);
  }
}

/** Validator of generate-and-save: exactly the pipeline's parse + validation (extractJsonFromLLMOutput + validateGeneratedApi). */
export function saveRouteValidator(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = extractJsonFromLLMOutput(text, { silent: true });
  } catch {
    return NOT_JSON;
  }
  try {
    validateGeneratedApi(parsed);
    return null;
  } catch {
    return WRONG_SHAPE;
  }
}

/**
 * POST /api/ai/generate-mock-api-spec
 * Generate a complete mock API specification based on project context
 * Uses Sprint 5: Prompt Engineering and Context Formatting
 *
 * Body parameters:
 * - projectId (required): The project ID to load GitHub context from
 * - requirement (required): Description of what the mock API should do
 * (temperature / maxTokens are no longer accepted from the client: AI_SPEC_TEMPERATURE, 5000 tokens)
 *
 * Response:
 * - apiVersion, title, description
 * - endpoints: Array of API endpoints with methods, paths, schemas, examples
 * - dataModels: Array of data models/interfaces
 *
 * @param req - Authenticated request with projectId in URL or body
 * @param res - Express response
 * @returns 200 with generated mock API specification (JSON)
 */
export const generateMockAPISpecHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    await enforceAiRateLimit(userId, res);

    const { projectId, requirement } = req.body;

    // Validation
    if (!projectId) {
      throw new AppError(
        'projectId is required',
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    if (!requirement) {
      throw new AppError(
        'Requirement is required (description of what the mock API should do)',
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    // One generation of the monthly plan quota, reserved BEFORE any prompt or model work; 429 when it is spent
    const release = await reserveOrReject(userId, res);
    if (!release) return;

    try {
      // Build prompt from project context and user requirement
      const messages = await buildPrompt(projectId, requirement);

      // Call the LLM provider chain with structured messages
      // Sampling is the server's (the validate middleware strips any client temperature / maxTokens)
      const completion = await complete('generate-mock-api-spec', {
        messages,
        ...getSpecGenerationSampling(),
        jsonSchema: MOCK_SPEC_JSON_SCHEMA,
        validate: specRouteValidator,
      });
      const responseContent = completion.text;

      // Validate and extract the mock API specification
      const mockAPISpec = extractMockAPIFromResponse(responseContent);

      // The id always goes back to the client (so it can rate the result); the content is stored only with consent
      const generationId = newGenerationId();
      await persistGeneration({
        generationId,
        userId,
        messages,
        output: responseContent,
        parsedOk: true,
        provider: completion.provider,
        model: completion.model,
      });

      // Return the generated specification. The reservation is kept: if the client has already disconnected, the model
      // did answer and the generation was paid for, so nothing is given back.
      res.status(200).json({
        success: true,
        data: {
          specification: mockAPISpec,
          usage: usageOf(completion),
          generationId,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Model error, invalid output after the repair retry, deadline (504), provider 502, anything: the user gets no result, so no charge
      await release();
      throw error;
    }
  }
);

/**
 * POST /api/ai/generate-and-save
 * Generate a complete mock API specification and save endpoints to database
 * Full end-to-end pipeline: generate -> parse -> validate -> save
 *
 * Body parameters:
 * - projectId (required): The project ID to load GitHub context from
 * - requirement (required): Description of what the mock API should do
 * (temperature / maxTokens are no longer accepted from the client: AI_SPEC_TEMPERATURE, 5000 tokens)
 *
 * Response:
 * - specification: Complete mock API specification
 * - databaseResult: Info about created endpoints and responses
 * - usage.totalTokens: Token usage reported by the provider
 *
 * @param req - Authenticated request
 * @param res - Express response
 * @returns 200 with generated specification and database info
 */
export const generateAndSaveHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    await enforceAiRateLimit(userId, res);

    const { projectId, requirement } = req.body;

    // Validation
    if (!projectId) {
      throw new AppError(
        'projectId is required',
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    if (!requirement) {
      throw new AppError(
        'requirement is required',
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    // One generation of the monthly plan quota, reserved BEFORE any prompt or model work; 429 when it is spent
    const release = await reserveOrReject(userId, res);
    if (!release) return;

    try {
      // 1. Build prompt from project context
      console.log(`[AI] Starting generation for project ${projectId}`);
      const messages = await buildPrompt(projectId, requirement);
      console.log(`[AI] Prompt built with ${messages.length} messages`);

      // 2. Call the LLM provider chain
      const completion = await complete('generate-and-save', {
        messages,
        ...getSpecGenerationSampling(),
        jsonSchema: MOCK_SPEC_JSON_SCHEMA,
        validate: saveRouteValidator,
      });

      // 3. Get response content (the provider already rejects empty answers)
      const responseContent = completion.text;
      console.log(`[AI] Received response (${responseContent.length} chars)`);

      // 4. Run the complete pipeline: parse -> validate -> save to database
      console.log('[AI] Running generation pipeline...');
      const pipelineResult = await runAIGenerationPipeline(
        projectId,
        responseContent,
        usageOf(completion)
      );

      console.log(
        `[AI] Pipeline completed: ${pipelineResult.databaseResult.endpointsCreated} endpoints created`
      );

      // 5. Id for the client's feedback; the content is stored only for users who consented
      const generationId = newGenerationId();
      await persistGeneration({
        generationId,
        userId,
        messages,
        output: responseContent,
        parsedOk: true,
        provider: completion.provider,
        model: completion.model,
      });

      // 6. Return complete result
      res.status(200).json({
        success: true,
        data: {
          specification: pipelineResult.specification,
          database: {
            mockApiId: pipelineResult.databaseResult.mockApiId,
            endpointsCreated: pipelineResult.databaseResult.endpointsCreated,
            responsesCreated: pipelineResult.databaseResult.responsesCreated,
          },
          usage: {
            totalTokens: pipelineResult.totalTokens,
          },
          generationId,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[AI] Error during generation (${describeError(error)})`);
      // Same rule as the spec route: any failure gives the reserved generation back (success keeps it)
      await release();
      throw error;
    }
  }
);

/**
 * POST /api/ai/feedback
 * Thumbs up/down on a generation (body validated by feedbackSchema). Accepted from every user; it carries content only
 * with consent (see modules/ai/feedback.ts). 204 with no body.
 */
export const feedbackHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new Error('User ID not found in request');
  }
  const { generationId, verdict, correctedOutput } = req.body;
  await recordFeedback(userId, generationId, verdict, correctedOutput);
  res.status(204).send();
});

/**
 * Health check for the AI integration (reports the configured provider chain, e.g. "local,openrouter")
 * GET /api/ai/health
 */
export const aiHealthCheckHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    res.status(200).json({
      success: true,
      data: {
        status: 'available',
        service: parseAiProviders(process.env.AI_PROVIDERS).providers.join(',') || 'none',
        timestamp: new Date().toISOString(),
      },
    });
  }
);
