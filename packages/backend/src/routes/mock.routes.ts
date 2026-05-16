/**
 * Mock Router Routes
 * Handles mock API routing and route resolution endpoints
 */

import { Router } from 'express';
import { resolveRouteHandler, getProjectEndpointsHandler, mockProxyHandler } from '../controllers/mock.controller.js';
import { authenticateToken } from '../middlewares/authenticateToken.js';
import { validate } from '../middlewares/validateRequest.js';
import Joi from 'joi';

export const mockRouter = Router();

/**
 * Validation schemas
 */
const resolveRouteSchema = Joi.object({
  projectSlug: Joi.string().required().min(1).max(255),
  method: Joi.string().required().uppercase().valid('GET', 'POST', 'PUT', 'DELETE', 'PATCH'),
  path: Joi.string().required().min(1).max(255),
});

/**
 * POST /api/mock/resolve-route
 * Resolves a mock API route based on project slug, HTTP method, and path
 *
 * Authentication: Required (JWT Bearer token)
 * Validation: Body must match resolveRouteSchema
 *
 * Middleware stack:
 * 1. authenticateToken - Verifies JWT and attaches user info
 * 2. validate - Validates request body against schema
 * 3. resolveRouteHandler - Controller
 *
 * Request body:
 * {
 *   "projectSlug": "my-project",
 *   "method": "GET",
 *   "path": "/users/123"
 * }
 *
 * Responses:
 * - 200: Route resolved successfully with endpoint and path parameters
 * - 400: Invalid input data (validation error)
 * - 401: Missing or invalid token
 * - 404: Route not found or project not found
 *
 * Response body:
 * {
 *   "success": true,
 *   "data": {
 *     "path": "/users/:id",
 *     "method": "GET",
 *     "description": "Get a user by ID",
 *     "pathParams": { "id": "123" },
 *     "endpoint": { ... }
 *   },
 *   "timestamp": "2026-04-22T..."
 * }
 */
mockRouter.post(
  '/resolve-route',
  authenticateToken,
  validate({ body: resolveRouteSchema }),
  resolveRouteHandler
);

/**
 * GET /api/mock/endpoints/:projectSlug
 * Lists all endpoints for a specific project
 *
 * Authentication: Required (JWT Bearer token)
 *
 * Middleware stack:
 * 1. authenticateToken - Verifies JWT and attaches user info
 * 2. getProjectEndpointsHandler - Controller
 *
 * Query parameters:
 * - method (optional): Filter by HTTP method
 *
 * Responses:
 * - 200: List of endpoints
 * - 401: Missing or invalid token
 * - 404: Project not found or no Mock API for project
 *
 * Response body:
 * {
 *   "success": true,
 *   "data": {
 *     "projectSlug": "my-project",
 *     "method": "all",
 *     "count": 5,
 *     "endpoints": [
 *       {
 *         "id": "...",
 *         "path": "/users/:id",
 *         "method": "GET",
 *         "description": "..."
 *       },
 *       ...
 *     ]
 *   },
 *   "timestamp": "2026-04-22T..."
 * }
 */
mockRouter.get(
  '/endpoints/:projectSlug',
  authenticateToken,
  getProjectEndpointsHandler
);

/**
 * Catch-all Mock Proxy Route
 * Matches: /api/mock/:projectSlug/*
 * Proxy handler that resolves and responds to mock API requests
 *
 * Authentication: Not required (public mock consumption)
 *
 * Examples:
 * - GET /api/mock/my-project/users/123
 * - POST /api/mock/my-project/users
 * - PUT /api/mock/my-project/users/456
 * - DELETE /api/mock/my-project/users/789
 *
 * Response:
 * - Returns the mock response data for the matched endpoint
 * - Status code is from the endpoint's response definition
 * - Data is from the response examples or schema
 */
// Catch-all route using regex - matches /:projectSlug and /:projectSlug/*
// Group 1: projectSlug
// Group 2: optional path
mockRouter.all(
  /^\/([^\/]+)(?:\/(.*))?$/,
  mockProxyHandler
);
