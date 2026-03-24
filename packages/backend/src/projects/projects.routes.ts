import { Router } from 'express';
import { listProjects } from './projects.controller';
import { authenticateToken } from '../middlewares/authenticateToken';

/**
 * Projects router
 * All routes in this router require authentication
 */
export const projectsRouter = Router();

/**
 * GET /api/projects
 * List all projects for the authenticated user
 * 
 * Middleware stack:
 * 1. authenticateToken - Verifies JWT and attaches user info
 * 2. listProjects - Controller
 * 
 * Responses:
 * - 200: List of projects
 * - 401: Missing or invalid token
 */
projectsRouter.get(
  '/',
  authenticateToken,
  listProjects
);

export default projectsRouter;
