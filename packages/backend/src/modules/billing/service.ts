import { UserModel } from '../../models/User.js';
import { ProjectModel } from '../../models/Project.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { ErrorCode, toLimitsDTO, type BillingOverview } from '@mockia/shared';
import { PLAN_LIMITS, asPaidPlan, effectivePlan, graceEndsAt, invalidatePlanCache, type BillingStatus, type PaidPlan } from './plans.js';
import { notifyPaymentFailed, notifyRefund, notifyTrialWillEnd, type NoticeUser } from './notices.js';
import { getMonthlyUsage, nextPeriodStart } from './usage.js';
import { stripeCheckoutLocale, termsAcceptanceMessage } from './checkoutText.js';
import { appBaseUrl } from '../auth/passwordReset.js';

export interface StripeEvent {
  id: string;
  type: string;
  /** Unix seconds when Stripe created the event. */
  created?: number;
  data: { object: Record<string, any> };
}

const STRIPE_API = 'https://api.stripe.com/v1';

// Stripe subscription.status -> our billingStatus. Unknown statuses fail closed (no paid access).
const STATUS_MAP: Record<string, BillingStatus> = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  incomplete: 'past_due',
  paused: 'past_due',
  canceled: 'canceled',
  incomplete_expired: 'canceled',
};

/** Resolves which user a Stripe object belongs to: our own userId (signed by Stripe metadata) first, then customer id. */
function userFilter(obj: Record<string, any>): Record<string, string> | null {
  const uid = obj.client_reference_id ?? obj.metadata?.userId;
  if (typeof uid === 'string' && /^[0-9a-f]{24}$/i.test(uid)) return { _id: uid };
  if (typeof obj.customer === 'string') return { stripeCustomerId: obj.customer };
  return null;
}

/** The user a Stripe event was applied to, with the fields the notices need. */
type UserHit = NoticeUser & { pastDueSince?: Date | null };

/** The payment-failure sequence is over (billing healthy again, or the subscription is gone). */
const SEQUENCE_OVER = { pastDueSince: null, lastPaymentFailedInvoiceId: null };

const PAID_PLANS = ['pro', 'team'];

/** Events younger than this may still be racing checkout.session.completed, which is what links a Stripe customer to a user. */
const LINK_RACE_WINDOW_MS = 60 * 60 * 1000;

interface UpdateOptions {
  /** 'start': enter past_due (the grace begins at the event time and never moves once set). 'clear': the failure sequence is over. */
  pastDue?: 'start' | 'clear';
  /** Extra conditions of the atomic update (e.g. only paying users; only past_due users). */
  where?: Record<string, unknown>;
}

/**
 * Applies `set` to the user of the Stripe object, atomically and at most once per event.
 * Resolves to the user document when applied; 'unknown' when no user is linked to the object (handleStripeEvent decides whether
 * Stripe should retry); 'skipped' when a user exists but nothing was applied (replay, out-of-order, not applicable).
 */
async function updateUser(
  event: StripeEvent,
  obj: Record<string, any>,
  set: Record<string, unknown>,
  { pastDue, where }: UpdateOptions = {}
): Promise<UserHit | 'unknown' | 'skipped'> {
  const base = userFilter(obj);
  if (!base) return 'skipped'; // nothing to identify a user by (e.g. a guest charge)
  let filter: Record<string, unknown> = { ...base, ...where };
  let fields: Record<string, unknown> = { ...set, ...(pastDue === 'clear' && SEQUENCE_OVER) };
  // Replay / out-of-order guard: skip an event already applied or older than the last one applied for this user
  // (a delayed subscription.updated(active) must not resurrect a plan after subscription.deleted).
  if (typeof event.id === 'string' && Number.isFinite(event.created)) {
    const at = new Date(event.created! * 1000);
    filter = {
      ...filter,
      stripeLastEventId: { $ne: event.id },
      $or: [{ stripeEventAt: { $exists: false } }, { stripeEventAt: { $lte: at } }],
    };
    fields = { ...fields, stripeEventAt: at, stripeLastEventId: event.id };
  }
  if (Object.keys(fields).length === 0) return 'skipped'; // a notice-only event without id/timestamp cannot be deduplicated: do nothing

  // The grace period starts at the FIRST failure and a later failure never extends it: pastDueSince only takes the event time
  // while it is empty. That needs an update pipeline ($ifNull); every value goes through $literal so nothing is read as an expression.
  const update =
    pastDue === 'start'
      ? [
          {
            $set: {
              ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { $literal: v }])),
              pastDueSince: { $ifNull: ['$pastDueSince', Number.isFinite(event.created) ? new Date(event.created! * 1000) : new Date()] },
            },
          },
        ]
      : { $set: fields };

  const user = await UserModel.findOneAndUpdate(filter, update, { new: true }).select('_id email username locale plan pastDueSince');
  if (!user) return (await UserModel.exists(base)) ? 'skipped' : 'unknown';
  invalidatePlanCache(user._id.toString());
  return user;
}

