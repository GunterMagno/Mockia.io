import Joi from 'joi';

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
    .min(8)
    .required()
    .messages({
      'string.min': 'New password must be at least 8 characters',
      'any.required': 'New password is required',
    }),
}).unknown(true);
