/**
 * Controller for Mock Router and Route Resolution
 * Handles HTTP requests for mock API routing and resolution
 */

import { Response } from 'express';
import { applyMockHeaders } from '../modules/mock/header.service';
import { AuthenticatedRequest } from '../middlewares/authenticateToken';
import { asyncHandler } from '../middlewares/errorHandler';
import { resolveRoute, getProjectEndpoints } from '../modules/mock/routeResolution.service';
import { ResponseModel } from '../models/MockAPI';

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
    applyMockHeaders(res);
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
    applyMockHeaders(res);
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

/**
 * GET /api/mock/:projectSlug/*
 * Proxy handler for mock API requests
 * Acts as a catch-all to resolve and respond to mock API calls
 *
 * Authentication: Required (JWT Bearer token)
 *
 * @param req - Authenticated request
 * @param res - Express response
 * @returns 200 with mock response data
 * @throws 404 if route not found
 */
export const mockProxyHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    applyMockHeaders(res);
    const method = req.method;
    
    // Extract projectSlug and path from URL
    // URL format: /api/mock/:projectSlug/path
    const pathParts = req.path.split('/').filter(p => p); // Filter out empty strings
    
    if (pathParts.length < 2) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid mock request format. Expected: /api/mock/:projectSlug/path',
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }
    
    const projectSlug = pathParts[0];
    const mockPath = '/' + pathParts.slice(1).join('/');

    // Resolve the route
    const resolvedRoute = await resolveRoute(projectSlug, method, mockPath);

    if (!resolvedRoute) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Route not found: ${method} ${mockPath}`,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Get the first response for this endpoint
    let responseData: any = {};
    let statusCode = 200;

    if (resolvedRoute.endpoint.responses && resolvedRoute.endpoint.responses.length > 0) {
      const response = await ResponseModel.findById(resolvedRoute.endpoint.responses[0]);
      if (response) {
        statusCode = response.statusCode || 200;
        responseData = response.examples?.[0] || response.schema || {};
      }
    }

    // Return the mock response
    res.status(statusCode).json(responseData);
  }
);