/**
 * Paid plan of a subscription. The price is the source of truth (a plan switch in the customer portal
 * changes the price but not our metadata); metadata.plan is the fallback for unknown price ids.
 */
export function planFromSubscription(sub: Record<string, any>): PaidPlan | undefined {
  const priceId = sub.items?.data?.[0]?.price?.id ?? sub.plan?.id;
  if (typeof priceId === 'string') {
    if (priceId === process.env.STRIPE_PRICE_PRO) return 'pro';
    if (priceId === process.env.STRIPE_PRICE_TEAM) return 'team';
  }
  return asPaidPlan(sub.metadata?.plan);
}

/** Billing period end and scheduled cancellation, only for the fields present on the subscription. */
function periodFields(sub: Record<string, any>): Record<string, unknown> {
  // Newer Stripe API versions moved current_period_end to the subscription items.
  const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  const hasCancelInfo = typeof sub.cancel_at_period_end === 'boolean' || 'cancel_at' in sub;
  return {
    ...(Number.isFinite(end) && { currentPeriodEnd: new Date(end * 1000) }),
    ...(hasCancelInfo && { cancelAtPeriodEnd: sub.cancel_at_period_end === true || Number.isFinite(sub.cancel_at) }),
  };
}

/** First failed invoice of a sequence announces itself once: claim the sequence atomically, then email + in-app. */
async function announcePaymentFailure(user: UserHit, invoiceId: string, failedAt: Date): Promise<void> {
  const claim = await UserModel.updateOne({ _id: user._id, lastPaymentFailedInvoiceId: null }, { $set: { lastPaymentFailedInvoiceId: invoiceId } });
  if (claim.modifiedCount !== 1) return; // this sequence was already announced (retry of the same invoice, or a second failed invoice)
  await notifyPaymentFailed(user, user.pastDueSince ? new Date(user.pastDueSince) : failedAt);
}

/**
 * Applies a verified Stripe event. Idempotent: only $set (plus the $ifNull pipeline that starts the grace period), with a per-user
 * event id / timestamp guard against replays and out-of-order delivery. Notices (email, in-app) go out only when an event is applied.
 * @returns 'handled' | 'ignored' (unsupported type, nothing to apply, stale/duplicate event, or an old event of an unknown customer)
 *          | 'retry' (a young event for a customer that is not linked to a user yet: the route answers 500 so Stripe delivers it again)
 */
