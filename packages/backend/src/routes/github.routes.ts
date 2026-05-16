import { Router } from 'express';
import {
  parseGithubUrl,
  ingestGithubRepo,
} from '../controllers/github.controller.js';
import {
  parseGithubUrlSchema,
  ingestGithubRepoSchema,
} from '../validation/github.validation.js';
import { validate } from '../middlewares/validateRequest.js';
import { authenticateToken } from '../middlewares/authenticateToken.js';
import { authorizeRole } from '../middlewares/authorizeRole.js';

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
