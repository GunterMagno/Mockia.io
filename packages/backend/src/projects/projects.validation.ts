import Joi from 'joi';
import type { CreateProjectRequest } from '@mockia/shared';

/**
 * Validation schema for creating a project
 * Validates that the request body matches CreateProjectRequest
 */
export const createProjectSchema = Joi.object<CreateProjectRequest>({
  title: Joi.string()
    .min(1)
    .max(100)
    .required()
    .trim()
    .messages({
      'string.empty': 'Project title is required',
      'string.max': 'Project title cannot exceed 100 characters',
      'any.required': 'Project title is required',
    }),
  description: Joi.string()
    .max(500)
    .optional()
    .trim()
    .allow('')
    .messages({
      'string.max': 'Project description cannot exceed 500 characters',
    }),
});

/**
 * Validation schema for updating a project
 * Both title and description are optional
 */
export const updateProjectSchema = Joi.object({
  title: Joi.string()
    .min(1)
    .max(100)
    .optional()
    .trim()
    .messages({
      'string.empty': 'Project title cannot be empty',
      'string.max': 'Project title cannot exceed 100 characters',
    }),
  description: Joi.string()
    .max(500)
    .optional()
    .trim()
    .allow('')
    .messages({
      'string.max': 'Project description cannot exceed 500 characters',
    }),
});
