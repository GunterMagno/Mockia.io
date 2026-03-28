import { Router } from 'express';
import {
  createProjectHandler,
  getUserProjectsHandler,
  getProjectByIdHandler,
  updateProjectHandler,
  archiveProjectHandler,
  cleanupArchivedProjectsHandler,
  addProjectMemberHandler,
  removeProjectMemberHandler,
} from '../controllers/projects.controller';
import { authenticateToken } from '../middlewares/authenticateToken';
import { authorizeRole } from '../middlewares/authorizeRole';
import { validate } from '../middlewares/validateRequest';
import { createProjectSchema, updateProjectSchema, addProjectMemberSchema } from '../validation/projects.validation';
import type { ProjectRole } from '@mockia/shared';

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
 * POST /api/projects/cleanup-archived
 * Manually executes cleanup of archived projects older than 30 days
 *
 * Authentication: Required (JWT Bearer token)
 *
 * Middleware stack:
 * 1. authenticateToken - Verifies JWT and attaches user info
 * 2. cleanupArchivedProjectsHandler - Controller
 *
 * Note: Normally runs automatically daily at 3 AM
 * This endpoint allows manual execution for testing/admin purposes
 *
 * Responses:
 * - 200: Success with count of deleted projects
 * - 401: Missing or invalid token
 */
projectsRouter.post(
  '/cleanup-archived',
  authenticateToken,
  cleanupArchivedProjectsHandler
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

/**
 * PUT /api/projects/:id
 * Updates a project's title and/or description
 *
 * Authentication: Required (JWT Bearer token)
 * Authorization: User must be the project owner
 *
 * Middleware stack:
 * 1. authenticateToken - Verifies JWT and attaches user info
 * 2. validate - Validates request body against schema
 * 3. updateProjectHandler - Controller
 *
 * URL parameters:
 * - id: Project ID (MongoDB ObjectId)
 *
 * Request body:
 * {
 *   "title": "Updated Title",
 *   "description": "Updated description"
 * }
 *
 * Responses:
 * - 200: Updated project
 * - 400: Validation error
 * - 401: Missing or invalid token
 * - 403: User is not the project owner
 * - 404: Project not found
 */
projectsRouter.put(
  '/:id',
  authenticateToken,
  validate({ body: updateProjectSchema }),
  updateProjectHandler
);

/**
 * DELETE /api/projects/:id
 * Archives a project (soft-delete)
 *
 * Authentication: Required (JWT Bearer token)
 * Authorization: User must be the project owner
 *
 * Middleware stack:
 * 1. authenticateToken - Verifies JWT and attaches user info
 * 2. archiveProjectHandler - Controller
 *
 * URL parameters:
 * - id: Project ID (MongoDB ObjectId)
 *
 * Responses:
 * - 204: Project archived successfully (no content)
 * - 401: Missing or invalid token
 * - 403: User is not the project owner
 * - 404: Project not found
 */
projectsRouter.delete(
  '/:id',
  authenticateToken,
  archiveProjectHandler
);

/**
 * POST /api/projects/:id/members
 * Adds a new member to a project with specified role
 *
 * Authentication: Required (JWT Bearer token)
 * Authorization: User must be the project owner
 *
 * Middleware stack:
 * 1. authenticateToken - Verifies JWT and attaches user info
 * 2. authorizeRole(['OWNER']) - Checks if user is project owner
 * 3. validate - Validates request body against schema
 * 4. addProjectMemberHandler - Controller
 *
 * URL parameters:
 * - id: Project ID (MongoDB ObjectId)
 *
 * Request body:
 * {
 *   "targetEmail": "user@example.com",
 *   "role": "EDITOR"
 * }
 *
 * Responses:
 * - 201: Member added successfully
 * - 400: Validation error or user already member
 * - 401: Missing or invalid token
 * - 403: User is not the project owner
 * - 404: Project or user not found
 */
projectsRouter.post(
  '/:id/members',
  authenticateToken,
  authorizeRole(['OWNER'] as unknown as ProjectRole[]),
  validate({ body: addProjectMemberSchema }),
  addProjectMemberHandler
);

/**
 * DELETE /api/projects/:id/members/:targetUserId
 * Removes a member from a project
 *
 * Authentication: Required (JWT Bearer token)
 * Authorization: User must be the project owner
 *
 * Middleware stack:
 * 1. authenticateToken - Verifies JWT and attaches user info
 * 2. authorizeRole(['OWNER']) - Checks if user is project owner
 * 3. removeProjectMemberHandler - Controller
 *
 * URL parameters:
 * - id: Project ID (MongoDB ObjectId)
 * - targetUserId: ID of member to remove
 *
 * Responses:
 * - 200: Member removed successfully
 * - 400: Cannot remove last owner
 * - 401: Missing or invalid token
 * - 403: User is not the project owner
 * - 404: Project or member not found
 */
projectsRouter.delete(
  '/:id/members/:targetUserId',
  authenticateToken,
  authorizeRole(['OWNER'] as unknown as ProjectRole[]),
  removeProjectMemberHandler
);

export default projectsRouter;
