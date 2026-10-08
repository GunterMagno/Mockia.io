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
  feedbackHandler,
} from '../controllers/ai.controller.js';
import { authenticateToken } from '../middlewares/authenticateToken.js';
import { requireVerifiedEmail } from '../middlewares/requireVerifiedEmail.js';
import { authorizeRole } from '../middlewares/authorizeRole.js';
import { rateLimit } from '../middlewares/rateLimit.js';
import { validate } from '../middlewares/validateRequest.js';
import { feedbackSchema } from '../modules/ai/feedbackValidation.js';

/**
 * Both project-bound routes take the project (id or slug) from the body. The caller must belong to it BEFORE any prompt
 * is built or any model is called: building the prompt pulls the project's GitHub context, and generate-and-save writes
 * endpoints into it. Unknown project -> 404, not a member / insufficient role -> 403, no project reference -> 400.
 * generate-description and generate-mock-data take no project reference.
 */
const bodyProjectRef = (req: { body?: { projectId?: unknown } }) => req.body?.projectId;

const router = Router();

/** Feedback is cheap but each call can store up to 200 KB: 60 per 15 minutes per user (the AI quota does not apply to it). */
const feedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyFn: (req) => (req as unknown as { user?: { id?: string } }).user?.id ?? req.ip ?? 'unknown',
});

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
 * /ai/feedback:
 *   post:
 *     summary: Rate an AI generation (thumbs up/down), optionally with a corrected specification
 *     description: >
 *       Accepted from every verified user. Without the user's consent to improve the AI (PUT /users/me/ai-consent) only
 *       the verdict is stored. With consent and a stored generation of the same user the correction is validated and
 *       stored too. Later feedback on the same generation replaces the earlier one.
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
 *               - generationId
 *               - verdict
 *             properties:
 *               generationId:
 *                 type: string
 *                 format: uuid
 *               verdict:
 *                 type: string
 *                 enum: [good, bad]
 *               correctedOutput:
 *                 type: object
 *                 description: Corrected API specification (max 200 KB)
 *     responses:
 *       204:
 *         description: Feedback recorded
 *       400:
 *         description: Invalid body or invalid correctedOutput
 *       404:
 *         description: The generation belongs to another user
 *       429:
 *         description: Too many feedback requests
 */
router.post(
  '/feedback',
  authenticateToken,
  requireVerifiedEmail,
  feedbackLimiter,
  validate({ body: feedbackSchema }),
  feedbackHandler
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
