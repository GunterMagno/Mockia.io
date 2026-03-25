import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authenticateToken';
import { asyncHandler } from '../middlewares/errorHandler';
import { createProject, getUserProjects, getProjectById } from '../services/project.service';
import type { CreateProjectRequest } from '@mockia/shared';

/**
 * Controller for projects
 * Handles HTTP requests and responses for project endpoints
 */

/**
 * POST /api/projects
 * Creates a new project with the authenticated user as owner
 *
 * Body parameters:
 * - title (required): Project title
 * - description (optional): Project description
 *
 * @param req - Authenticated request with user info
 * @param res - Express response
 * @returns 201 with created project
 */
export const createProjectHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    const createRequest: CreateProjectRequest = req.body;
    const project = await createProject(userId, createRequest);

    res.status(201).json({
      success: true,
      data: project,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * GET /api/projects
 * Lists all projects where the authenticated user is a member
 *
 * @param req - Authenticated request with user info
 * @param res - Express response
 * @returns 200 with list of projects
 */
export const getUserProjectsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    const projects = await getUserProjects(userId);

    res.status(200).json({
      success: true,
      data: projects,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * GET /api/projects/:id
 * Retrieves a specific project by ID
 * User must be a member of the project to access it
 *
 * @param req - Authenticated request with user info and params
 * @param res - Express response
 * @returns 200 with project details
 * @throws 404 if project not found
 * @throws 403 if user doesn't have access
 */
export const getProjectByIdHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    const { id } = req.params;
    const project = await getProjectById(id, userId);

    res.status(200).json({
      success: true,
      data: project,
      timestamp: new Date().toISOString(),
    });
  }
);
