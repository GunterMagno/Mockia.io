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
import { requireVerifiedEmail } from '../middlewares/requireVerifiedEmail.js';
import { authorizeRole } from '../middlewares/authorizeRole.js';

/**
 * Both project-bound routes take the project (id or slug) from the body. The caller must belong to it BEFORE any prompt
 * is built or any model is called: building the prompt pulls the project's GitHub context, and generate-and-save writes
 * endpoints into it. Unknown project -> 404, not a member / insufficient role -> 403, no project reference -> 400.
 * generate-description and generate-mock-data take no project reference.
 */
const bodyProjectRef = (req: { body?: { projectId?: unknown } }) => req.body?.projectId;

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
router.post('/generate-description', authenticateToken, requireVerifiedEmail, generateDescriptionHandler);

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
router.post('/generate-mock-data', authenticateToken, requireVerifiedEmail, generateMockDataHandler);

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
// Read only (nothing is saved): any member, viewers included
router.post(
  '/generate-mock-api-spec',
  authenticateToken,
  requireVerifiedEmail,
  authorizeRole(['OWNER', 'EDITOR', 'VIEWER'], bodyProjectRef),
  generateMockAPISpecHandler
);

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
// Writes endpoints into the project: owner or editor
router.post(
  '/generate-and-save',
  authenticateToken,
  requireVerifiedEmail,
  authorizeRole(['OWNER', 'EDITOR'], bodyProjectRef),
  generateAndSaveHandler
);

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
