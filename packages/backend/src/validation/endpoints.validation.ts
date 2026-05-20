import Joi from 'joi';

/**
 * Validation schema for creating a new endpoint
 */
export const createEndpointSchema = Joi.object({
  path: Joi.string()
    .pattern(/^\//)
    .optional()
    .trim()
    .messages({
      'string.pattern.base': 'Endpoint path must start with a forward slash "/"',
    }),
  method: Joi.string()
    .valid('GET', 'POST', 'PUT', 'DELETE', 'PATCH')
    .optional()
    .messages({
      'any.only': 'Method must be one of: GET, POST, PUT, DELETE, PATCH',
    }),
  description: Joi.string()
    .max(500)
    .optional()
    .trim()
    .allow('')
    .messages({
      'string.max': 'Description cannot exceed 500 characters',
    }),
});

/**
 * Validation schema for updating an existing endpoint
 */
export const updateEndpointSchema = Joi.object({
  path: Joi.string()
    .pattern(/^\//)
    .optional()
    .trim()
    .messages({
      'string.pattern.base': 'Endpoint path must start with a forward slash "/"',
    }),
  method: Joi.string()
    .valid('GET', 'POST', 'PUT', 'DELETE', 'PATCH')
    .optional()
    .messages({
      'any.only': 'Method must be one of: GET, POST, PUT, DELETE, PATCH',
    }),
  description: Joi.string()
    .max(500)
    .optional()
    .trim()
    .allow('')
    .messages({
      'string.max': 'Description cannot exceed 500 characters',
    }),
  requestSchema: Joi.object()
    .optional()
    .allow(null),
  responseBody: Joi.any()
    .optional()
    .allow(null),
  statusCode: Joi.number()
    .integer()
    .min(100)
    .max(599)
    .optional()
    .messages({
      'number.min': 'HTTP status code must be at least 100',
      'number.max': 'HTTP status code cannot exceed 599',
    }),
  delay_ms: Joi.number()
    .integer()
    .min(0)
    .max(10000)
    .optional()
    .messages({
      'number.min': 'Delay must be at least 0 ms',
      'number.max': 'Delay cannot exceed 10000 ms (10 seconds)',
    }),
  force_status_code: Joi.number()
    .integer()
    .min(0)
    .max(599)
    .optional()
    .allow(null, 0)
    .messages({
      'number.min': 'Forced HTTP status code must be at least 0',
      'number.max': 'Forced HTTP status code cannot exceed 599',
    }),
});
