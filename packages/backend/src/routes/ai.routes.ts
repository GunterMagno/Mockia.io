/**
 * AI Routes
 * Routes for AI-related endpoints
 */

import { Router } from 'express';
import {
  generateDescriptionHandler,
  generateMockDataHandler,
  generateMockAPISpecHandler,
  generateAndSaveHandler,
  aiHealthCheckHandler,
} from '../controllers/ai.controller.js';
import { authenticateToken } from '../middlewares/authenticateToken.js';

const router = Router();

/**
 * AI Generation endpoints
 * All protected with authentication
 */

/**
 * @swagger
 * tags:
 *   name: AI
 *   description: AI-powered generation and analysis
 */

/**
 * @swagger
 * /ai/generate-description:
 *   post:
 *     summary: Generate feature description
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/generate-description', authenticateToken, generateDescriptionHandler);

/**
 * @swagger
 * /ai/generate-mock-data:
 *   post:
 *     summary: Generate mock data
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/generate-mock-data', authenticateToken, generateMockDataHandler);

/**
 * @swagger
 * /ai/generate-mock-api-spec:
 *   post:
 *     summary: Generate API specification
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - projectId
 *               - requirement
 *             properties:
 *               projectId:
 *                 type: string
 *               requirement:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/generate-mock-api-spec', authenticateToken, generateMockAPISpecHandler);

/**
 * @swagger
 * /ai/generate-and-save:
 *   post:
 *     summary: Generate and save API specification
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - projectId
 *               - requirement
 *             properties:
 *               projectId:
 *                 type: string
 *               requirement:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/generate-and-save', authenticateToken, generateAndSaveHandler);

/**
 * @swagger
 * /ai/health:
 *   get:
 *     summary: AI service health check
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/health', authenticateToken, aiHealthCheckHandler);

export default router;
