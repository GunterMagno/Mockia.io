/** Catch-all Mock Router middleware
 * Intercepts requests for a given project and serves the default response
 * defined for the matched endpoint in the database.
 */

import { Request, Response, NextFunction } from 'express';
import { resolveRoute } from './routeResolution.service.js';
import { getDefaultResponseForEndpoint } from './response.service.js';
import { getEndpointConfig } from './interceptor.service.js';

export async function mockRouter(req: Request, res: Response, next: NextFunction) {
  const projectSlug = req.params?.projectSlug as string | undefined;
  const relativePath = (req.params ? req.params[0] : undefined) || '';
  const method = req.method;

  if (!projectSlug) {
    return next();
  }

  const resolved = await resolveRoute(projectSlug, method, relativePath);
  if (!resolved) {
    // No matching endpoint; continue to 404 handler
    return next();
  }

  // Retrieve the default response for this endpoint
  const defaultResp = await getDefaultResponseForEndpoint(resolved.endpoint._id.toString());
  if (!defaultResp) {
    // No default response defined; let other handlers respond
    return next();
  }

  let body = Array.isArray(defaultResp.examples) && defaultResp.examples.length > 0
    ? defaultResp.examples[0]
    : (defaultResp as any).body ?? {};
  let statusCode = (defaultResp as any).statusCode ?? 200;

  // Apply interceptors if configured
  const cfg = await getEndpointConfig(resolved.endpoint._id.toString());
  if (cfg) {
    if (cfg.force_status_code) statusCode = cfg.force_status_code;
    if (cfg.override_response !== undefined && cfg.override_response !== null) {
      body = cfg.override_response;
    }
    if (cfg.delay_ms && cfg.delay_ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, cfg.delay_ms));
    }
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(statusCode).json(body);
}
