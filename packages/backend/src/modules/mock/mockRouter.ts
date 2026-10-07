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
import { applyCustomHeaders, clampStatus, waitDelay } from './mockBehavior.js';
import { mockAccessAllowed, mockUnauthorizedBody } from './mockAuth.js';
import { recordMockRequest } from '../../middlewares/planGate.js';

/**
 * Express 4 no captura rechazos de handlers async: sin este wrapper cualquier fallo de BD/cache
 * dispara `unhandledRejection` y index.ts hace process.exit(1).
 */
export async function mockRouter(req: Request, res: Response, next: NextFunction) {
  try {
    await handleMock(req, res, next);
  } catch (err) {
    next(err);
  }
}

async function handleMock(req: Request, res: Response, next: NextFunction) {
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

  // 1. Authenticate with API Key (only projects with visibility 'key' ask for it)
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

  if (!mockAccessAllowed(project, req.headers)) {
    return res.status(401).json(mockUnauthorizedBody());
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

  // The request is accepted from here on: it counts against the owner's monthly quota (before any configured delay)
  recordMockRequest(res);

  let body = Array.isArray(defaultResp.examples) && defaultResp.examples.length > 0
    ? defaultResp.examples[0]
    : (defaultResp as any).body ?? {};
  let statusCode = clampStatus((defaultResp as any).statusCode, 200);

  // Apply interceptors if configured (using Cache)
  const cfg = await mockCache.getEndpointConfig(resolved.endpoint._id.toString());
  if (cfg) {
    if (cfg.force_status_code) {
      statusCode = clampStatus(cfg.force_status_code, statusCode);
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
    applyCustomHeaders(res, cfg.headers);
    await waitDelay(startTime, cfg.delay_ms, cfg.jitter_ms);
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(statusCode).json(body);
}
