/**
 * Route Resolution Service
 * Resolves mock API routes based on project slug, HTTP method, and path
 */

import { ProjectModel } from '../../models/Project';
import { MockAPIModel, EndpointModel, EndpointDocument } from '../../models/MockAPI';
import { AppError } from '../../middlewares/errorHandler';
import { ErrorCode } from '@mockia/shared';
import {
  extractPathParams,
  calculatePatternSpecificity,
  hasWildcards,
} from './pathParams.util';

/**
 * Result of route resolution
 */
export interface ResolvedRoute {
  endpoint: EndpointDocument;
  pathParams: Record<string, string>;
}

/**
 * Resolves a mock API route based on project slug, HTTP method, and path
 * 
 * Priority:
 * 1. Static routes (exact match) - sorted by specificity
 * 2. Wildcard routes (parameter match) - sorted by specificity
 * 
 * @param projectSlug - The project slug (e.g., "my-project")
 * @param method - HTTP method (GET, POST, PUT, DELETE, PATCH)
 * @param path - The request path (e.g., "/users/123")
 * @returns Resolved route with endpoint and extracted path parameters, or null
 * @throws AppError if project or MockAPI is not found
 */
export async function resolveRoute(
  projectSlug: string,
  method: string,
  path: string
): Promise<ResolvedRoute | null> {
  try {
    // Step 1: Find project by ID or Slug
    let project;
    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(projectSlug);
    if (isValidObjectId) {
      project = await ProjectModel.findById(projectSlug);
    }
    if (!project) {
      project = await ProjectModel.findOne({ slug: projectSlug });
    }

    if (!project) {
      throw new AppError(
        `Project "${projectSlug}" not found`,
        ErrorCode.NOT_FOUND,
        404
      );
    }
    // Step 2: Find MockAPI for this project
    const mockAPI = await MockAPIModel.findOne({ projectId: project._id });
    if (!mockAPI) {
      throw new AppError(
        `No Mock API found for project "${projectSlug}"`,
        ErrorCode.NOT_FOUND,
        404
      );
    }
    // Step 3: Get all endpoints for this MockAPI and method
    const endpoints = await EndpointModel.find({
      mockApiId: mockAPI._id,
      method: method.toUpperCase(),
    });
    if (endpoints.length === 0) {
      return null; // No endpoints found for this method
    }

    // Step 4: Separate static routes (no wildcards) and wildcard routes
    const staticRoutes: EndpointDocument[] = [];
    const wildcardRoutes: EndpointDocument[] = [];

    for (const endpoint of endpoints) {
      if (hasWildcards(endpoint.path)) {
        wildcardRoutes.push(endpoint);
      } else {
        staticRoutes.push(endpoint);
      }
    }

    // Step 5: Try static routes first (sorted by specificity, descending)
    staticRoutes.sort(
      (a, b) =>
        calculatePatternSpecificity(b.path) - calculatePatternSpecificity(a.path)
    );

    for (const endpoint of staticRoutes) {
      if (endpoint.path === path) {
        return {
          endpoint,
          pathParams: {},
        };
      }
    }

    // Step 6: Try wildcard routes (sorted by specificity, descending)
    wildcardRoutes.sort(
      (a, b) =>
        calculatePatternSpecificity(b.path) - calculatePatternSpecificity(a.path)
    );

    for (const endpoint of wildcardRoutes) {
      const params = extractPathParams(endpoint.path, path);
      if (params !== null) {
        return {
          endpoint,
          pathParams: params,
        };
      }
    }

    // Step 7: No matching route found
    return null;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      'Failed to resolve route',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500,
      { originalError: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Gets all endpoints for a project and method
 * Useful for debugging or listing available routes
 * 
 * @param projectSlug - The project slug
 * @param method - HTTP method (optional, if not provided returns all)
 * @returns Array of endpoints
 */
export async function getProjectEndpoints(
  projectSlug: string,
  method?: string
): Promise<EndpointDocument[]> {
  try {
    // [RouteResolution] Get endpoints for project (ID or Slug)
    let project;
    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(projectSlug);
    if (isValidObjectId) {
      project = await ProjectModel.findById(projectSlug);
    }
    if (!project) {
      project = await ProjectModel.findOne({ slug: projectSlug });
    }

    if (!project) {
      throw new AppError(
        `Project "${projectSlug}" not found`,
        ErrorCode.NOT_FOUND,
        404
      );
    }
    const mockAPI = await MockAPIModel.findOne({ projectId: project._id });
    if (!mockAPI) {
      throw new AppError(
        `No Mock API found for project "${projectSlug}"`,
        ErrorCode.NOT_FOUND,
        404
      );
    }
    const query: any = { mockApiId: mockAPI._id };
    if (method) {
      query.method = method.toUpperCase();
    }
    const endpoints = await EndpointModel.find(query)
      .sort({ method: 1, path: 1 })
      .populate('responses');
    return endpoints;
  } catch (error) {
    console.error(`[RouteResolution] Error getting endpoints:`, error);
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      'Failed to fetch project endpoints',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500,
      { originalError: error instanceof Error ? error.message : String(error) }
    );
  }
}
