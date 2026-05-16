/**
 * LLM Output Validator
 * Validates that the extracted JSON follows the expected structure
 * for generated API specifications
 */

import { MockAPIOutput, ErrorCode } from '@mockia/shared';
import { AppError } from '../../middlewares/errorHandler.js';

/**
 * Validates that the parsed object is a valid MockAPIOutput
 * 
 * Checks for:
 * - Required fields (apiVersion, title, description, endpoints, dataModels)
 * - Valid endpoint structure (method, path, schemas)
 * - Proper types for all fields
 * 
 * @param data - The parsed object to validate
 * @returns The validated and typed MockAPIOutput
 * @throws AppError if validation fails
 */
export function validateGeneratedApi(data: unknown): MockAPIOutput {
  // Type guard - check basic object structure
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AppError(
      'Expected AI output to be a JSON object',
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  const obj = data as Record<string, unknown>;

  // Validate required fields
  const requiredFields = ['apiVersion', 'title', 'description', 'endpoints', 'dataModels'];
  const missingFields = requiredFields.filter((field) => !(field in obj));

  if (missingFields.length > 0) {
    throw new AppError(
      `Missing required fields: ${missingFields.join(', ')}`,
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  // Validate field types
  if (typeof obj.apiVersion !== 'string') {
    throw new AppError(
      'apiVersion must be a string',
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  if (typeof obj.title !== 'string') {
    throw new AppError(
      'title must be a string',
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  if (typeof obj.description !== 'string') {
    throw new AppError(
      'description must be a string',
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  // Validate endpoints array
  if (!Array.isArray(obj.endpoints)) {
    throw new AppError(
      'endpoints must be an array',
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  if (obj.endpoints.length === 0) {
    throw new AppError(
      'endpoints array must not be empty',
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  // Validate each endpoint
  for (let i = 0; i < obj.endpoints.length; i++) {
    const endpoint = obj.endpoints[i];
    const endpointError = validateEndpoint(endpoint, i);
    if (endpointError) {
      throw endpointError;
    }
  }

  // Validate dataModels array
  if (!Array.isArray(obj.dataModels)) {
    throw new AppError(
      'dataModels must be an array',
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  // Validate each data model (optional but if present, should be valid)
  for (let i = 0; i < obj.dataModels.length; i++) {
    const model = obj.dataModels[i];
    if (!model || typeof model !== 'object') {
      throw new AppError(
        `dataModels[${i}] must be an object`,
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    const modelObj = model as Record<string, unknown>;
    if (typeof modelObj.name !== 'string') {
      throw new AppError(
        `dataModels[${i}].name must be a string`,
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    if (!modelObj.schema || typeof modelObj.schema !== 'object') {
      throw new AppError(
        `dataModels[${i}].schema must be an object`,
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }
  }

  return obj as unknown as MockAPIOutput;
}

/**
 * Validates a single endpoint object
 * 
 * @param endpoint - The endpoint to validate
 * @param index - The index in the endpoints array (for error messages)
 * @returns null if valid, AppError if invalid
 */
function validateEndpoint(endpoint: unknown, index: number): AppError | null {
  if (!endpoint || typeof endpoint !== 'object') {
    return new AppError(
      `endpoints[${index}] must be an object`,
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  const ep = endpoint as Record<string, unknown>;

  // Required fields
  if (typeof ep.path !== 'string') {
    return new AppError(
      `endpoints[${index}].path must be a string`,
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  if (typeof ep.method !== 'string') {
    return new AppError(
      `endpoints[${index}].method must be a string`,
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
  if (!validMethods.includes(ep.method)) {
    return new AppError(
      `endpoints[${index}].method must be one of: ${validMethods.join(', ')}`,
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  if (typeof ep.description !== 'string') {
    return new AppError(
      `endpoints[${index}].description must be a string`,
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  // Optional request/response schemas
  if (ep.requestSchema && typeof ep.requestSchema !== 'object') {
    return new AppError(
      `endpoints[${index}].requestSchema must be an object`,
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  if (ep.responseSchema && typeof ep.responseSchema !== 'object') {
    return new AppError(
      `endpoints[${index}].responseSchema must be an object`,
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  // Examples array
  if (ep.examples) {
    if (!Array.isArray(ep.examples)) {
      return new AppError(
        `endpoints[${index}].examples must be an array`,
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }
  }

  return null;
}
