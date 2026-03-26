/**
 * Project Types
 * Defines the DTO and request structures for projects
 */

/**
 * Project Role enum for members
 */
export enum ProjectRole {
  OWNER = 'owner',
  EDITOR = 'editor',
  VIEWER = 'viewer',
}

/**
 * Project member structure
 */
export interface ProjectMember {
  userId: string;
  role: ProjectRole;
  addedAt: string;
}

/**
 * Project DTO - returned from API
 */
export interface Project {
  id: string;
  title: string;
  description?: string;
  slug: string;
  ownerId: string;
  members: ProjectMember[];
  isArchived: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Request DTO for creating a project
 */
export interface CreateProjectRequest {
  title: string;
  description?: string;
}
