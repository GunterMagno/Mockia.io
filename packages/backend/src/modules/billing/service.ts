import { UserModel } from '../../models/User.js';
import { ProjectModel } from '../../models/Project.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { ErrorCode, toLimitsDTO, type BillingOverview } from '@mockia/shared';
import { PLAN_LIMITS, asPaidPlan, effectivePlan, invalidatePlanCache, type BillingStatus, type PaidPlan } from './plans.js';
import { getMonthlyUsage, nextPeriodStart } from './usage.js';

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

async function updateUser(event: StripeEvent, obj: Record<string, any>, set: Record<string, unknown>): Promise<boolean> {
  const base = userFilter(obj);
  if (!base) return false;
  let filter: Record<string, unknown> = base;
  let update = set;
  // Replay / out-of-order guard: skip an event already applied or older than the last one applied for this user
  // (a delayed subscription.updated(active) must not resurrect a plan after subscription.deleted).
  if (typeof event.id === 'string' && Number.isFinite(event.created)) {
    const at = new Date(event.created! * 1000);
    filter = {
      ...base,
      stripeLastEventId: { $ne: event.id },
      $or: [{ stripeEventAt: { $exists: false } }, { stripeEventAt: { $lte: at } }],
    };
    update = { ...set, stripeEventAt: at, stripeLastEventId: event.id };
  }
  const user = await UserModel.findOneAndUpdate(filter, { $set: update }, { new: true }).select('_id');
  if (!user) return false;
  invalidatePlanCache(user._id.toString());
  return true;
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

/**
 * Applies a verified Stripe event. Idempotent: only $set, plus a per-user event id / timestamp guard against replays and out-of-order delivery.
 * @returns 'handled' | 'ignored' (unsupported type or nothing to apply, or stale/duplicate event)
 */
export async function handleStripeEvent(event: StripeEvent): Promise<'handled' | 'ignored'> {
  const obj = event.data?.object ?? {};
  let applied = false;

  switch (event.type) {
    case 'checkout.session.completed': {
      const plan = asPaidPlan(obj.metadata?.plan);
      // Skip non-subscription sessions and delayed payments not yet paid; subscription.updated(active) follows.
      if (!plan || (obj.mode && obj.mode !== 'subscription') || obj.payment_status === 'unpaid') break;
      applied = await updateUser(event, obj, {
        plan,
        billingStatus: 'active',
        ...(typeof obj.customer === 'string' && { stripeCustomerId: obj.customer }),
        ...(typeof obj.subscription === 'string' && { stripeSubscriptionId: obj.subscription }),
      });
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const plan = planFromSubscription(obj);
      applied = await updateUser(event, obj, {
        billingStatus: STATUS_MAP[obj.status] ?? 'past_due',
        stripeSubscriptionId: obj.id,
        ...(typeof obj.customer === 'string' && { stripeCustomerId: obj.customer }),
        ...(plan && { plan }),
        ...periodFields(obj),
      });
      break;
    }
    case 'customer.subscription.deleted':
      applied = await updateUser(event, obj, {
        plan: 'free',
        billingStatus: 'canceled',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
      });
      break;
    default:
      return 'ignored';
  }

  if (!applied) console.warn(`[Billing] ${event.type} (${event.id}) matched no user or was not applicable`);
  return applied ? 'handled' : 'ignored';
}

const frontendBase = () =>
  (process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:5173').replace(/\/+$/, '');

/** Checkout config from env; null when Stripe is not configured for that plan. */
export function checkoutConfig(plan: PaidPlan): { secretKey: string; priceId: string } | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = plan === 'pro' ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_TEAM;
  return secretKey && priceId ? { secretKey, priceId } : null;
}

/** Creates a Stripe Checkout Session (subscription mode) through the REST API with native fetch. */
export async function createCheckoutSession(input: {
  userId: string;
  email: string;
  plan: PaidPlan;
  stripeCustomerId?: string;
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
  });
  if (input.stripeCustomerId) params.set('customer', input.stripeCustomerId);
  else params.set('customer_email', input.email);

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
    .select('plan billingStatus stripeCustomerId cancelAtPeriodEnd currentPeriodEnd')
    .lean();
  if (!user) throw new AppError('User not found', ErrorCode.NOT_FOUND, 404);

  const plan = effectivePlan(user);
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
    limits: toLimitsDTO(PLAN_LIMITS[plan]),
    usage: { activeProjects, monthlyRequests, periodResetAt: nextPeriodStart(now).toISOString() },
    canManageBilling: stripeReady && Boolean(user.stripeCustomerId),
    checkoutAvailable: { pro: Boolean(checkoutConfig('pro')), team: Boolean(checkoutConfig('team')) },
  };
}
