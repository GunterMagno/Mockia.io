/**
 * Permission levels for routes and authorization
 * Used to define access control for API endpoints
 */
export enum PermissionLevel {
  PUBLIC = 'public',
  AUTHENTICATED = 'authenticated',
  ADMIN = 'admin',
}
