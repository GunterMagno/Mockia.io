import { GitHubContextModel } from '../models/GitHubContext.js';
import { ProjectModel } from '../models/Project.js';
import { AppError } from '../middlewares/errorHandler.js';
import { ErrorCode } from '@mockia/shared';
import type { GitHubContext } from '@mockia/shared';
import { parseGitHubUrl, cloneRepository } from './github.service.js';
import { extractContextForProject } from './contextExtractor.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Maps a MongoDB GitHubContextDocument to a GitHubContext DTO
 * Converts ObjectIds to strings and formats dates
 */
function mapContextToDTO(doc: any): GitHubContext {
  return {
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    repoUrl: doc.repoUrl,
    repoOwner: doc.repoOwner,
    repoName: doc.repoName,
    branch: doc.branch,
    summary: doc.summary,
    files: doc.files,
    stats: doc.stats,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Retrieves the GitHub context for a project
 * 
 * @param projectId - Project ID to retrieve context for
 * @returns The GitHub context DTO
 * @throws AppError 404 if context not found for the project
 */
export async function getProjectContext(
  projectId: string
): Promise<GitHubContext> {
  try {
    // Resolve project to get real ID
    let projectObjectId: string = projectId;
    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(projectId);
    
    if (!isValidObjectId) {
      const { ProjectModel } = await import('../models/Project.js');
      const project = await ProjectModel.findOne({ slug: projectId });
      if (!project) {
        throw new AppError('Project not found', ErrorCode.NOT_FOUND, 404);
      }
      projectObjectId = project._id.toString();
    }

    const context = await GitHubContextModel.findOne({
      projectId: projectObjectId,
    });

    if (!context) {
      throw new AppError(
        'No context found for this project',
        ErrorCode.NOT_FOUND,
        404
      );
    }

    return mapContextToDTO(context);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error('Error retrieving project context:', error);
    throw new AppError(
      'Failed to retrieve project context',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}

/**
 * Deletes the GitHub context for a project
 * 
 * @param projectId - Project ID
 * @returns The deleted GitHub context DTO
 * @throws AppError 404 if context not found
 */
export async function deleteProjectContext(
  projectId: string
): Promise<GitHubContext> {
  try {
    const context = await GitHubContextModel.findOneAndDelete({
      projectId,
    });

    if (!context) {
      throw new AppError(
        'No context found for this project',
        ErrorCode.NOT_FOUND,
        404
      );
    }

    return mapContextToDTO(context);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error('Error deleting project context:', error);
    throw new AppError(
      'Failed to delete project context',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}

/**
 * Complete workflow: clone, analyze, and store GitHub repository context
 * Handles cleanup of temporary files
 * 
 * @param projectId - Project ID to import repository into
 * @param repoUrl - GitHub repository URL
 * @param branch - Optional branch name
 * @returns The created GitHub context DTO
 * @throws AppError if any step fails
 */
export async function importAndAnalyzeRepository(
  projectId: string,
  repoUrl: string,
  branch?: string
): Promise<GitHubContext> {
  let repoPath: string | null = null;

  try {
    // Validate project exists (by ID or Slug)
    let project;
    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(projectId);
    if (isValidObjectId) {
      project = await ProjectModel.findById(projectId);
    }
    if (!project) {
      project = await ProjectModel.findOne({ slug: projectId });
    }

    if (!project) {
      throw new AppError(
        'Project not found',
        ErrorCode.NOT_FOUND,
        404
      );
    }

    const realProjectId = project._id.toString();

    // Parse and validate GitHub URL
    const parsedUrl = parseGitHubUrl(repoUrl);
    const finalBranch = branch || parsedUrl.branch;

    // Clone the repository
    console.log(`Cloning repository: ${parsedUrl.owner}/${parsedUrl.repo}`);
    repoPath = await cloneRepository(parsedUrl.owner, parsedUrl.repo, finalBranch);

    // Extract and analyze context
    console.log(`Extracting context for project ${realProjectId}`);
    const context = await extractContextForProject(realProjectId, repoPath, repoUrl);

    console.log(`Repository analyzed and context saved successfully`);
    return mapContextToDTO(context);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error('Error importing and analyzing repository:', error);
    throw new AppError(
      'Failed to import and analyze repository',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  } finally {
    // Always cleanup temporary repository files
    if (repoPath) {
      try {
        await fs.rm(repoPath, { recursive: true, force: true });
        console.log(`Cleaned up temporary repository: ${repoPath}`);
      } catch (cleanupError) {
        console.warn(`Failed to cleanup temporary repository: ${cleanupError}`);
      }
    }
  }
}
