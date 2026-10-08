/**
 * AI Controller
 * Handles HTTP requests for AI-related operations
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authenticateToken.js';
import { asyncHandler } from '../middlewares/errorHandler.js';
import { consumeAiQuota } from '../modules/ai/aiRateLimit.js';
import { parseAiProviders } from '../config/ai.js';
import { describeError } from '../utils/safeErrorLog.js';
import { getLlm, type LlmCompletion, type LlmRequest } from '../modules/ai/providers/index.js';
import { AppError } from '../middlewares/errorHandler.js';
import { ErrorCode } from '@mockia/shared';
import {
  buildPrompt,
  extractMockAPIFromResponse,
  runAIGenerationPipeline,
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

/**
 * POST /api/ai/generate-description
 * Generate a description for a mock endpoint using the configured LLM provider
 *
 * Body parameters:
 * - prompt (required): The system prompt/context
 * - userMessage (required): The user message to generate a response for
 * - temperature (optional): Model temperature (0-1)
 * - maxTokens (optional): Maximum tokens in response
 *
 * @param req - Authenticated request
 * @param res - Express response
 * @returns 200 with generated content
 */
export const generateDescriptionHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    await enforceAiRateLimit(userId, res);

    const { prompt, userMessage, temperature, maxTokens } = req.body;

    if (!prompt || !userMessage) {
      throw new AppError(
        'Both prompt and userMessage are required',
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    const { text: generatedContent } = await complete('generate-description', {
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userMessage },
      ],
      temperature: temperature ?? 0.7,
      maxTokens: maxTokens ?? 1000,
    });

    res.status(200).json({
      success: true,
      data: {
        generatedContent,
      },
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * POST /api/ai/generate-mock-data
 * Generate mock data for an API endpoint
 *
 * Body parameters:
 * - schema (required): API schema/interface description
 * - count (optional): Number of mock records to generate (default 1)
 *
 * @param req - Authenticated request
 * @param res - Express response
 * @returns 200 with generated mock data
 */
export const generateMockDataHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    await enforceAiRateLimit(userId, res);

    const { schema, count = 1 } = req.body;

    if (!schema) {
      throw new AppError(
        'Schema is required',
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    const prompt = `You are an expert at generating realistic mock data. 
    Generate ${count} JSON object(s) that match this schema. Return only valid JSON, no explanation.
    Schema: ${JSON.stringify(schema)}`;

    const userMessage = `Generate ${count} mock data object(s) for this schema.`;

    const { text: generatedData } = await complete('generate-mock-data', {
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.8, // More creative for data generation
      maxTokens: 2000,
      json: true,
    });

    // Parse the JSON response from the AI
    let parsedMockData;
    try {
      parsedMockData = JSON.parse(generatedData);
    } catch (error) {
      throw new AppError(
        'Generated data is not valid JSON',
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    res.status(200).json({
      success: true,
      data: {
        mockData: parsedMockData,
      },
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * POST /api/ai/generate-mock-api-spec
 * Generate a complete mock API specification based on project context
 * Uses Sprint 5: Prompt Engineering and Context Formatting
 *
 * Body parameters:
 * - projectId (required): The project ID to load GitHub context from
 * - requirement (required): Description of what the mock API should do
 * - temperature (optional): Model temperature (0-1), default 0.7
 * - maxTokens (optional): Maximum tokens in response, default 4000
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

    // Build prompt from project context and user requirement
    const messages = await buildPrompt(projectId, requirement);

    // Call the LLM provider chain with structured messages
    const completion = await complete('generate-mock-api-spec', {
      messages,
      temperature: req.body.temperature ?? 0.85,
      maxTokens: req.body.maxTokens ?? 5000,
      json: true,
    });
    const responseContent = completion.text;

    // Validate and extract the mock API specification
    const mockAPISpec = extractMockAPIFromResponse(responseContent);

    // Return the generated specification
    res.status(200).json({
      success: true,
      data: {
        specification: mockAPISpec,
        usage: usageOf(completion),
      },
      timestamp: new Date().toISOString(),
    });
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
 * - temperature (optional): Model temperature (0-1), default 0.7
 * - maxTokens (optional): Maximum tokens in response, default 4000
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

    try {
      // 1. Build prompt from project context
      console.log(`[AI] Starting generation for project ${projectId}`);
      const messages = await buildPrompt(projectId, requirement);
      console.log(`[AI] Prompt built with ${messages.length} messages`);

      // 2. Call the LLM provider chain
      const completion = await complete('generate-and-save', {
        messages,
        temperature: req.body.temperature ?? 0.85,
        maxTokens: req.body.maxTokens ?? 5000,
        json: true,
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

      // 5. Return complete result
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
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[AI] Error during generation (${describeError(error)})`);
      throw error;
    }
  }
);

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
