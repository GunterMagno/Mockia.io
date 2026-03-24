import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authenticateToken';
import { asyncHandler } from '../middlewares/errorHandler';

/**
 * Controller for projects
 * Example of a protected route controller
 */

/**
 * GET /api/projects
 * List projects for the authenticated user
 * 
 * @param req - Authenticated request with user info
 * @param res - Express response
 * @returns 200 with list of projects (example data)
 */
export const listProjects = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;

    // Example response
    const projects = [
      {
        id: 'project-1',
        name: 'Mock API v1',
        userId,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'project-2',
        name: 'Mock API v2',
        userId,
        createdAt: new Date().toISOString(),
      },
    ];

    res.status(200).json({
      success: true,
      data: projects,
      timestamp: new Date().toISOString(),
    });
  }
);
