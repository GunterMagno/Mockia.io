import { Application } from 'express';
import { updateEndpointConfig } from './interceptor.controller.js';

export function mountInterceptorRoutes(app: Application) {
  // PUT /api/projects/:id/endpoints/:eid/config
  app.put('/api/projects/:id/endpoints/:eid/config', updateEndpointConfig);
}
