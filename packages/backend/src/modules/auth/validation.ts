import Joi from 'joi';
import { CreateUserRequest } from '@mockia/shared';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../../services/password.service.js';

/** Password for NEW credentials (register, reset): 10 to 128 characters. Login never uses it. */
export const newPasswordRule = Joi.string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .required()
  .messages({
    'string.min': `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    'string.max': `Password cannot exceed ${PASSWORD_MAX_LENGTH} characters`,
    'string.base': 'Password must be a string',
    'any.required': 'Password is required',
  });

/** Language of the email we send ('en' | 'es' | 'zh'); anything else is treated as English by the mailer. */
const localeRule = Joi.string().max(10).optional();

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
  password: newPasswordRule,
  username: Joi.string()
    .min(2)
    .max(80)
    .required()
    .messages({
      'string.min': 'Username must be at least 2 characters',
      'string.max': 'Username cannot exceed 80 characters',
      'any.required': 'Username is required',
    }),
  locale: localeRule,
});

/**
 * Schema for login validation
 * (Useful for future authentication routes)
 */
export const loginSchema = Joi.object({
  email: Joi.string()
    .required()
    .messages({
      'any.required': 'Email or Username is required',
    }),
  password: Joi.string()
    .required()
    .messages({
      'any.required': 'Password is required',
    }),
  // "Remember me": decides whether the refresh cookie outlives the browser session (7 d) or not
  remember: Joi.boolean()
    .optional()
    .messages({
      'boolean.base': 'Remember must be true or false',
    }),
});

/** POST /auth/forgot */
export const forgotSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Email must be valid',
      'string.empty': 'Email is required',
      'any.required': 'Email is required',
    }),
  locale: localeRule,
});

/** POST /auth/reset */
export const resetSchema = Joi.object({
  token: Joi.string()
    .max(200)
    .required()
    .messages({
      'string.empty': 'Token is required',
      'any.required': 'Token is required',
    }),
  password: newPasswordRule,
});

/** POST /auth/verify */
export const verifySchema = Joi.object({
  token: Joi.string()
    .max(200)
    .required()
    .messages({
      'string.empty': 'Token is required',
      'any.required': 'Token is required',
    }),
});

/** POST /auth/verify/resend (the body is optional: only the language of the email) */
export const resendSchema = Joi.object({
  locale: localeRule,
});

// No schemas for refresh / logout: the refresh token comes from the HttpOnly cookie, never from the body.
