/**
 * Controller for Mock Router and Route Resolution
 * Handles HTTP requests for mock API routing and resolution
 */

import { Request, Response } from 'express';
import { applyMockHeaders } from '../modules/mock/header.service';
import { AuthenticatedRequest } from '../middlewares/authenticateToken';
import { asyncHandler } from '../middlewares/errorHandler';
import { resolveRoute, getProjectEndpoints } from '../modules/mock/routeResolution.service';
import { ResponseModel, EndpointModel } from '../models/MockAPI';
import { ProjectModel } from '../models/Project';

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
          responses: ep.responses,
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
 * Authentication: API Key required via X-Mockia-API-Key header
 *
 * @param req - Request
 * @param res - Express response
 * @returns 200 with mock response data
 * @throws 404 if route not found
 */
export const mockProxyHandler = asyncHandler(
  async (req: Request, res: Response) => {
    applyMockHeaders(res);
    const method = req.method;
    
    // Extract projectSlug and path from URL
    // URL format: /api/mock/:projectSlug/*
    const pathParts = req.path.split('/').filter(p => p);
    
    if (pathParts.length < 1) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Missing project slug',
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }
    
    const projectSlug = pathParts[0];
    const mockPath = pathParts.length > 1 ? '/' + pathParts.slice(1).join('/') : '';

    // 1. Authenticate with API Key
    const apiKeyHeader = req.headers['x-mockia-api-key'] as string;
    const project = await ProjectModel.findOne({ slug: projectSlug });
    
    if (!project) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Project "${projectSlug}" not found`,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Check API Key if project has one
    if (project.apiKey && project.apiKey !== apiKeyHeader) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or missing X-Mockia-API-Key header',
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // 2. Handle Project Root (List Endpoints)
    if (!mockPath || mockPath === '/') {
      const endpoints = await getProjectEndpoints(projectSlug);
      res.status(200).json({
        success: true,
        project: {
          title: project.title,
          slug: project.slug,
          description: project.description,
        },
        data: {
          endpoints: endpoints.map(ep => ({
            method: ep.method,
            path: ep.path,
            description: ep.description,
            url: `${req.protocol}://${req.get('host')}/api/mock/${projectSlug}${ep.path.startsWith('/') ? '' : '/'}${ep.path}`
          }))
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // 3. Resolve the route
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

    // 4. Select Response
    const responseStatusHeader = req.headers['x-mockia-response-status'];
    const responseNameHeader = req.headers['x-mockia-response-name'];
    const responseQueryStatus = req.query._status;

    // Populate responses to find by name or status
    const endpoint = await EndpointModel.findById(resolvedRoute.endpoint._id).populate('responses');
    const responses = (endpoint?.responses as any[]) || [];
    
    let targetResponse;

    if (responseStatusHeader || responseQueryStatus) {
      const status = parseInt((responseStatusHeader || responseQueryStatus) as string);
      targetResponse = responses.find(r => r.statusCode === status);
    } else if (responseNameHeader) {
      targetResponse = responses.find(r => r.name === responseNameHeader);
    }

    // Fallback to first response if no specific selection matched
    if (!targetResponse && responses.length > 0) {
      targetResponse = responses[0];
    }

    if (!targetResponse) {
      res.status(200).json({});
      return;
    }

    // 5. Return the mock response
    const statusCode = targetResponse.statusCode || 200;
    const responseData = targetResponse.examples?.[0] || targetResponse.schema || {};

    res.status(statusCode).json(responseData);
  }
);
