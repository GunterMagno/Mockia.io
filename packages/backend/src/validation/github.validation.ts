import Joi from 'joi';

/**
 * Validation schema for GitHub URL parsing
 * Validates that the request body contains a valid GitHub URL
 */
export const parseGithubUrlSchema = Joi.object({
  url: Joi.string()
    .uri()
    .required()
    .messages({
      'string.uri': 'URL must be a valid GitHub URL',
      'any.required': 'URL is required',
    }),
});

/**
 * Validation schema for GitHub repository ingestion
 * Validates that the request body contains a valid GitHub URL and optional branch
 */
export const ingestGithubRepoSchema = Joi.object({
  url: Joi.string()
    .uri()
    .required()
    .messages({
      'string.uri': 'URL must be a valid GitHub URL',
      'any.required': 'URL is required',
    }),
  branch: Joi.string()
    .optional()
    .messages({
      'string.base': 'Branch must be a string',
    }),
});

/**
 * Validation schema for importing GitHub repository to a project
 * Validates GitHub URL and optional branch for project import
 */
export const importGitHubSchema = Joi.object({
  repoUrl: Joi.string()
    .uri()
    .required()
    .messages({
      'string.uri': 'Repository URL must be a valid GitHub URL',
      'any.required': 'Repository URL is required',
    }),
  branch: Joi.string()
    .optional()
    .messages({
      'string.base': 'Branch must be a string',
    }),
});
