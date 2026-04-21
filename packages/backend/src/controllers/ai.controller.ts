/**
 * AI Controller
 * Handles HTTP requests for AI-related operations
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authenticateToken';
import { asyncHandler } from '../middlewares/errorHandler';
import { generateWithOpenRouter, callOpenRouterWithRetry } from '../services/openRouter.service';
import { shouldRateLimit } from '../utils/openRouterUtils';
import { AppError } from '../middlewares/errorHandler';
import { ErrorCode } from '@mockia/shared';
import {
  buildPrompt,
  extractMockAPIFromResponse,
  runAIGenerationPipeline,
} from '../modules/ai';

/**
 * POST /api/ai/generate-description
 * Generate a description for a mock endpoint using OpenRouter
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

    // Client-side rate limiting check
    if (shouldRateLimit(60)) {
      throw new AppError(
        'Too many AI generation requests. Please wait a moment.',
        ErrorCode.RATE_LIMIT_ERROR,
        429
      );
    }

    const { prompt, userMessage, temperature, maxTokens } = req.body;

    if (!prompt || !userMessage) {
      throw new AppError(
        'Both prompt and userMessage are required',
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    const generatedContent = await generateWithOpenRouter(
      prompt,
      userMessage,
      {
        temperature: temperature ?? 0.7,
        max_tokens: maxTokens ?? 1000,
      }
    );

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

    if (shouldRateLimit(60)) {
      throw new AppError(
        'Too many AI generation requests. Please wait a moment.',
        ErrorCode.RATE_LIMIT_ERROR,
        429
      );
    }

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

    const generatedData = await generateWithOpenRouter(
      prompt,
      userMessage,
      {
        temperature: 0.8, // More creative for data generation
        max_tokens: 2000,
      }
    );

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

    // Rate limiting check
    if (shouldRateLimit(60)) {
      throw new AppError(
        'Too many AI generation requests. Please wait a moment.',
        ErrorCode.RATE_LIMIT_ERROR,
        429
      );
    }

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

    // Call OpenRouter API with structured messages
    const openRouterResponse = await callOpenRouterWithRetry(messages, {
      temperature: req.body.temperature ?? 0.7,
      max_tokens: req.body.maxTokens ?? 4000,
    });

    // Extract the generated content from response
    const responseContent = openRouterResponse.choices[0]?.message.content;
    if (!responseContent) {
      throw new AppError(
        'No response content from AI service',
        ErrorCode.INTERNAL_SERVER_ERROR,
        500
      );
    }

    // Validate and extract the mock API specification
    const mockAPISpec = extractMockAPIFromResponse(responseContent);

    // Return the generated specification
    res.status(200).json({
      success: true,
      data: {
        specification: mockAPISpec,
        usage: {
          promptTokens: openRouterResponse.usage.prompt_tokens,
          completionTokens: openRouterResponse.usage.completion_tokens,
          totalTokens: openRouterResponse.usage.total_tokens,
        },
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
 * - totalTokens: Token usage from OpenRouter
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

    // Rate limiting check
    if (shouldRateLimit(60)) {
      throw new AppError(
        'Too many AI generation requests. Please wait a moment.',
        ErrorCode.RATE_LIMIT_ERROR,
        429
      );
    }

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

    // 1. Build prompt from project context
    const messages = await buildPrompt(projectId, requirement);

    // 2. Call OpenRouter API
    const openRouterResponse = await callOpenRouterWithRetry(messages, {
      temperature: req.body.temperature ?? 0.7,
      max_tokens: req.body.maxTokens ?? 4000,
    });

    // 3. Get response content
    const responseContent = openRouterResponse.choices[0]?.message.content;
    if (!responseContent) {
      throw new AppError(
        'No response content from AI service',
        ErrorCode.INTERNAL_SERVER_ERROR,
        500
      );
    }

    // 4. Run the complete pipeline: parse -> validate -> save to database
    const pipelineResult = await runAIGenerationPipeline(
      projectId,
      responseContent,
      {
        promptTokens: openRouterResponse.usage.prompt_tokens,
        completionTokens: openRouterResponse.usage.completion_tokens,
        totalTokens: openRouterResponse.usage.total_tokens,
      }
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
  }
);

/**
 * Health check for OpenRouter integration
 * GET /api/ai/health
 */
export const aiHealthCheckHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    res.status(200).json({
      success: true,
      data: {
        status: 'available',
        service: 'openrouter',
        timestamp: new Date().toISOString(),
      },
    });
  }
);
