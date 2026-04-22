/**
 * Controller for Mock Router and Route Resolution
 * Handles HTTP requests for mock API routing and resolution
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authenticateToken';
import { asyncHandler } from '../middlewares/errorHandler';
import { resolveRoute, getProjectEndpoints } from '../modules/mock/routeResolution.service';

/**
 * POST /api/mock/resolve-route
 * Resolves a mock API route based on project slug, HTTP method, and path
 *
 * Body parameters:
 * - projectSlug (required): The project slug (e.g., "my-project")
 * - method (required): HTTP method (GET, POST, PUT, DELETE, PATCH)
 * - path (required): The request path (e.g., "/users/123")
 *
 * @param req - Authenticated request with user info
 * @param res - Express response
 * @returns 200 with resolved route and path parameters
 * @throws 404 if route not found or project not found
 * @throws 401 if not authenticated
 */
export const resolveRouteHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { projectSlug, method, path } = req.body;

    // Validate required parameters
    if (!projectSlug || !method || !path) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required parameters: projectSlug, method, and path',
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Resolve the route
    const resolvedRoute = await resolveRoute(projectSlug, method, path);

    if (!resolvedRoute) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `No matching route found for ${method} ${path}`,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        path: resolvedRoute.endpoint.path,
        method: resolvedRoute.endpoint.method,
        description: resolvedRoute.endpoint.description,
        pathParams: resolvedRoute.pathParams,
        endpoint: {
          id: resolvedRoute.endpoint._id.toString(),
          path: resolvedRoute.endpoint.path,
          method: resolvedRoute.endpoint.method,
          description: resolvedRoute.endpoint.description,
          requestSchema: resolvedRoute.endpoint.requestSchema,
          responses: resolvedRoute.endpoint.responses,
        },
      },
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * GET /api/mock/endpoints/:projectSlug
 * Lists all endpoints for a specific project
 *
 * Query parameters:
 * - method (optional): Filter by HTTP method (GET, POST, PUT, DELETE, PATCH)
 *
 * @param req - Authenticated request with user info and params
 * @param res - Express response
 * @returns 200 with list of endpoints
 * @throws 404 if project not found
 * @throws 401 if not authenticated
 */
export const getProjectEndpointsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { projectSlug } = req.params;
    const { method } = req.query;

    if (!projectSlug) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required parameter: projectSlug',
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const endpoints = await getProjectEndpoints(
      projectSlug,
      method ? String(method) : undefined
    );

    res.status(200).json({
      success: true,
      data: {
        projectSlug,
        method: method ? String(method) : 'all',
        count: endpoints.length,
        endpoints: endpoints.map(ep => ({
          id: ep._id.toString(),
          path: ep.path,
          method: ep.method,
          description: ep.description,
          requestSchema: ep.requestSchema,
        })),
      },
      timestamp: new Date().toISOString(),
    });
  }
);
