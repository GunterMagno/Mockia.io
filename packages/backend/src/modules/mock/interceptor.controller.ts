import { Request, Response, NextFunction } from 'express';
import { setEndpointConfig } from './interceptor.service.js';

/**
 * Controller to update endpoint interceptors configuration
 * Route: PUT /api/projects/:id/endpoints/:eid/config
 */
export async function updateEndpointConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = req.params?.id as string;
    const endpointId = req.params?.eid as string;
    const configDto = req.body || {};

    const result = await setEndpointConfig(projectId, endpointId, configDto);
    res.status(200).json({ endpointId, ...configDto, updatedAt: result?.updatedAt ?? new Date() });
  } catch (err) {
    return next(err);
  }
}
