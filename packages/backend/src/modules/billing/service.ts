import { UserModel } from '../../models/User.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { ErrorCode } from '@mockia/shared';
import { asPaidPlan, invalidatePlanCache, type BillingStatus, type PaidPlan } from './plans.js';

export interface StripeEvent {
  id: string;
  type: string;
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

async function updateUser(obj: Record<string, any>, set: Record<string, unknown>): Promise<boolean> {
  const filter = userFilter(obj);
  if (!filter) return false;
  const user = await UserModel.findOneAndUpdate(filter, { $set: set }, { new: true }).select('_id');
  if (!user) return false;
  invalidatePlanCache(user._id.toString());
  return true;
}

/**
 * Applies a verified Stripe event. Idempotent (only $set), so Stripe retries are safe.
 * ponytail: no out-of-order guard (event.created vs stored); add a stripeEventAt field if reordering shows up in practice.
 * @returns 'handled' | 'ignored' (unsupported type or nothing to apply)
 */
export async function handleStripeEvent(event: StripeEvent): Promise<'handled' | 'ignored'> {
  const obj = event.data?.object ?? {};
  let applied = false;

  switch (event.type) {
    case 'checkout.session.completed': {
      const plan = asPaidPlan(obj.metadata?.plan);
      // Skip non-subscription sessions and delayed payments not yet paid; subscription.updated(active) follows.
      if (!plan || (obj.mode && obj.mode !== 'subscription') || obj.payment_status === 'unpaid') break;
      applied = await updateUser(obj, {
        plan,
        billingStatus: 'active',
        ...(typeof obj.customer === 'string' && { stripeCustomerId: obj.customer }),
        ...(typeof obj.subscription === 'string' && { stripeSubscriptionId: obj.subscription }),
      });
      break;
    }
    case 'customer.subscription.updated': {
      const plan = asPaidPlan(obj.metadata?.plan);
      applied = await updateUser(obj, {
        billingStatus: STATUS_MAP[obj.status] ?? 'past_due',
        stripeSubscriptionId: obj.id,
        ...(typeof obj.customer === 'string' && { stripeCustomerId: obj.customer }),
        ...(plan && { plan }),
      });
      break;
    }
    case 'customer.subscription.deleted':
      applied = await updateUser(obj, { plan: 'free', billingStatus: 'canceled' });
      break;
    default:
      return 'ignored';
  }

  if (!applied) console.warn(`[Billing] ${event.type} (${event.id}) matched no user or was not applicable`);
  return applied ? 'handled' : 'ignored';
}

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
  const base = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:5173';
  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': input.priceId,
    'line_items[0][quantity]': '1',
    client_reference_id: input.userId,
    success_url: process.env.STRIPE_SUCCESS_URL || `${base}/billing/success`,
    cancel_url: process.env.STRIPE_CANCEL_URL || `${base}/billing/cancel`,
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
