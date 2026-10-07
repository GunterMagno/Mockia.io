import express, { Router } from 'express';
import type { BillingInterval, PaidPlan } from '@mockia/shared';
import { asyncHandler } from '../../middlewares/errorHandler.js';
import { authenticateToken, type AuthenticatedRequest } from '../../middlewares/authenticateToken.js';
import { requireVerifiedEmail } from '../../middlewares/requireVerifiedEmail.js';
import { UserModel } from '../../models/User.js';
import { rateLimit } from '../../middlewares/rateLimit.js';
import { validate } from '../../middlewares/validateRequest.js';
import { checkoutSchema } from './validation.js';
import { verifyStripeSignature } from './stripeSignature.js';
import {
  checkoutConfig,
  createCheckoutSession,
  createPortalSession,
  getBillingOverview,
  handleStripeEvent,
  hasOpenSubscription,
  missingCheckoutConfig,
  type StripeEvent,
} from './service.js';

/**
 * Billing router, mounted at /api/billing.
 *
 * IMPORTANT: mount it BEFORE the global `express.json()` in index.ts. The webhook needs the raw
 * bytes for signature verification (express.raw here), and once a body parser has run the raw body is gone.
 * Body parsers skip requests already parsed, so /checkout carries its own express.json().
 *
 * Env: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, STRIPE_PRICE_TEAM, STRIPE_PRICE_PRO_YEARLY, STRIPE_PRICE_TEAM_YEARLY,
 *      optional FRONTEND_URL / STRIPE_SUCCESS_URL / STRIPE_CANCEL_URL / STRIPE_PORTAL_RETURN_URL.
 * The global /api limiter skips /api/billing (the webhook must never be throttled), so the
 * user-facing Stripe calls get their own per-user limiter here.
 */
export const billingRouter = Router();

const stripeCallLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyFn: (req) => (req as AuthenticatedRequest).user?.id ?? req.ip ?? 'unknown',
});

const fail = (code: string, message: string) => ({
  success: false,
  error: { code, message },
  timestamp: new Date().toISOString(),
});

/**
 * POST /api/billing/webhook  (called by Stripe, no JWT; authenticity = Stripe-Signature)
 * 200 handled/ignored, 400 bad signature or payload, 500 temporary failure (DB error, or a young event for a customer not linked to
 * a user yet: Stripe retries), 501 webhook secret not configured.
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
    if (result === 'retry') {
      // A young event for a customer no user is linked to yet (it overtook checkout.session.completed): Stripe delivers it again later
      res.status(500).json(fail('BILLING_USER_NOT_LINKED', 'No user is linked to this Stripe customer yet'));
      return;
    }
    res.status(200).json({ received: true, result });
  })
);

/**
 * GET /api/billing/me  plan, limits and usage of the current month (see BillingOverview in @mockia/shared).
 */
billingRouter.get(
  '/me',
  authenticateToken,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const data = await getBillingOverview(req.user!.id);
    res.status(200).json({ success: true, data, timestamp: new Date().toISOString() });
  })
);

/**
 * POST /api/billing/checkout  body: { plan: 'pro' | 'team', interval?: 'month' | 'year' }  (interval defaults to 'month')
 * 200 { url } (redirect the browser there), 400 invalid plan or interval, 401, 403 EMAIL_NOT_VERIFIED (when email verification is required), 409 already subscribed (use the portal),
 * 501 Stripe not configured for that plan and interval (the message names the missing env var), 502 Stripe error.
 */
billingRouter.post(
  '/checkout',
  authenticateToken,
  requireVerifiedEmail,
  stripeCallLimiter,
  express.json({ limit: '10kb' }),
  validate({ body: checkoutSchema }),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { plan, interval } = req.body as { plan: PaidPlan; interval: BillingInterval };
    const config = checkoutConfig(plan, interval);
    if (!config) {
      res
        .status(501)
        .json(fail('BILLING_NOT_CONFIGURED', `Stripe checkout is not configured for this plan and billing interval (missing ${missingCheckoutConfig(plan, interval).join(', ')})`));
      return;
    }
    const user = await UserModel.findById(req.user!.id)
      .select('email locale stripeCustomerId stripeSubscriptionId plan billingStatus')
      .lean();
    if (!user) {
      res.status(404).json(fail('NOT_FOUND', 'User not found'));
      return;
    }
    if (hasOpenSubscription(user)) {
      // A second Checkout would create a second subscription: switching plans or fixing a payment is done in the portal.
      res.status(409).json(fail('ALREADY_SUBSCRIBED', 'You already have a subscription. Manage it from the billing portal.'));
      return;
    }
    const session = await createCheckoutSession({
      userId: req.user!.id,
      email: user.email,
      plan,
      interval,
      stripeCustomerId: user.stripeCustomerId,
      locale: user.locale,
      ...config,
    });
    res.status(200).json({ success: true, data: session, timestamp: new Date().toISOString() });
  })
);

/**
 * POST /api/billing/portal  Stripe customer portal session for the current user.
 * 200 { url }, 401, 409 NO_BILLING_ACCOUNT (never subscribed), 501 Stripe not configured, 502 Stripe error.
 */
billingRouter.post(
  '/portal',
  authenticateToken,
  requireVerifiedEmail,
  stripeCallLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      res.status(501).json(fail('BILLING_NOT_CONFIGURED', 'Stripe is not configured (STRIPE_SECRET_KEY)'));
      return;
    }
    const user = await UserModel.findById(req.user!.id).select('stripeCustomerId').lean();
    if (!user?.stripeCustomerId) {
      res.status(409).json(fail('NO_BILLING_ACCOUNT', 'There is no billing account yet. Subscribe to a plan first.'));
      return;
    }
    const session = await createPortalSession({ customerId: user.stripeCustomerId, secretKey });
    res.status(200).json({ success: true, data: session, timestamp: new Date().toISOString() });
  })
);

export default billingRouter;
