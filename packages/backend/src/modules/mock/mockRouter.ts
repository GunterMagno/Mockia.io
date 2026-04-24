/**
 * Mock Router Middleware
 * Catch-all middleware for intercepting and resolving mock API requests
 * Handles requests to /mock/:projectSlug/* and returns configured mock responses
 */

import { Request, Response, NextFunction } from 'express';
import { resolveRoute } from './routeResolution.service';
import { getDefaultResponseFromArray } from './response.service';
import { EndpointModel } from '../../models/MockAPI';

/**
 * Mock Router Middleware
 * Intercepts all requests to /mock/:projectSlug/* and returns mock responses
 * 
 * URL Pattern: GET /mock/:projectSlug/path/to/resource
 * 
 * Behavior:
 * 1. Extract projectSlug, method, and relative path from request
 * 2. Use resolveRoute to find matching endpoint
 * 3. Get the default response for that endpoint
 * 4. Return the JSON body with appropriate status code
 * 5. If no endpoint found, call next() to let standard 404 handler take over
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next middleware function
 */
export async function mockRouter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Extract projectSlug and relative path from URL
    const projectSlug = req.params.projectSlug;
    const relativePath = `/${req.params[0] || ''}`;
    const method = req.method.toUpperCase();

    // Log for debugging
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[Mock Router] ${method} /mock/${projectSlug}${relativePath}`
      );
    }

    // Attempt to resolve the route
    const resolvedRoute = await resolveRoute(projectSlug, method, relativePath);

    // If no route found, pass to next handler (standard 404)
    if (!resolvedRoute) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Mock Router] No endpoint found for ${method} ${relativePath}`);
      }
      return next();
    }

    // Populate the endpoint to get full responses array
    const endpoint = await EndpointModel.findById(
      resolvedRoute.endpoint._id
    ).populate('responses');

    if (!endpoint || !endpoint.responses || endpoint.responses.length === 0) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Mock Router] No responses configured for endpoint`);
      }
      return next();
    }

    // Get the default response
    const defaultResponse = await getDefaultResponseFromArray(endpoint.responses as any);

    if (!defaultResponse) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Mock Router] No default response found for endpoint`);
      }
      return next();
    }

    // Return the mock response
    const statusCode = defaultResponse.statusCode || 200;
    const jsonBody = defaultResponse.json_body || {};

    // Set Content-Type header
    res.setHeader('Content-Type', 'application/json');

    // Send response
    res.status(statusCode).json(jsonBody);
  } catch (error) {
    // Log error but pass to next middleware to handle with proper error handler
    console.error('[Mock Router] Error:', error);
    return next();
  }
}