export async function handleStripeEvent(event: StripeEvent): Promise<'handled' | 'ignored' | 'retry'> {
  const obj = event.data?.object ?? {};
  const eventAt = Number.isFinite(event.created) ? new Date(event.created! * 1000) : new Date();
  let result: Awaited<ReturnType<typeof updateUser>> = 'skipped';
  let afterApplied: ((user: UserHit) => Promise<void>) | undefined;

  switch (event.type) {
    case 'checkout.session.completed': {
      const plan = asPaidPlan(obj.metadata?.plan);
      // Skip non-subscription sessions and delayed payments not yet paid; subscription.updated(active) follows.
      if (!plan || (obj.mode && obj.mode !== 'subscription') || obj.payment_status === 'unpaid') break;
      result = await updateUser(
        event,
        obj,
        {
          plan,
          billingStatus: 'active',
          ...(typeof obj.customer === 'string' && { stripeCustomerId: obj.customer }),
          ...(typeof obj.subscription === 'string' && { stripeSubscriptionId: obj.subscription }),
        },
        { pastDue: 'clear' }
      );
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const plan = planFromSubscription(obj);
      const billingStatus = STATUS_MAP[obj.status] ?? 'past_due';
      // Only Stripe's own past_due (a renewal failed, retries pending) opens a grace period. unpaid / incomplete / paused / unknown
      // statuses have no paid access to extend (a half-finished first checkout must not buy 7 days of a paid plan).
      const pastDue = obj.status === 'past_due' ? 'start' : billingStatus === 'past_due' ? undefined : 'clear';
      result = await updateUser(
        event,
        obj,
        {
          billingStatus,
          stripeSubscriptionId: obj.id,
          ...(typeof obj.customer === 'string' && { stripeCustomerId: obj.customer }),
          ...(plan && { plan }),
          ...periodFields(obj),
        },
        { pastDue }
      );
      break;
    }
    case 'customer.subscription.deleted':
      result = await updateUser(
        event,
        obj,
        { plan: 'free', billingStatus: 'canceled', cancelAtPeriodEnd: false, currentPeriodEnd: null },
        { pastDue: 'clear' }
      );
      break;
    case 'invoice.payment_failed': {
      // The very first invoice of a subscription failing means checkout never completed: no paid access was granted, nothing to degrade.
      if (obj.billing_reason === 'subscription_create') return 'ignored';
      const invoiceId = typeof obj.id === 'string' ? obj.id : String(event.id);
      result = await updateUser(event, obj, { billingStatus: 'past_due' }, { pastDue: 'start', where: { plan: { $in: PAID_PLANS } } });
      afterApplied = (user) => announcePaymentFailure(user, invoiceId, eventAt);
      break;
    }
    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      const invoiceId = typeof obj.id === 'string' ? obj.id : null;
      // Back to active only from past_due, and not because of an unrelated invoice while the failed one is still open.
      result = await updateUser(
        event,
        obj,
        { billingStatus: 'active' },
        { pastDue: 'clear', where: { billingStatus: 'past_due', lastPaymentFailedInvoiceId: { $in: [invoiceId, null] } } }
      );
      break;
    }
    case 'customer.subscription.trial_will_end': {
      if (!Number.isFinite(obj.trial_end)) break;
      result = await updateUser(event, obj, {});
      afterApplied = (user) => notifyTrialWillEnd(user, new Date(obj.trial_end * 1000));
      break;
    }
    case 'charge.refunded':
      // Notice only: a cancellation that goes with a refund arrives as customer.subscription.deleted.
      result = await updateUser(event, obj, {});
      afterApplied = (user) => notifyRefund(user, { amount: obj.amount_refunded, currency: obj.currency });
      break;
    default:
      return 'ignored';
  }

  if (typeof result !== 'string') {
    await afterApplied?.(result);
    return 'handled';
  }
  if (result === 'unknown') {
    // Event ids only in the logs: a Stripe customer id or an address would be personal data in the log files.
    if (Number.isFinite(event.created) && Date.now() - event.created! * 1000 < LINK_RACE_WINDOW_MS) {
      console.warn(`[Billing] ${event.type} (${event.id}): no user is linked to the customer yet, asking Stripe to retry`);
      return 'retry';
    }
    console.warn(`[Billing] ${event.type} (${event.id}): no user is linked to the customer, dropping the event`);
    return 'ignored';
  }
  console.warn(`[Billing] ${event.type} (${event.id}) was not applicable or already applied`);
  return 'ignored';
}

const frontendBase = () =>
  (process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:5173').replace(/\/+$/, '');

/** Checkout config from env; null when Stripe is not configured for that plan. */
export function checkoutConfig(plan: PaidPlan): { secretKey: string; priceId: string } | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = plan === 'pro' ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_TEAM;
  return secretKey && priceId ? { secretKey, priceId } : null;
}

/**
 * Creates a Stripe Checkout Session (subscription mode) through the REST API with native fetch.
 *
 * Tax and invoicing: Stripe Tax computes VAT (prices must be tax_behavior=exclusive in the dashboard, see docs/pagos.md),
 * the buyer can enter a VAT id, the billing address is mandatory and the Terms must be accepted (the accompanying text carries
 * the immediate-access / withdrawal-waiver acknowledgement promised in the Terms). Subscription-mode checkouts always produce an
 * invoice, so `invoice_creation` (only valid for mode=payment) is deliberately NOT sent.
 */
export async function createCheckoutSession(input: {
  userId: string;
  email: string;
  plan: PaidPlan;
  stripeCustomerId?: string;
  /** Saved UI language of the user (en | es | zh); anything else lets Stripe detect it. */
  locale?: string | null;
  secretKey: string;
  priceId: string;
}): Promise<{ id: string; url: string }> {
  const base = frontendBase();
  const params = new URLSearchParams({
    mode: 'subscription',
    allow_promotion_codes: 'true',
    'line_items[0][price]': input.priceId,
    'line_items[0][quantity]': '1',
    client_reference_id: input.userId,
    success_url: process.env.STRIPE_SUCCESS_URL || `${base}/billing?checkout=success`,
    cancel_url: process.env.STRIPE_CANCEL_URL || `${base}/billing?checkout=cancel`,
    'metadata[plan]': input.plan,
    'metadata[userId]': input.userId,
    'subscription_data[metadata][plan]': input.plan,
    'subscription_data[metadata][userId]': input.userId,
    'automatic_tax[enabled]': 'true',
    'tax_id_collection[enabled]': 'true',
    billing_address_collection: 'required',
    'consent_collection[terms_of_service]': 'required',
    'custom_text[terms_of_service_acceptance][message]': termsAcceptanceMessage(input.locale, `${appBaseUrl()}/terms`),
    locale: stripeCheckoutLocale(input.locale),
  });
  if (input.stripeCustomerId) {
    params.set('customer', input.stripeCustomerId);
    // Stripe requires these two with an existing customer when automatic_tax / tax_id_collection are on, and rejects them with customer_email.
    params.set('customer_update[address]', 'auto');
    params.set('customer_update[name]', 'auto');
  } else {
    params.set('customer_email', input.email);
  }

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
    signal: AbortSignal.timeout(10_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.url !== 'string') {
    // Never echo Stripe's body or the key back to the client; log the Stripe error message only.
    console.error('[Billing] Stripe checkout failed:', res.status, data?.error?.message);
    throw new AppError('Could not create checkout session', ErrorCode.EXTERNAL_SERVICE_ERROR, 502);
  }
  return { id: data.id, url: data.url };
}

