import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authenticateToken';
import { ProjectModel } from '../models/Project';
import { AppError } from './errorHandler';
import { ErrorCode } from '@mockia/shared';
import type { ProjectRole } from '@mockia/shared';

/**
 * Middleware factory to check if user has required role in a project
 * 
 * Usage:
 * router.post('/projects/:id/members', authenticateToken, authorizeRole(['OWNER']), handler);
 * 
 * @param allowedRoles - Array of roles that are allowed to access this endpoint
 * @returns Middleware function that checks user's role in the project
 */
export function authorizeRole(allowedRoles: ProjectRole[]) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?.id;
      const projectId = req.params.id;

      if (!userId) {
        throw new AppError(
          'User ID not found in request',
          ErrorCode.UNAUTHORIZED,
          401
        );
      }

      if (!projectId) {
        throw new AppError(
          'Project ID not found in request',
          ErrorCode.VALIDATION_ERROR,
          400
        );
      }

      // Find the project
      const project = await ProjectModel.findById(projectId);

      if (!project) {
        throw new AppError(
          'Project not found',
          ErrorCode.NOT_FOUND,
          404
        );
      }

      // Find user in project members
      const member = project.members.find(
        (m) => m.userId.toString() === userId
      );

      if (!member) {
        throw new AppError(
          'You are not a member of this project',
          ErrorCode.FORBIDDEN,
          403
        );
      }

      // Check if user's role is in allowed roles (normalize to uppercase for comparison)
      const normalizedRole = String(member.role).toUpperCase() as any;
      if (!allowedRoles.includes(normalizedRole)) {
        throw new AppError(
          `Your role '${member.role}' does not have permission to perform this action. Required: ${allowedRoles.join(' or ')}`,
          ErrorCode.FORBIDDEN,
          403
        );
      }

      // User has required role, proceed
      next();
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
          timestamp: new Date().toISOString(),
        });
      } else {
        res.status(500).json({
          success: false,
          error: {
            code: ErrorCode.INTERNAL_SERVER_ERROR,
            message: 'Internal server error',
          },
          timestamp: new Date().toISOString(),
        });
      }
    }
  };
}
