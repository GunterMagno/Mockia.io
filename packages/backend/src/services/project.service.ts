import { ProjectModel } from '../models/Project';
import { UserModel } from '../models/User';
import { generateUniqueSlug } from '../utils/slugGenerator';
import { AppError } from '../middlewares/errorHandler';
import { ErrorCode } from '@mockia/shared';
import type { Project as ProjectDTO, CreateProjectRequest, ProjectMember, ProjectRole } from '@mockia/shared';
import { ProjectRoleEnum } from '../models/Project';

/**
 * Maps a MongoDB ProjectDocument to a ProjectDTO
 * Converts ObjectIds to strings and formats dates
 */
function mapProjectToDTO(doc: any): ProjectDTO {
  return {
    id: doc._id.toString(),
    title: doc.title,
    description: doc.description,
    slug: doc.slug,
    ownerId: doc.ownerId.toString(),
    members: doc.members.map(
      (m: any): ProjectMember => ({
        userId: m.userId.toString(),
        role: m.role,
        addedAt: m.addedAt.toISOString(),
      })
    ),
    isArchived: doc.isArchived,
    archivedAt: doc.archivedAt ? doc.archivedAt.toISOString() : undefined,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
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
    // Generate unique slug
    const slug = await generateUniqueSlug(title);

    // Create project document with owner as initial member
    const projectDocument = new ProjectModel({
      title,
      description,
      slug,
      ownerId,
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
    // Find project by ID
    const project = await ProjectModel.findById(projectId);

    // Check if project exists
    if (!project) {
      throw new AppError(
        'Project not found',
        ErrorCode.NOT_FOUND,
        404
      );
    }

    // Check if user is a member
    const isMember = project.members.some(
      (member) => member.userId.toString() === userId
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
    // If it's already an AppError, rethrow it
    if (error instanceof AppError) {
      throw error;
    }

    // For any other error, wrap it
    console.error('Error retrieving project:', error);
    throw new AppError(
      'Failed to retrieve project',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
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
    // Find project by ID
    const project = await ProjectModel.findById(projectId);

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
        'Only the project owner can update this project',
        ErrorCode.FORBIDDEN,
        403
      );
    }

    // Validate update data
    if (updateData.title !== undefined) {
      if (!updateData.title || updateData.title.trim().length === 0) {
        throw new AppError(
          'Project title is required',
          ErrorCode.VALIDATION_ERROR,
          400
        );
      }

      if (updateData.title.length > 100) {
        throw new AppError(
          'Project title cannot exceed 100 characters',
          ErrorCode.VALIDATION_ERROR,
          400
        );
      }

      // If title changed, regenerate slug
      if (updateData.title !== project.title) {
        project.slug = await generateUniqueSlug(updateData.title);
        project.title = updateData.title;
      }
    }

    if (updateData.description !== undefined) {
      if (updateData.description && updateData.description.length > 500) {
        throw new AppError(
          'Project description cannot exceed 500 characters',
          ErrorCode.VALIDATION_ERROR,
          400
        );
      }
      project.description = updateData.description;
    }

    // Save and return
    const savedProject = await project.save();
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
    // Find project by ID
    const project = await ProjectModel.findById(projectId);

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
    const savedProject = await project.save();
    return mapProjectToDTO(savedProject);
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
    // Find the project
    const project = await ProjectModel.findById(projectId);
    if (!project) {
      throw new AppError(
        'Project not found',
        ErrorCode.NOT_FOUND,
        404
      );
    }

    // Check if inviter is owner
    const inviterMember = project.members.find(
      (m) => m.userId.toString() === inviterUserId
    );

    if (!inviterMember || String(inviterMember.role).toUpperCase() !== 'OWNER') {
      throw new AppError(
        'Only project owner can invite members',
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
    const isAlreadyMember = project.members.some(
      (m) => m.userId.toString() === targetUser._id.toString()
    );

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

    return mapProjectToDTO(project);
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
    // Find the project
    const project = await ProjectModel.findById(projectId);
    if (!project) {
      throw new AppError(
        'Project not found',
        ErrorCode.NOT_FOUND,
        404
      );
    }

    // Check if remover is owner
    const removerMember = project.members.find(
      (m) => m.userId.toString() === removerUserId
    );

    if (!removerMember || String(removerMember.role).toUpperCase() !== 'OWNER') {
      throw new AppError(
        'Only project owner can remove members',
        ErrorCode.FORBIDDEN,
        403
      );
    }

    // Find member to remove
    const targetMemberIndex = project.members.findIndex(
      (m) => m.userId.toString() === targetUserId
    );

    if (targetMemberIndex === -1) {
      throw new AppError(
        'Member not found in project',
        ErrorCode.NOT_FOUND,
        404
      );
    }

    // Check if trying to remove the last owner
    const targetMember = project.members[targetMemberIndex];
    if (String(targetMember.role).toUpperCase() === 'OWNER') {
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

    return mapProjectToDTO(project);
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