/** A live (or unpaid) subscription already exists: plan changes go through the customer portal, not a second checkout. */
export function hasOpenSubscription(user: { plan?: string | null; billingStatus?: string | null; stripeSubscriptionId?: string | null }): boolean {
  return Boolean(user.stripeSubscriptionId && asPaidPlan(user.plan) && user.billingStatus !== 'canceled');
}

/**
 * Creates a Stripe customer portal session (update card, invoices, switch plan, cancel).
 * The portal must be configured once in the Stripe dashboard (Settings > Billing > Customer portal),
 * including the Pro and Team prices if plan switching should be offered.
 */
export async function createPortalSession(input: { customerId: string; secretKey: string }): Promise<{ url: string }> {
  const params = new URLSearchParams({
    customer: input.customerId,
    return_url: process.env.STRIPE_PORTAL_RETURN_URL || `${frontendBase()}/billing`,
  });
  const res = await fetch(`${STRIPE_API}/billing_portal/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
    signal: AbortSignal.timeout(10_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.url !== 'string') {
    console.error('[Billing] Stripe portal failed:', res.status, data?.error?.message);
    throw new AppError('Could not open the billing portal', ErrorCode.EXTERNAL_SERVICE_ERROR, 502);
  }
  return { url: data.url };
}

/**
 * Cancels a subscription IMMEDIATELY in Stripe (DELETE /v1/subscriptions/{id}): no further charge, no proration refund.
 * Used by account deletion, which must not leave a live subscription behind. A subscription Stripe no longer knows
 * (404 resource_missing) counts as already cancelled. The Stripe customer record is kept by Stripe (fiscal duties).
 *
 * @throws AppError 502 if Stripe does not confirm the cancellation (the caller must then delete nothing)
 */
export async function cancelSubscriptionNow(subscriptionId: string, secretKey: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${STRIPE_API}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${secretKey}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error('[Billing] Stripe subscription cancel failed:', err instanceof Error ? err.message : err);
    throw new AppError('Could not cancel your subscription. Nothing was deleted; try again later.', ErrorCode.EXTERNAL_SERVICE_ERROR, 502);
  }
  if (res.ok) return;
  const data: any = await res.json().catch(() => ({}));
  if (res.status === 404 && data?.error?.code === 'resource_missing') return;
  console.error('[Billing] Stripe subscription cancel failed:', res.status, data?.error?.message);
  throw new AppError('Could not cancel your subscription. Nothing was deleted; try again later.', ErrorCode.EXTERNAL_SERVICE_ERROR, 502);
}

/** Plan, limits and usage of the current billing period, for the billing page. */
export async function getBillingOverview(userId: string, now = new Date()): Promise<BillingOverview> {
  const user = await UserModel.findById(userId)
    .select('plan billingStatus pastDueSince stripeCustomerId cancelAtPeriodEnd currentPeriodEnd')
    .lean();
  if (!user) throw new AppError('User not found', ErrorCode.NOT_FOUND, 404);

  const plan = effectivePlan(user, now.getTime());
  const [activeProjects, monthlyRequests] = await Promise.all([
    ProjectModel.countDocuments({ ownerId: userId, isArchived: { $ne: true } }),
    getMonthlyUsage(userId, now),
  ]);
  const stripeReady = Boolean(process.env.STRIPE_SECRET_KEY);

  return {
    plan,
    subscribedPlan: asPaidPlan(user.plan) ?? 'free',
    billingStatus: (user.billingStatus as BillingStatus) ?? 'active',
    cancelAtPeriodEnd: Boolean(user.cancelAtPeriodEnd),
    currentPeriodEnd: user.currentPeriodEnd ? new Date(user.currentPeriodEnd).toISOString() : null,
    pastDueUntil: graceEndsAt(user)?.toISOString() ?? null,
    limits: toLimitsDTO(PLAN_LIMITS[plan]),
    usage: { activeProjects, monthlyRequests, periodResetAt: nextPeriodStart(now).toISOString() },
    canManageBilling: stripeReady && Boolean(user.stripeCustomerId),
    checkoutAvailable: { pro: Boolean(checkoutConfig('pro')), team: Boolean(checkoutConfig('team')) },
  };
}
