/**
 * AI Routes
 * Routes for AI-related endpoints
 */

import { Router } from 'express';
import {
  generateDescriptionHandler,
  generateMockDataHandler,
  generateMockAPISpecHandler,
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
 * POST /api/ai/generate-mock-api-spec
 * Generate a complete mock API specification based on project context
 * Uses Sprint 5: Prompt Engineering and Context Formatting
 * 
 * Request body:
 * {
 *   "projectId": "mongodb-project-id",
 *   "requirement": "Description of what the mock API should do",
 *   "temperature": 0.7 (optional),
 *   "maxTokens": 4000 (optional)
 * }
 * 
 * Response: Complete mock API specification with endpoints and data models
 */
router.post('/generate-mock-api-spec', authenticateToken, generateMockAPISpecHandler);

/**
 * GET /api/ai/health
 * Check AI service health
 */
router.get('/health', authenticateToken, aiHealthCheckHandler);

export default router;
