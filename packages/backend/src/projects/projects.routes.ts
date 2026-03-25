import { Router } from 'express';
import {
  createProjectHandler,
  getUserProjectsHandler,
  getProjectByIdHandler,
} from './projects.controller';
import { authenticateToken } from '../middlewares/authenticateToken';
import { validate } from '../middlewares/validateRequest';
import { createProjectSchema } from './projects.validation';

/**
 * Projects router
 * All routes in this router require authentication
 *
 * Routes:
 * - POST   /          Create a new project
 * - GET    /          List user's projects
 * - GET    /:id       Get a specific project
 */
export const projectsRouter = Router();

/**
 * POST /api/projects
 * Creates a new project
 *
 * Authentication: Required (JWT Bearer token)
 * Validation: Body must match CreateProjectRequest
 *
 * Middleware stack:
 * 1. authenticateToken - Verifies JWT and attaches user info
 * 2. validate - Validates request body against schema
 * 3. createProjectHandler - Controller
 *
 * Request body:
 * {
 *   "title": "My Project",
 *   "description": "Optional description"
 * }
 *
 * Responses:
 * - 201: Project created successfully
 * - 400: Invalid input data (validation error)
 * - 401: Missing or invalid token
 */
projectsRouter.post(
  '/',
  authenticateToken,
  validate({ body: createProjectSchema }),
  createProjectHandler
);

/**
 * GET /api/projects
 * Lists all projects where the user is a member
 *
 * Authentication: Required (JWT Bearer token)
 *
 * Middleware stack:
 * 1. authenticateToken - Verifies JWT and attaches user info
 * 2. getUserProjectsHandler - Controller
 *
 * Responses:
 * - 200: List of projects
 * - 401: Missing or invalid token
 */
projectsRouter.get(
  '/',
  authenticateToken,
  getUserProjectsHandler
);

/**
 * GET /api/projects/:id
 * Retrieves a specific project by ID
 *
 * Authentication: Required (JWT Bearer token)
 * Authorization: User must be a member of the project
 *
 * Middleware stack:
 * 1. authenticateToken - Verifies JWT and attaches user info
 * 2. getProjectByIdHandler - Controller
 *
 * URL parameters:
 * - id: Project ID (MongoDB ObjectId)
 *
 * Responses:
 * - 200: Project details
 * - 401: Missing or invalid token
 * - 403: User is not a member of the project
 * - 404: Project not found
 */
projectsRouter.get(
  '/:id',
  authenticateToken,
  getProjectByIdHandler
);

export default projectsRouter;
