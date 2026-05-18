import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authenticateToken.js';
import { asyncHandler } from '../middlewares/errorHandler.js';
import * as endpointService from '../services/endpoint.service.js';

/**
 * Controller for endpoints management
 * Thin layer that delegates all operations to endpoint.service.ts
 */

/**
 * PUT /api/endpoints/:id
 * Updates an endpoint
 */
export const updateEndpointHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    const { id } = req.params;
    const { path, method, description, requestSchema, responseBody, statusCode } = req.body;

    const endpoint = await endpointService.updateEndpoint(id, userId, {
      path,
      method,
      description,
      requestSchema,
      responseBody,
      statusCode
    });

    res.status(200).json({
      success: true,
      data: endpoint,
    });
  }
);

/**
 * POST /api/endpoints/:projectSlug
 * Creates a new endpoint in a project
 */
export const createEndpointHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    const { projectSlug } = req.params;
    const { path, method, description } = req.body;

    const endpoint = await endpointService.createEndpoint(projectSlug, userId, {
      path,
      method,
      description
    });

    res.status(201).json({
      success: true,
      data: endpoint,
    });
  }
);

/**
 * DELETE /api/endpoints/:id
 * Deletes an endpoint and associated responses
 */
export const deleteEndpointHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    const { id } = req.params;

    await endpointService.deleteEndpoint(id, userId);

    res.status(200).json({
      success: true,
      message: 'Endpoint deleted successfully'
    });
  }
);
