import type { Request, Response } from 'express';
import Joi from 'joi';
import { ErrorCode } from '@mockia/shared';
import { getDemoConfig } from './config.js';
import { pseudonymizeIp } from './ipHash.js';
import { issueChallenge } from './pow.js';
import { demoClock } from './mockRouter.js';
import { DEMO_TEMPLATE_IDS } from './templates.js';
import { createFloodLimiter } from './floodLimit.js';
import { DemoRefusal, generateDemoMock, getDemoStatus, type GenerateInput } from './service.js';

/** Longest text a visitor may paste (README, types, notes). */
export const MAX_DEMO_TEXT_CHARS = 6000;

/**
 * Body of POST /generate. Strict on purpose: no unknown keys anywhere (a URL, a model name or a temperature sent by a
 * client are errors, not silently dropped), no coercion, the template must be one of the three, and the text must have
 * something in it. Error messages are fixed text and never echo the input.
 */
const generateSchema = Joi.object({
  challenge: Joi.string().min(1).max(512).required(),
  nonce: Joi.string().min(1).max(64).required(),
  source: Joi.alternatives()
    .try(
      Joi.object({ type: Joi.string().valid('template').required(), id: Joi.string().valid(...DEMO_TEMPLATE_IDS).required() }),
      Joi.object({
        type: Joi.string().valid('text').required(),
        text: Joi.string().max(MAX_DEMO_TEXT_CHARS).pattern(/\S/).required(),
      }),
    )
    .required(),
})
  .options({ allowUnknown: false, convert: false, abortEarly: true });

/** 30 challenges per hour per pseudonymized address; in memory and bounded (see floodLimit.ts). */
export const CHALLENGES_PER_HOUR = 30;
const CHALLENGE_WINDOW_MS = 60 * 60 * 1000;
const challengeLimiter = createFloodLimiter({
  windowMs: CHALLENGE_WINDOW_MS,
  max: CHALLENGES_PER_HOUR,
  maxKeys: 10_000,
  now: () => demoClock.now().getTime(),
});

/** Forgets the challenge counters (tests). */
export const resetChallengeLimiter = (): void => challengeLimiter.clear();

const envelope = <T>(data: T) => ({ success: true, data, timestamp: new Date().toISOString() });

/** Public base URL of the visitor's mock: absolute when the Host header looks sane, otherwise relative to the origin. */
function baseUrlOf(req: Request, demoId: string): string {
  const path = `/api/demo-mock/${demoId}`;
  const host = req.get('host') ?? '';
  return /^[A-Za-z0-9.\-:[\]]{1,255}$/.test(host) ? `${req.protocol}://${host}${path}` : path;
}

/** GET /api/demo/status */
export async function statusHandler(req: Request, res: Response): Promise<void> {
  res.json(envelope(await getDemoStatus(req.ip || 'unknown')));
}

/** POST /api/demo/challenge */
export async function challengeHandler(req: Request, res: Response): Promise<void> {
  const now = demoClock.now();
  const verdict = challengeLimiter.hit(pseudonymizeIp(req.ip || 'unknown', now));
  if (!verdict.ok) {
    throw new DemoRefusal(
      'Too many challenges requested. Please wait a while before trying again.',
      ErrorCode.DEMO_LIMIT_REACHED,
      429,
      verdict.retryAfterSeconds,
    );
  }
  res.json(envelope(issueChallenge(now)));
}

/** POST /api/demo/generate */
export async function generateHandler(req: Request, res: Response): Promise<void> {
  const { error, value } = generateSchema.validate(req.body);
  if (error) {
    // Joi's message names keys (and, for unknown ones, what the client chose to send): say it in fixed words instead
    throw new DemoRefusal(
      'The request is not valid. Send a challenge, its nonce and either a template (shop, blog or users) or a text of at most 6000 characters.',
      ErrorCode.VALIDATION_ERROR,
      400,
    );
  }
  const input: GenerateInput = { ip: req.ip || 'unknown', ...(value as Omit<GenerateInput, 'ip'>) };
  const result = await generateDemoMock(input);
  res.status(201).json(
    envelope({
      demoId: result.demoId,
      baseUrl: baseUrlOf(req, result.demoId),
      endpoints: result.endpoints,
      expiresAt: result.expiresAt,
      remainingToday: result.remainingToday,
    }),
  );
}

export const isDemoEnabled = (): boolean => getDemoConfig().enabled;
