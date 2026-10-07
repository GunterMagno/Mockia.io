import Joi from 'joi';
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
