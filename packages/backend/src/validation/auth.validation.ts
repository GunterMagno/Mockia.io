import Joi from 'joi';
import { CreateUserRequest } from '@mockia/shared';

/**
 * Validation schema for user registration
 * Validates that the request body matches CreateUserRequest
 */
export const registerSchema = Joi.object<CreateUserRequest>({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Email must be valid',
      'any.required': 'Email is required',
    }),
  password: Joi.string()
    .min(8)
    .required()
    .messages({
      'string.min': 'Password must be at least 8 characters',
      'any.required': 'Password is required',
    }),
  username: Joi.string()
    .min(2)
    .max(80)
    .required()
    .messages({
      'string.min': 'Username must be at least 2 characters',
      'string.max': 'Username cannot exceed 80 characters',
      'any.required': 'Username is required',
    })
});

/**
 * Schema for login validation
 * (Useful for future authentication routes)
 */
export const loginSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Email must be valid',
      'any.required': 'Email is required',
    }),
  password: Joi.string()
    .required()
    .messages({
      'any.required': 'Password is required',
    }),
});

/**
 * Schema for refresh token validation
 * Validates refresh token is provided
 */
export const refreshSchema = Joi.object({
  refreshToken: Joi.string()
    .required()
    .messages({
      'any.required': 'Refresh token is required',
      'string.empty': 'Refresh token cannot be empty',
    }),
});
