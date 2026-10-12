import { Router, type NextFunction, type Request, type Response } from 'express';
import { ErrorCode } from '@mockia/shared';
import { AppError, asyncHandler } from '../../middlewares/errorHandler.js';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../../middlewares/authenticateToken.js';
import { requireVerifiedEmail } from '../../middlewares/requireVerifiedEmail.js';
import { rateLimit } from '../../middlewares/rateLimit.js';
import { validate } from '../../middlewares/validateRequest.js';
import { requireCsrfHeader } from '../auth/cookie.js';
import {
  createHandler,
  deleteHandler,
  getConfigHandler,
  listHandler,
  updateHandler,
} from './controller.js';
import { isByokEnabled } from './service.js';
import { createCredentialSchema, updateCredentialSchema } from './validation.js';

/**
 * AI credentials router, mounted at /api/ai-credentials (users bring their own AI key; decisions D7-D10).
 *
 * Order of the gates, which is part of the contract:
 *  1. BYOK_ENABLED off (the default) -> 404 BYOK_DISABLED on every path and method, even without a session.
 *  2. Cache-Control: no-store on everything (the answers are per user, and a proxy must never keep them).
 *  3. A session, and a verified email (when the server requires it).
 *  4. Writes (POST, PATCH, DELETE) must carry `X-Requested-With: mockia`, like the other state-changing calls that a
 *     browser could be tricked into making, and are limited to 20 per hour per user. The limiter counts every write that
 *     reaches it, successful or not, so guessing ids is throttled too.
 * Every operation is scoped to the user of the session; another user's id is a 404 (see service.ts).
 *
 * The API key only ever comes IN (POST, PATCH). No response, log or notification repeats it.
 */
export const aiCredentialsRouter = Router();

const writeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyFn: (req) => (req as AuthenticatedRequest).user?.id ?? req.ip ?? 'unknown',
});

aiCredentialsRouter.use((_req: Request, _res: Response, next: NextFunction) => {
  if (!isByokEnabled()) {
    return next(new AppError('Not found', ErrorCode.BYOK_DISABLED, 404));
  }
  next();
});

aiCredentialsRouter.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

aiCredentialsRouter.use(authenticateToken, requireVerifiedEmail);

const WRITES = new Set(['POST', 'PATCH', 'DELETE']);
aiCredentialsRouter.use((req: Request, res: Response, next: NextFunction) =>
  WRITES.has(req.method)
    ? requireCsrfHeader(req, res, (err?: unknown) =>
        err ? next(err) : writeLimiter(req, res, next)
      )
    : next()
);

/**
 * @swagger
 * tags:
 *   name: AiCredentials
 *   description: The user's own AI provider keys (bring your own AI). Keys are stored encrypted and never returned.
 */

/**
 * @swagger
 * /ai-credentials/config:
 *   get:
 *     summary: What the server offers for bringing your own AI key
 *     tags: [AiCredentials]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ enabled, allowCustom, presets }"
 *       404:
 *         description: The feature is switched off on this server (BYOK_DISABLED)
 */
aiCredentialsRouter.get('/config', getConfigHandler);

/**
 * @swagger
 * /ai-credentials:
 *   get:
 *     summary: List the user's AI credentials (metadata only; never the key)
 *     tags: [AiCredentials]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of credential metadata
 *   post:
 *     summary: Add an AI credential
 *     description: >
 *       The key is checked against the provider before anything is saved, then stored encrypted.
 *       Needs the X-Requested-With header set to mockia. With a preset any baseUrl is ignored.
 *     tags: [AiCredentials]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [label, preset, model, apiKey]
 *             properties:
 *               label:
 *                 type: string
 *                 maxLength: 40
 *               preset:
 *                 type: string
 *                 enum: [openai, openrouter, groq, mistral, together, custom]
 *               baseUrl:
 *                 type: string
 *                 description: Only with preset custom and BYOK_ALLOW_CUSTOM_URLS=true
 *               model:
 *                 type: string
 *                 maxLength: 100
 *               apiKey:
 *                 type: string
 *                 writeOnly: true
 *     responses:
 *       201:
 *         description: The credential's metadata
 *       400:
 *         description: Invalid input, a URL that is not allowed, or the provider rejected the key (AI_PROVIDER_REJECTED)
 *       403:
 *         description: Email not verified, or missing X-Requested-With header
 *       409:
 *         description: Label already used, or the limit of 5 credentials is reached
 *       429:
 *         description: More than 20 writes in an hour
 */
aiCredentialsRouter.get('/', asyncHandler(listHandler));
aiCredentialsRouter.post(
  '/',
  validate({ body: createCredentialSchema }),
  asyncHandler(createHandler)
);

/**
 * @swagger
 * /ai-credentials/{id}:
 *   patch:
 *     summary: Rename a credential, change its model or replace its key
 *     tags: [AiCredentials]
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
 *         description: The credential's metadata
 *       404:
 *         description: No such credential for this user (also for somebody else's id)
 *   delete:
 *     summary: Delete a credential
 *     tags: [AiCredentials]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Deleted
 *       404:
 *         description: No such credential for this user (also for somebody else's id)
 */
aiCredentialsRouter.patch(
  '/:id',
  validate({ body: updateCredentialSchema }),
  asyncHandler(updateHandler)
);
aiCredentialsRouter.delete('/:id', asyncHandler(deleteHandler));

export default aiCredentialsRouter;
