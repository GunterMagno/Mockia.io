import { Router } from 'express';
import { updateEndpointHandler, createEndpointHandler } from '../controllers/endpoint.controller';
import { authenticateToken } from '../middlewares/authenticateToken';

export const endpointsRouter = Router();

// PUT /api/endpoints/:id
endpointsRouter.put(
  '/:id',
  authenticateToken,
  updateEndpointHandler
);

// POST /api/endpoints/:projectSlug
endpointsRouter.post(
  '/:projectSlug',
  authenticateToken,
  createEndpointHandler
);
