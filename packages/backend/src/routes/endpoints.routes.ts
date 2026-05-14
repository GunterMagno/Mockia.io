import { Router } from 'express';
import { updateEndpointHandler, createEndpointHandler, deleteEndpointHandler } from '../controllers/endpoint.controller';
import { authenticateToken } from '../middlewares/authenticateToken';

export const endpointsRouter = Router();

// PUT /api/endpoints/:id
endpointsRouter.put(
  '/:id',
  authenticateToken,
  updateEndpointHandler
);

// DELETE /api/endpoints/:id
endpointsRouter.delete(
  '/:id',
  authenticateToken,
  deleteEndpointHandler
);

// POST /api/endpoints/:projectSlug
endpointsRouter.post(
  '/:projectSlug',
  authenticateToken,
  createEndpointHandler
);
