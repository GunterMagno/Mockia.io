/** Catch-all Mock Router middleware
 * Intercepts requests for a given project and serves the default response
 * defined for the matched endpoint in the database.
 */

import { Request, Response, NextFunction } from 'express';
import { resolveRoute } from './routeResolution.service.js';
import { EndpointModel } from '../../models/MockAPI.js';
import { getDefaultErrorBody } from './errorHelper.js';
import { applyMockHeaders } from './header.service.js';
import { mockCache } from './mockCache.service.js';

export async function mockRouter(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  applyMockHeaders(res);
  const projectSlug = req.params?.projectSlug as string | undefined;
  let relativePath = (req.params ? req.params[0] : undefined) || '';
  if (!relativePath.startsWith('/')) {
    relativePath = '/' + relativePath;
  }
  const method = req.method;

  if (!projectSlug) {
    return next();
  }

  // 1. Authenticate with API Key
  const apiKeyHeader = req.headers['x-mockia-api-key'] as string;
  const project = await mockCache.getProject(projectSlug);
  
  if (!project) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Project "${projectSlug}" not found`,
      },
      timestamp: new Date().toISOString(),
    });
  }

  // Check API Key if project has one
  if (project.apiKey && project.apiKey !== apiKeyHeader) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing X-Mockia-API-Key header',
      },
      timestamp: new Date().toISOString(),
    });
  }

  const resolved = await resolveRoute(projectSlug, method, relativePath);
  if (!resolved) {
    // No matching endpoint; continue to 404 handler
    return next();
  }

  // Get responses from the cached resolved endpoint (fully populated), falling back to DB if needed
  const responses = (resolved.endpoint.responses &&
    resolved.endpoint.responses.length > 0 &&
    typeof resolved.endpoint.responses[0] === 'object')
    ? (resolved.endpoint.responses as any[])
    : (await EndpointModel.findById(resolved.endpoint._id).populate('responses'))?.responses as any[] || [];

  if (responses.length === 0) {
    return next();
  }

  // Find the default response in memory (0ms DB calls)
  const defaultResp = responses.find(r => r.is_default === true) ?? responses[0] ?? null;
  if (!defaultResp) {
    return next();
  }

  let body = Array.isArray(defaultResp.examples) && defaultResp.examples.length > 0
    ? defaultResp.examples[0]
    : (defaultResp as any).body ?? {};
  let statusCode = (defaultResp as any).statusCode ?? 200;

  // Apply interceptors if configured (using Cache)
  const cfg = await mockCache.getEndpointConfig(resolved.endpoint._id.toString());
  if (cfg) {
    if (cfg.force_status_code) {
      statusCode = cfg.force_status_code;
      // Get all responses to check for an explicit match (in memory)
      const matchingResponse = responses.find(r => r.statusCode === statusCode);
      if (matchingResponse) {
        body = matchingResponse.schema || matchingResponse.examples?.[0] || {};
      } else if (statusCode === 204) {
        body = null;
      } else if (statusCode >= 400) {
        body = getDefaultErrorBody(statusCode);
      }
    }
    if (cfg.override_response !== undefined && cfg.override_response !== null) {
      body = cfg.override_response;
    }
    if (cfg.delay_ms && cfg.delay_ms > 0) {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, cfg.delay_ms - elapsed);
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
    }
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(statusCode).json(body);
}
