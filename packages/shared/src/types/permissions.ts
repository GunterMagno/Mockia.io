/**
 * Permission levels for routes and authorization
 * Used to define access control for API endpoints
 */
export enum PermissionLevel {
  PUBLIC = 'public',
  AUTHENTICATED = 'authenticated',
  ADMIN = 'admin',
}

/**
 * Project roles for RBAC (Role-Based Access Control)
 * Defines user permissions within a project
 */
export type ProjectRole = 'OWNER' | 'EDITOR' | 'VIEWER';
