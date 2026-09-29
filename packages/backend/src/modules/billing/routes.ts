import express, { Router } from 'express';
import { asyncHandler } from '../../middlewares/errorHandler.js';
import { authenticateToken, type AuthenticatedRequest } from '../../middlewares/authenticateToken.js';
import { UserModel } from '../../models/User.js';
import { asPaidPlan } from './plans.js';
import { verifyStripeSignature } from './stripeSignature.js';
import { checkoutConfig, createCheckoutSession, handleStripeEvent, type StripeEvent } from './service.js';

/**
 * Billing router, mounted at /api/billing.
 *
 * IMPORTANT: mount it BEFORE the global `express.json()` in index.ts. The webhook needs the raw
 * bytes for signature verification (express.raw here), and once a body parser has run the raw body is gone.
 * Body parsers skip requests already parsed, so /checkout carries its own express.json().
 *
 * Env: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, STRIPE_PRICE_TEAM,
 *      optional FRONTEND_URL / STRIPE_SUCCESS_URL / STRIPE_CANCEL_URL.
 */
export const billingRouter = Router();

const fail = (code: string, message: string) => ({
  success: false,
  error: { code, message },
  timestamp: new Date().toISOString(),
});

/**
 * POST /api/billing/webhook  (called by Stripe, no JWT; authenticity = Stripe-Signature)
 * 200 handled/ignored, 400 bad signature or payload, 501 webhook secret not configured.
 */
billingRouter.post(
  '/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  asyncHandler(async (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      res.status(501).json(fail('BILLING_NOT_CONFIGURED', 'STRIPE_WEBHOOK_SECRET is not set'));
      return;
    }
    const raw = req.body;
    if (!Buffer.isBuffer(raw)) {
      // Body already parsed upstream: mounting order is wrong. Never verify a re-serialized body.
      res.status(400).json(fail('RAW_BODY_REQUIRED', 'Webhook needs the raw request body'));
      return;
    }
    if (!verifyStripeSignature(raw, req.header('stripe-signature'), secret)) {
      res.status(400).json(fail('INVALID_SIGNATURE', 'Invalid Stripe signature'));
      return;
    }
    let event: StripeEvent;
    try {
      event = JSON.parse(raw.toString('utf8'));
    } catch {
      res.status(400).json(fail('INVALID_PAYLOAD', 'Malformed JSON'));
      return;
    }
    if (!event || typeof event.type !== 'string') {
      res.status(400).json(fail('INVALID_PAYLOAD', 'Not a Stripe event'));
      return;
    }
    const result = await handleStripeEvent(event); // throws -> 500 -> Stripe retries
    res.status(200).json({ received: true, result });
  })
);

/**
 * POST /api/billing/checkout  body: { plan: 'pro' | 'team' }
 * 200 { url } (redirect the browser there), 400 invalid plan, 401, 501 Stripe not configured, 502 Stripe error.
 */
billingRouter.post(
  '/checkout',
  authenticateToken,
  express.json({ limit: '10kb' }),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const plan = asPaidPlan(req.body?.plan);
    if (!plan) {
      res.status(400).json(fail('VALIDATION_ERROR', "plan must be 'pro' or 'team'"));
      return;
    }
    const config = checkoutConfig(plan);
    if (!config) {
      res
        .status(501)
        .json(fail('BILLING_NOT_CONFIGURED', 'Stripe checkout is not configured (STRIPE_SECRET_KEY / STRIPE_PRICE_*)'));
      return;
    }
    const user = await UserModel.findById(req.user!.id).select('email stripeCustomerId').lean();
    if (!user) {
      res.status(404).json(fail('NOT_FOUND', 'User not found'));
      return;
    }
    const session = await createCheckoutSession({
      userId: req.user!.id,
      email: user.email,
      plan,
      stripeCustomerId: user.stripeCustomerId,
      ...config,
    });
    res.status(200).json({ success: true, data: session, timestamp: new Date().toISOString() });
  })
);

export default billingRouter;
