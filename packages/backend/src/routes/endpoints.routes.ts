import { Router } from 'express';
import { updateEndpointHandler, createEndpointHandler, deleteEndpointHandler } from '../controllers/endpoint.controller.js';
import { authenticateToken } from '../middlewares/authenticateToken.js';

export const endpointsRouter = Router();

/**
 * @swagger
 * tags:
 *   name: Endpoints
 *   description: Project endpoint management
 */

/**
 * @swagger
 * /endpoints/{id}:
 *   put:
 *     summary: Update endpoint
 *     tags: [Endpoints]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
endpointsRouter.put(
  '/:id',
  authenticateToken,
  updateEndpointHandler
);

/**
 * @swagger
 * /endpoints/{id}:
 *   delete:
 *     summary: Delete endpoint
 *     tags: [Endpoints]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
endpointsRouter.delete(
  '/:id',
  authenticateToken,
  deleteEndpointHandler
);

/**
 * @swagger
 * /endpoints/{projectSlug}:
 *   post:
 *     summary: Create endpoint
 *     tags: [Endpoints]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectSlug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Success
 */
endpointsRouter.post(
  '/:projectSlug',
  authenticateToken,
  createEndpointHandler
);
