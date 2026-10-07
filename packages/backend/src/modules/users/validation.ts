import Joi from 'joi';
import { SUPPORTED_LOCALES } from '@mockia/shared';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../../services/password.service.js';

/**
 * Validation schema for updating user profile
 */
export const updateProfileSchema = Joi.object({
  username: Joi.string()
    .min(2)
    .max(80)
    .optional()
    .messages({
      'string.min': 'Username must be at least 2 characters',
      'string.max': 'Username cannot exceed 80 characters',
    }),
}).unknown(true);

/**
 * Validation schema for changing password
 */
export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string()
    .required()
    .messages({
      'any.required': 'Current password is required',
    }),
  newPassword: Joi.string()
    .min(PASSWORD_MIN_LENGTH)
    .max(PASSWORD_MAX_LENGTH)
    .required()
    .messages({
      'string.min': `New password must be at least ${PASSWORD_MIN_LENGTH} characters`,
      'string.max': `New password cannot exceed ${PASSWORD_MAX_LENGTH} characters`,
      'any.required': 'New password is required',
    }),
}).unknown(true);

/**
 * Validation schema for saving user preferences (strict: an unknown language is a 400, never silently ignored)
 */
export const updatePreferencesSchema = Joi.object({
  locale: Joi.string()
    .valid(...SUPPORTED_LOCALES)
    .required()
    .messages({
      'any.only': `Locale must be one of: ${SUPPORTED_LOCALES.join(', ')}`,
      'any.required': 'Locale is required',
      'string.base': `Locale must be one of: ${SUPPORTED_LOCALES.join(', ')}`,
    }),
});

/**
 * Validation schema for deleting the account: the password must be re-entered (no max length here, it is only compared).
 */
export const deleteAccountSchema = Joi.object({
  password: Joi.string().required().messages({
    'any.required': 'Password is required',
    'string.empty': 'Password is required',
    'string.base': 'Password is required',
  }),
}).unknown(false);
