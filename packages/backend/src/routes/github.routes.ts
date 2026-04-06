import { Router } from 'express';
import {
  parseGithubUrl,
  ingestGithubRepo,
  importFromGitHub,
  getProjectContextHandler,
  deleteProjectContextHandler,
} from '../controllers/github.controller';
import {
  parseGithubUrlSchema,
  ingestGithubRepoSchema,
  importGitHubSchema,
} from '../validation/github.validation';
import { validate } from '../middlewares/validateRequest';
import { authenticateToken } from '../middlewares/authenticateToken';
import { authorizeRole } from '../middlewares/authorizeRole';

/**
 * GitHub router
 * Handles GitHub repository ingestion and analysis
 *
 * Routes:
 * - POST /api/github/parse - Parse a GitHub URL
 * - POST /api/github/ingest - Clone and analyze a GitHub repository
 */

export const githubRouter = Router();

/**
 * POST /api/github/parse
 * Parses a GitHub URL without cloning the repository
 *
 * Validations:
 * - url: required, must be a valid URL
 *
 * Responses:
 * - 200: URL parsed successfully, returns owner, repo, and optional branch
 * - 400: Invalid input data
 */
githubRouter.post(
  '/parse',
  validate({ body: parseGithubUrlSchema }),
  parseGithubUrl
);

/**
 * POST /api/github/ingest
 * Clones a GitHub repository and analyzes its structure
 *
 * Validations:
 * - url: required, must be a valid URL
 * - branch: optional, branch name to clone
 *
 * Responses:
 * - 200: Repository cloned and analyzed successfully, returns file analysis
 * - 400: Invalid input data
 * - 500: Repository not found or cloning failed
 */
githubRouter.post(
  '/ingest',
  validate({ body: ingestGithubRepoSchema }),
  ingestGithubRepo
);

/**
 * POST /api/projects/:id/import/github
 * Import GitHub repository context and store analysis in database
 * Requires authentication and project OWNER or EDITOR role
 *
 * Validations:
 * - repoUrl: required, must be a valid GitHub URL
 * - branch: optional, branch name to analyze
 *
 * Responses:
 * - 201: Context imported successfully
 * - 400: Invalid input data
 * - 401: Unauthorized
 * - 403: Insufficient permissions
 * - 404: Project not found
 */
githubRouter.post(
  '/projects/:id/import/github',
  authenticateToken,
  authorizeRole(['OWNER', 'EDITOR']),
  validate({ body: importGitHubSchema }),
  importFromGitHub
);

/**
 * GET /api/projects/:id/context
 * Retrieve stored GitHub context for a project
 * Requires authentication
 *
 * Responses:
 * - 200: Context retrieved successfully
 * - 401: Unauthorized
 * - 404: Project or context not found
 */
githubRouter.get('/projects/:id/context', authenticateToken, getProjectContextHandler);

/**
 * DELETE /api/projects/:id/context
 * Delete stored GitHub context for a project
 * Requires authentication and project OWNER or EDITOR role
 *
 * Responses:
 * - 200: Context deleted successfully
 * - 401: Unauthorized
 * - 403: Insufficient permissions
 * - 404: Project or context not found
 */
githubRouter.delete(
  '/projects/:id/context',
  authenticateToken,
  authorizeRole(['OWNER', 'EDITOR']),
  deleteProjectContextHandler
);
