/**
 * Project Types
 * Defines the DTO and request structures for projects
 */

import type { ProjectRole } from './permissions.js';

/**
 * Project member structure
 */
export interface ProjectMember {
  userId: string;
  username?: string;
  email?: string;
  role: ProjectRole;
  addedAt: string;
}

/**
 * GitHub repository information stored in project
 */
export interface GitHubRepo {
  owner: string;
  repo: string;
  branch?: string;
  url: string;
  importedAt: string;
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
  gitHubRepo?: GitHubRepo;
  apiKey?: string;
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

/**
 * Request DTO for importing a GitHub repository to a project
 */
export interface ImportGitHubRequest {
  repoUrl: string;
  branch?: string;
}
