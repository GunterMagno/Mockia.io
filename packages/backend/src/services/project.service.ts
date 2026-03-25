import { ProjectModel } from '../models/Project';
import { generateUniqueSlug } from '../utils/slugGenerator';
import { AppError } from '../middlewares/errorHandler';
import { ErrorCode } from '@mockia/shared';
import type { Project as ProjectDTO, CreateProjectRequest, ProjectMember } from '@mockia/shared';
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
