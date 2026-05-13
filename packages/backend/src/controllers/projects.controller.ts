import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authenticateToken';
import { asyncHandler } from '../middlewares/errorHandler';
import { createProject, getUserProjects, getProjectById, updateProject, archiveProject, cleanupArchivedProjects, addProjectMember, removeProjectMember, importGitHubRepository, regenerateApiKey } from '../services/project.service';
import { getProjectContext, deleteProjectContext } from '../services/github-context.service';
import type { CreateProjectRequest, ImportGitHubRequest } from '@mockia/shared';

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

/**
 * PUT /api/projects/:id
 * Updates a project's title and/or description
 * Only the project owner can update
 *
 * @param req - Authenticated request with user info and params
 * @param res - Express response
 * @returns 200 with updated project
 * @throws 400 if validation fails
 * @throws 403 if user is not the owner
 * @throws 404 if project not found
 */
export const updateProjectHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    const { id } = req.params;
    const updateData = req.body;
    const project = await updateProject(id, userId, updateData);

    res.status(200).json({
      success: true,
      data: project,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * DELETE /api/projects/:id
 * Archives a project (soft-delete)
 * Only the project owner can archive
 *
 * @param req - Authenticated request with user info and params
 * @param res - Express response
 * @returns 204 No Content or 200 with archived project
 * @throws 403 if user is not the owner
 * @throws 404 if project not found
 */
export const archiveProjectHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    const { id } = req.params;
    const project = await archiveProject(id, userId);

    res.status(200).json({
      success: true,
      data: project,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * POST /api/projects/cleanup-archived
 * Manually executes the cleanup of archived projects older than 30 days
 * (Normally runs automatically daily at 3 AM)
 *
 * @param req - Authenticated request
 * @param res - Express response
 * @returns 200 with count of deleted projects
 */
export const cleanupArchivedProjectsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const deletedCount = await cleanupArchivedProjects();

    res.status(200).json({
      success: true,
      data: {
        deletedCount,
        message: `${deletedCount} archived project(s) permanently deleted`,
      },
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * POST /api/projects/:id/members
 * Adds a new member to a project with specified role
 * Only the project owner can invite members
 *
 * Body parameters:
 * - targetEmail (required): Email of user to invite
 * - role (required): Member role (OWNER, EDITOR, VIEWER)
 *
 * @param req - Authenticated request with user info and params
 * @param res - Express response
 * @returns 201 with updated project
 * @throws 400 if validation fails or user already member
 * @throws 403 if user is not the owner
 * @throws 404 if project or target user not found
 */
export const addProjectMemberHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    const { id } = req.params;
    const { targetEmail, role } = req.body;

    const project = await addProjectMember(id, userId, targetEmail, role);

    res.status(201).json({
      success: true,
      data: project,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * DELETE /api/projects/:id/members/:targetUserId
 * Removes a member from a project
 * Only the project owner can remove members
 * Cannot remove the last owner of a project
 *
 * @param req - Authenticated request with user info and params
 * @param res - Express response
 * @returns 200 with updated project
 * @throws 400 if trying to remove last owner
 * @throws 403 if user is not the owner
 * @throws 404 if project or member not found
 */
export const removeProjectMemberHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    const { id, targetUserId } = req.params;
    const project = await removeProjectMember(id, userId, targetUserId);

    res.status(200).json({
      success: true,
      data: project,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * POST /api/projects/:id/import/github
 * Imports a GitHub repository to a project
 * Only the project owner can import repositories
 *
 * Body parameters:
 * - url (required): GitHub repository URL
 * - branch (optional): Specific branch to use
 *
 * @param req - Authenticated request with user info and params
 * @param res - Express response
 * @returns 200 with updated project containing GitHub repository information
 * @throws 400 if validation fails or invalid GitHub URL
 * @throws 403 if user is not the owner
 * @throws 404 if project not found
 */
export const importGitHubRepositoryHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    const { id } = req.params;
    const importRequest: ImportGitHubRequest = req.body;
    const project = await importGitHubRepository(id, userId, importRequest);

    res.status(200).json({
      success: true,
      data: project,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * GET /api/projects/:id/context
 * Retrieves the GitHub context for a project
 * User must be a member of the project to access it
 *
 * @param req - Authenticated request with user info and params
 * @param res - Express response
 * @returns 200 with GitHub context details
 * @throws 401 if not authenticated
 * @throws 403 if user is not a member of the project
 * @throws 404 if project not found or no context imported
 */
export const getProjectContextHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    const { id } = req.params;

    // Verify user has access to the project
    await getProjectById(id, userId);

    // Get the context
    const context = await getProjectContext(id);

    res.status(200).json({
      success: true,
      data: context,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * DELETE /api/projects/:id/context
 * Deletes the GitHub context for a project
 * Only the project owner can delete context
 *
 * @param req - Authenticated request with user info and params
 * @param res - Express response
 * @returns 200 with deleted context details
 * @throws 401 if not authenticated
 * @throws 403 if user is not the project owner
 * @throws 404 if project not found or no context exists
 */
export const deleteProjectContextHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    const { id } = req.params;

    // Verify user is the project owner
    const project = await getProjectById(id, userId);
    if (project.ownerId !== userId) {
      throw new Error('Only project owner can delete context');
    }

    // Delete the context
    const context = await deleteProjectContext(id);

    res.status(200).json({
      success: true,
      data: context,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * POST /api/projects/:id/regenerate-api-key
 * Regenerates the API Key for a project
 * Only project owners and editors can regenerate
 * 
 * @param req - Authenticated request with user info and params
 * @param res - Express response
 * @returns 200 with new API key
 * @throws 401 if not authenticated
 * @throws 403 if user is not the project owner
 * @throws 404 if project not found or no context exists
 */

export const regenerateApiKeyHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    const { id } = req.params;
    const project = await regenerateApiKey(id, userId);

    res.status(200).json({
      success: true,
      data: project,
      timestamp: new Date().toISOString(),
    });
  }
);
