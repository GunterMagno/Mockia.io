/**
 * AI Routes
 * Routes for AI-related endpoints
 */

import { Router } from 'express';
import {
  generateDescriptionHandler,
  generateMockDataHandler,
  aiHealthCheckHandler,
} from '../controllers/ai.controller';
import { authenticateToken } from '../middlewares/authenticateToken';

const router = Router();

/**
 * AI Generation endpoints
 * All protected with authentication
 */

/**
 * POST /api/ai/generate-description
 * Generate description/documentation for an API feature
 */
router.post('/generate-description', authenticateToken, generateDescriptionHandler);

/**
 * POST /api/ai/generate-mock-data
 * Generate mock data for a given schema
 */
router.post('/generate-mock-data', authenticateToken, generateMockDataHandler);

/**
 * GET /api/ai/health
 * Check AI service health
 */
router.get('/health', authenticateToken, aiHealthCheckHandler);

export default router;
