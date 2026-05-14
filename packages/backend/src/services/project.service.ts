import { ProjectModel } from '../models/Project';
import crypto from 'crypto';
import { UserModel } from '../models/User';
import { generateUniqueSlug } from '../utils/slugGenerator';
import { AppError } from '../middlewares/errorHandler';
import { ErrorCode } from '@mockia/shared';
import type { Project as ProjectDTO, CreateProjectRequest, ImportGitHubRequest, ProjectMember, ProjectRole } from '@mockia/shared';
import { ProjectRoleEnum } from '../models/Project';
import { parseGitHubUrl } from './github.service';
import { importAndAnalyzeRepository } from './github-context.service';
import { createNotification } from './notification.service';
import { NotificationType } from '@mockia/shared';

/**
 * Maps a MongoDB ProjectDocument to a ProjectDTO
 * Converts ObjectIds to strings and formats dates
 */
function mapProjectToDTO(doc: any): ProjectDTO {
  const ensureISO = (date: any) => {
    if (!date) return undefined;
    if (typeof date.toISOString === 'function') return date.toISOString();
    return new Date(date).toISOString();
  };

  return {
    id: doc._id.toString(),
    title: doc.title,
    description: doc.description,
    slug: doc.slug,
    ownerId: doc.ownerId.toString(),
    members: (doc.members || []).map(
      (m: any): ProjectMember => {
        const user = m.userId;
        const isPopulated = user && typeof user === 'object' && '_id' in user;
        
        return {
          userId: isPopulated ? user._id.toString() : (user?.toString() || ''),
          username: isPopulated ? (user.username || 'User') : 'User',
          email: isPopulated ? (user.email || '') : '',
          role: m.role.toUpperCase() as ProjectRole,
          addedAt: ensureISO(m.addedAt) || new Date().toISOString(),
        };
      }
    ),
    gitHubRepo: doc.gitHubRepo ? {
      owner: doc.gitHubRepo.owner,
      repo: doc.gitHubRepo.repo,
      branch: doc.gitHubRepo.branch,
      url: doc.gitHubRepo.url,
      importedAt: ensureISO(doc.gitHubRepo.importedAt) || new Date().toISOString(),
    } : undefined,
    apiKey: doc.apiKey,
    isArchived: doc.isArchived,
    archivedAt: ensureISO(doc.archivedAt),
    createdAt: ensureISO(doc.createdAt) || new Date().toISOString(),
    updatedAt: ensureISO(doc.updatedAt) || new Date().toISOString(),
  };
}

/**
 * Resolves a project by ID or Slug
 */
async function resolveProject(idOrSlug: string) {
  let project;
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(idOrSlug);
  const populateOptions = {
    path: 'members.userId',
    model: 'User'
  };

  if (isValidObjectId) {
    project = await ProjectModel.findById(idOrSlug).populate(populateOptions);
  }
  if (!project) {
    project = await ProjectModel.findOne({ slug: idOrSlug }).populate(populateOptions);
  }
  return project;
}

/**
 * Creates a new project with the authenticated user as owner
 * 
 * Flow:
 * 1. Validate input
 * 2. Generate unique slug from title
 * 3. Create project document with owner as the first member
 * 4. Save to database
 * 5. Map and return as DTO
 * 
 * @param ownerId - User ID of the project creator (from auth middleware)
 * @param createRequest - DTO with title and optional description
 * @returns Created project as DTO
 * @throws AppError if validation fails or database error occurs
 */
