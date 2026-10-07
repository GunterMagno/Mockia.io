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
 * Who can call the mock endpoints of a project.
 * - 'public': anyone with the URL.
 * - 'key': only requests carrying the project's API key in the X-Mockia-API-Key header.
 */
export type MockVisibility = 'public' | 'key';
export const MOCK_VISIBILITIES: readonly MockVisibility[] = ['public', 'key'];

/** Header that carries the project's API key on mock requests (X-Mockia-Key is accepted as an alias). */
export const MOCK_API_KEY_HEADER = 'X-Mockia-API-Key';

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
  /** Who can call the mock endpoints. Legacy documents without the field are served as 'public'. */
  visibility: MockVisibility;
  /** A key has been issued. The key itself is never returned: only POST /projects/:id/api-key shows it, once. */
  hasApiKey: boolean;
  /** First characters of the issued key (e.g. "mk_ab12cd"), safe to display; null when there is no key. */
  apiKeyPrefix: string | null;
  isArchived: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Request DTO for creating a project
 */
/** Response of POST /projects/:id/api-key: the only time the full key is visible. */
export interface IssuedApiKey {
  apiKey: string;
  prefix: string;
}

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