export async function createProject(
  ownerId: string,
  createRequest: CreateProjectRequest
): Promise<ProjectDTO> {
  const { title, description } = createRequest;

  if (!title || title.trim().length === 0) {
    throw new AppError(
      'Project title is required',
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  if (title.length > 100) {
    throw new AppError(
      'Project title cannot exceed 100 characters',
      ErrorCode.VALIDATION_ERROR,
      400
    );
  }

  try {
    // Generate unique slug and API Key
    const slug = await generateUniqueSlug(title);
    const apiKey = crypto.randomBytes(24).toString('hex');

    // Create project document with owner as initial member
    const projectDocument = new ProjectModel({
      title,
      description,
      slug,
      ownerId,
      apiKey,
      members: [
        {
          userId: ownerId,
          role: ProjectRoleEnum.OWNER,
          addedAt: new Date(),
        },
      ],
      isArchived: false,
    });

    // Save to database
    const savedProject = await projectDocument.save();
    await savedProject.populate('members.userId');

    // Create empty MockAPI associated with the project
    const { MockAPIModel } = await import('../models/MockAPI');
    try {
      await MockAPIModel.create({
        projectId: savedProject._id,
        title: savedProject.title,
        description: savedProject.description || '',
        endpoints: [],
        apiVersion: '1.0.0',
      });
    } catch (mockApiError) {
      console.error('Failed to create associated MockAPI, but project was saved:', mockApiError);
      // We don't throw here to avoid failing project creation if only secondary document fails
    }

    // Map and return
    return mapProjectToDTO(savedProject);
  } catch (error) {
    // If it's already an AppError, rethrow it
    if (error instanceof AppError) {
      throw error;
    }

    // For any other error, wrap it
    console.error('Error creating project:', error);
    throw new AppError(
      'Failed to create project',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}

/**
 * Retrieves all projects where the user is a member
 * 
 * Flow:
 * 1. Query database for projects where user is in members array
 * 2. Filter out archived projects (optional - can be removed for admin views)
 * 3. Sort by creation date (newest first)
 * 4. Map each document to ProjectDTO
 * 
 * @param userId - User ID to retrieve projects for
 * @returns Array of projects where user is a member
 * @throws AppError if database error occurs
 */
export async function getUserProjects(userId: string): Promise<ProjectDTO[]> {
  try {
    const projects = await ProjectModel.find({
      'members.userId': userId,
      isArchived: false,
    })
      .populate('members.userId')
      .sort({ createdAt: -1 })
      .lean();

    return projects.map(mapProjectToDTO);
  } catch (error) {
    console.error('Error retrieving user projects:', error);
    throw new AppError(
      'Failed to retrieve projects',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}

/**
 * Retrieves a specific project by ID, with access control
 * 
 * Flow:
 * 1. Find project by ID
 * 2. If not found, throw 404 error
 * 3. Check if user is a member of the project
 * 4. If not a member, throw 403 error
 * 5. Map and return the project
 * 
 * @param projectId - Project ID to retrieve
 * @param userId - User ID requesting access (for permission check)
 * @returns The project DTO
 * @throws AppError 404 if project not found
 * @throws AppError 403 if user doesn't have access
 */
export async function getProjectById(
  projectId: string,
  userId: string
): Promise<ProjectDTO> {
  try {
    const project = await resolveProject(projectId);

    // Check if project exists
    if (!project) {
      throw new AppError(
        'Project not found',
        ErrorCode.NOT_FOUND,
        404
      );
    }

    await project.populate('members.userId');

    // Check if user is a member
    const isMember = project.members.some(
      (member: any) => {
        const memberId = member.userId?._id ? member.userId._id.toString() : member.userId.toString();
        return memberId === userId;
      }
    );

    if (!isMember) {
      throw new AppError(
        'You do not have access to this project',
        ErrorCode.FORBIDDEN,
        403
      );
    }

    // Map and return
    return mapProjectToDTO(project);
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Error retrieving project:', error);
    throw new AppError('Failed to retrieve project', ErrorCode.INTERNAL_SERVER_ERROR, 500);
  }
}

/**
 * Updates a project's title and/or description
 * Only the project owner can update
 * 
 * Flow:
 * 1. Find project by ID
 * 2. If not found, throw 404 error
 * 3. Verify user is the owner
 * 4. If title changed, regenerate slug
 * 5. Update fields and save
 * 6. Return updated project as DTO
 * 
 * @param projectId - Project ID to update
 * @param userId - User ID requesting update (must be owner)
 * @param updateData - Object with fields to update (title?, description?)
 * @returns Updated project DTO
 * @throws AppError 404 if project not found
 * @throws AppError 403 if user is not the owner
 */
export async function updateProject(
  projectId: string,
  userId: string,
  updateData: { title?: string; description?: string }
): Promise<ProjectDTO> {
  try {
    const project = await resolveProject(projectId);

    // Check if project exists
    if (!project) {
      throw new AppError(
        'Project not found',
        ErrorCode.NOT_FOUND,
        404
      );
    }

    await project.populate('members.userId');

    // Verify user is the owner or editor
    const isOwner = project.ownerId.toString() === userId;
    const member = project.members.find(
      (m: any) => {
        const mId = (m.userId as any)._id ? (m.userId as any)._id.toString() : m.userId.toString();
        return mId === userId;
      }
    );
    const canEdit = isOwner || (member && (member.role === 'editor' || member.role === 'owner'));

    if (!canEdit) {
      throw new AppError(
        'Only the project owner and editors can update this project',
        ErrorCode.FORBIDDEN,
        403
      );
    }

    // Get the changer's username
    const changer = await UserModel.findById(userId);
    const changerName = changer ? changer.username : 'A collaborator';

    const oldTitle = project.title;
    const oldDescription = project.description;

    // Validate update data
    if (updateData.title !== undefined) {
      const trimmedTitle = updateData.title.trim();
      if (!trimmedTitle) {
        throw new AppError(
          'Project title is required',
          ErrorCode.VALIDATION_ERROR,
          400
        );
      }

      if (trimmedTitle.length > 100) {
        throw new AppError(
          'Project title cannot exceed 100 characters',
          ErrorCode.VALIDATION_ERROR,
          400
        );
      }

      // If title changed, regenerate slug
      if (trimmedTitle !== project.title) {
        project.slug = await generateUniqueSlug(trimmedTitle);
        project.title = trimmedTitle;
      }
    }

    if (updateData.description !== undefined) {
      const trimmedDesc = updateData.description.trim();
      if (trimmedDesc.length > 500) {
        throw new AppError(
          'Project description cannot exceed 500 characters',
          ErrorCode.VALIDATION_ERROR,
          400
        );
      }
      
      // Treat empty string same as null/undefined for comparison
      const currentDesc = project.description || '';
      if (trimmedDesc !== currentDesc) {
        project.description = trimmedDesc || undefined;
      }
    }

    const titleChanged = updateData.title !== undefined && updateData.title.trim() !== oldTitle;
    const descriptionChanged = updateData.description !== undefined && updateData.description.trim() !== (oldDescription || '');

    // Save and return
    const savedProject = await project.save();
    await savedProject.populate('members.userId');

    // Notify other members about the update (except the one who did it)
    if (titleChanged || descriptionChanged) {
      for (const member of savedProject.members) {
        const mId = (member.userId as any)._id ? (member.userId as any)._id.toString() : member.userId.toString();
        if (mId !== userId) {
          let title = 'Project Updated';
          let message = '';

          if (titleChanged && descriptionChanged) {
            title = 'Project Details Updated';
            message = `The project "${oldTitle}" has been renamed to "${project.title}" and its description was updated by ${changerName}.`;
          } else if (titleChanged) {
            title = 'Project Renamed';
            message = `The project "${oldTitle}" has been renamed to "${project.title}" by ${changerName}.`;
          } else if (descriptionChanged) {
            title = 'Description Updated';
            message = `${changerName} has updated the description of project "${project.title}".`;
          }

          await createNotification({
            userId: mId,
            type: NotificationType.PROJECT_UPDATE,
            title,
            message,
            link: `/editor/${project.slug}`,
            projectId: project._id.toString()
          }).catch(err => console.error('Failed to send update notification:', err));
        }
      }
    }

    return mapProjectToDTO(savedProject);
  } catch (error) {
    // If it's already an AppError, rethrow it
    if (error instanceof AppError) {
      throw error;
    }

    // For any other error, wrap it
    console.error('Error updating project:', error);
    throw new AppError(
      'Failed to update project',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}

/**
 * Archives a project (soft-delete)
 * Only the project owner can archive
 * Sets isArchived = true instead of deleting
 * 
 * Flow:
 * 1. Find project by ID
 * 2. If not found, throw 404 error
 * 3. Verify user is the owner
 * 4. Set isArchived = true
 * 5. Save and return updated project
 * 
 * @param projectId - Project ID to archive
 * @param userId - User ID requesting archive (must be owner)
 * @returns Archived project DTO
 * @throws AppError 404 if project not found
 * @throws AppError 403 if user is not the owner
 */
export async function archiveProject(
  projectId: string,
  userId: string
): Promise<ProjectDTO> {
  try {
    const project = await resolveProject(projectId);

    // Check if project exists
    if (!project) {
      throw new AppError(
        'Project not found',
        ErrorCode.NOT_FOUND,
        404
      );
    }

    // Verify user is the owner
    if (project.ownerId.toString() !== userId) {
      throw new AppError(
        'Only the project owner can archive this project',
        ErrorCode.FORBIDDEN,
        403
      );
    }

    // Set archived flag and save
    project.isArchived = true;
    project.archivedAt = new Date();
    // Save project
    await project.save();

    const populated = await resolveProject(project._id.toString());
    return mapProjectToDTO(populated!);
  } catch (error) {
    // If it's already an AppError, rethrow it
    if (error instanceof AppError) {
      throw error;
    }

    // For any other error, wrap it
    console.error('Error archiving project:', error);
    throw new AppError(
      'Failed to archive project',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}

/**
 * Permanently deletes a project and its associated MockAPI
 * Used for rollbacks when creation flow fails halfway
 */
export async function hardDeleteProject(projectId: string, userId: string): Promise<void> {
  try {
    const project = await ProjectModel.findById(projectId);
    if (!project) return;

    // Verify user is the owner
    if (project.ownerId.toString() !== userId) {
      throw new AppError('Only project owner can delete this project', ErrorCode.FORBIDDEN, 403);
    }

    // Delete project and MockAPI
    await ProjectModel.findByIdAndDelete(projectId);
    const { MockAPIModel } = await import('../models/MockAPI');
    await MockAPIModel.deleteMany({ projectId });
  } catch (error) {
    console.error('Error hard deleting project:', error);
    throw new AppError('Failed to delete project', ErrorCode.INTERNAL_SERVER_ERROR, 500);
  }
}

/**
 * Permanently deletes projects that have been archived for more than 30 days
 * This is a maintenance task that should be run periodically (e.g., daily)
 * 
 * Flow:
 * 1. Calculate date 30 days ago
 * 2. Find all projects where isArchived = true AND archivedAt is older than 30 days
 * 3. Delete those projects permanently
 * 4. Return count of deleted projects
 * 
 * @returns Number of projects permanently deleted
 * @throws AppError if database error occurs
 */
export async function cleanupArchivedProjects(): Promise<number> {
  try {
    // Calculate the cutoff date (30 days ago)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Find and delete projects archived more than 30 days ago
    const result = await ProjectModel.deleteMany({
      isArchived: true,
      archivedAt: { $lt: thirtyDaysAgo },
    });

    const deletedCount = result.deletedCount || 0;

    if (deletedCount > 0) {
      console.log(
        `Cleanup: Permanently deleted ${deletedCount} archived project(s) older than 30 days`
      );
    }

    return deletedCount;
  } catch (error) {
    console.error('Error cleaning up archived projects:', error);
    throw new AppError(
      'Failed to cleanup archived projects',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}

/**
 * Add a member to a project
 * Only owner can invite new members
 */
export async function addProjectMember(
  projectId: string,
  inviterUserId: string,
  targetEmail: string,
  role: ProjectRole
): Promise<ProjectDTO> {
  try {
    const project = await resolveProject(projectId);
    if (!project) {
      throw new AppError(
        'Project not found',
        ErrorCode.NOT_FOUND,
        404
      );
    }

    // Check permissions
    const inviterMember = project.members.find(m => {
      const mid = m.userId?._id ? m.userId._id.toString() : m.userId.toString();
      return mid === inviterUserId;
    });
    const inviterRole = String(inviterMember?.role).toUpperCase();
    if (!inviterMember || (inviterRole !== 'OWNER' && inviterRole !== 'EDITOR')) {
      throw new AppError(
        'Only project owners and editors can invite members',
        ErrorCode.FORBIDDEN,
        403
      );
    }

    // Find user by email
    const targetUser = await UserModel.findOne({ email: targetEmail });
    if (!targetUser) {
      throw new AppError(
        'User not found',
        ErrorCode.NOT_FOUND,
        404
      );
    }

    // Check if user is already a member
    const isAlreadyMember = project.members.some(m => {
      const mid = m.userId?._id ? m.userId._id.toString() : m.userId.toString();
      return mid === targetUser._id.toString();
    });

    if (isAlreadyMember) {
      throw new AppError(
        'User is already a member of this project',
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    // Add new member
    project.members.push({
      userId: targetUser._id,
      role: String(role).toLowerCase() as any,
      addedAt: new Date(),
    });

    // Save project
    await project.save();

    const updatedProject = await resolveProject(project._id.toString());

    // Send notification to the invited user
    await createNotification({
      userId: targetUser._id.toString(),
      type: NotificationType.PROJECT_INVITE,
      title: 'Project Invitation',
      message: `You have been invited to collaborate on "${project.title}" as ${role}.`,
      link: `/editor/${project.slug}`,
      projectId: project._id.toString()
    }).catch(err => console.error('Failed to send invite notification:', err));

    return mapProjectToDTO(updatedProject!);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error('Error adding project member:', error);
    throw new AppError(
      'Failed to add project member',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}

/**
 * Remove a member from a project
 * Only owner can remove members
 */
export async function removeProjectMember(
  projectId: string,
  removerUserId: string,
  targetUserId: string
): Promise<ProjectDTO> {
  try {
    const project = await resolveProject(projectId);
    if (!project) {
      throw new AppError(
        'Project not found',
        ErrorCode.NOT_FOUND,
        404
      );
    }

    // Check permissions
    const removerMember = project.members.find(m => {
      const mid = m.userId?._id ? m.userId._id.toString() : m.userId.toString();
      return mid === removerUserId;
    });
    const removerRole = String(removerMember?.role).toUpperCase();
    if (!removerMember || (removerRole !== 'OWNER' && removerRole !== 'EDITOR')) {
      throw new AppError(
        'Only project owners and editors can remove members',
        ErrorCode.FORBIDDEN,
        403
      );
    }

    // Find member to remove
    const targetMemberIndex = project.members.findIndex(m => {
      const mid = m.userId?._id ? m.userId._id.toString() : m.userId.toString();
      return mid === targetUserId;
    });

    if (targetMemberIndex === -1) {
      throw new AppError(
        'Member not found in project',
        ErrorCode.NOT_FOUND,
        404
      );
    }

    // Check if trying to remove the last owner
    const targetMember = project.members[targetMemberIndex];
    const targetRole = String(targetMember.role).toUpperCase();

    // Protection: Editors cannot remove owners
    if (removerRole === 'EDITOR' && targetRole === 'OWNER') {
      throw new AppError(
        'Editors cannot remove project owners',
        ErrorCode.FORBIDDEN,
        403
      );
    }

    if (targetRole === 'OWNER') {
      const ownerCount = project.members.filter((m) => String(m.role).toUpperCase() === 'OWNER').length;
      if (ownerCount === 1) {
        throw new AppError(
          'Cannot remove the last owner of a project',
          ErrorCode.VALIDATION_ERROR,
          400
        );
      }
    }

    // Remove member
    project.members.splice(targetMemberIndex, 1);

    // Save project
    await project.save();

    const updatedProject = await resolveProject(project._id.toString());

    // Send notification to the removed user
    await createNotification({
      userId: targetUserId,
      type: NotificationType.PROJECT_REMOVAL,
      title: 'Project Removal',
      message: `You have been removed from the project "${project.title}".`,
      link: '/dashboard',
      projectId: project._id.toString()
    }).catch(err => console.error('Failed to send removal notification:', err));

    return mapProjectToDTO(updatedProject!);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error('Error removing project member:', error);
    throw new AppError(
      'Failed to remove project member',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}

/**
 * Imports a GitHub repository to a project
 * Only the project owner can import repositories
 * 
 * Flow:
 * 1. Find project by ID
 * 2. Verify user is project owner
 * 3. Parse and validate GitHub URL
 * 4. Store repository information in project
 * 5. Save and return updated project
 * 
 * @param projectId - Project ID to import repository into
 * @param userId - User ID requesting import (must be owner)
 * @param importRequest - DTO with GitHub URL and optional branch
 * @returns Updated project with GitHub repository information
 * @throws AppError 404 if project not found
 * @throws AppError 403 if user is not the owner
 * @throws AppError 400 if GitHub URL is invalid
 */
export async function importGitHubRepository(
  projectId: string,
  userId: string,
  importRequest: ImportGitHubRequest
): Promise<ProjectDTO> {
  try {
    const project = await resolveProject(projectId);

    // Check if project exists
    if (!project) {
      throw new AppError(
        'Project not found',
        ErrorCode.NOT_FOUND,
        404
      );
    }

    // Verify user is the owner
    if (project.ownerId.toString() !== userId) {
      throw new AppError(
        'Only the project owner can import repositories',
        ErrorCode.FORBIDDEN,
        403
      );
    }

    // Parse and validate GitHub URL
    const parsedUrl = parseGitHubUrl(importRequest.repoUrl);

    // Clone, analyze, and store context in one operation
    console.log(`Starting GitHub repository import process...`);
    await importAndAnalyzeRepository(project._id.toString(), importRequest.repoUrl, importRequest.branch);

    // Store GitHub repository reference in project
    project.gitHubRepo = {
      owner: parsedUrl.owner,
      repo: parsedUrl.repo,
      branch: importRequest.branch || parsedUrl.branch,
      url: importRequest.repoUrl,
      importedAt: new Date(),
    };

    // Save and return
    const savedProject = await project.save();
    console.log(`Repository imported and project updated`);
    return mapProjectToDTO(savedProject);
  } catch (error) {
    // If it's already an AppError, rethrow it
    if (error instanceof AppError) {
      throw error;
    }

    // For any other error, wrap it
    console.error('Error importing GitHub repository:', error);
    throw new AppError(
      'Failed to import GitHub repository',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}

/**
 * Regenerates the API Key for a project
 * Only project owners and editors can regenerate
 */
export async function regenerateApiKey(
  projectId: string,
  userId: string
): Promise<ProjectDTO> {
  try {
    const project = await resolveProject(projectId);
    if (!project) {
      throw new AppError('Project not found', ErrorCode.NOT_FOUND, 404);
    }

    // Check permissions (Owner or Editor)
    const member = project.members.find(m => {
      const mid = m.userId?._id ? m.userId._id.toString() : m.userId.toString();
      return mid === userId;
    });
    
    const role = member?.role?.toUpperCase();
    const canRegenerate = role === 'OWNER' || role === 'EDITOR';

    if (!canRegenerate) {
      throw new AppError(
        'Only project owners and editors can regenerate the API Key',
        ErrorCode.FORBIDDEN,
        403
      );
    }

    // Get the changer's username
    const changer = await UserModel.findById(userId);
    const changerName = changer ? changer.username : 'A collaborator';

    // Generate and save new API Key using findOneAndUpdate for atomicity and to avoid populate issues
    const newApiKey = crypto.randomBytes(24).toString('hex');
    
    const updatedProject = await ProjectModel.findByIdAndUpdate(
      projectId,
      { $set: { apiKey: newApiKey } },
      { new: true }
    ).populate({
      path: 'members.userId',
      model: 'User'
    });

    if (!updatedProject) {
      throw new AppError('Failed to retrieve updated project', ErrorCode.INTERNAL_SERVER_ERROR, 500);
    }

    // Notify other members about API key regeneration
    for (const member of updatedProject.members) {
      const mId = (member.userId as any)._id ? (member.userId as any)._id.toString() : member.userId.toString();
      if (mId !== userId) {
        await createNotification({
          userId: mId,
          type: NotificationType.PROJECT_REMOVAL, // Warning icon
          title: 'Security: API Key Regenerated',
          message: `${changerName} has regenerated the API Key for project "${updatedProject.title}". Update your client integrations.`,
          link: `/editor/${updatedProject.slug}`,
          projectId: updatedProject._id.toString()
        }).catch(err => console.error('Failed to send API Key notification:', err));
      }
    }

    return mapProjectToDTO(updatedProject);
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Error regenerating API Key:', error);
    throw new AppError(
      'Failed to regenerate API Key',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}
