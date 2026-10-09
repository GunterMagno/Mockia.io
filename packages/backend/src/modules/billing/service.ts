import { UserModel } from '../../models/User.js';
import { ProjectModel } from '../../models/Project.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { ErrorCode, isBillingInterval, toLimitsDTO, type BillingInterval, type BillingOverview } from '@mockia/shared';
import { PLAN_LIMITS, asPaidPlan, effectivePlan, graceEndsAt, invalidatePlanCache, type BillingStatus, type PaidPlan } from './plans.js';
import { notifyPaymentFailed, notifyRefund, notifyTrialWillEnd, type NoticeUser } from './notices.js';
import { getMonthlyUsage, nextPeriodStart } from './usage.js';
import { stripeCheckoutLocale, termsAcceptanceMessage } from './checkoutText.js';
import { appBaseUrl } from '../auth/passwordReset.js';
import { planAndIntervalOfPrice, priceEnvName, priceIdFor } from './prices.js';

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

const PAID_PLANS = ['starter', 'pro', 'team'];

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
    // Stripe stamps events with whole seconds and sends several in the same second in any order. On a tie the order is
    // unknown, so a move to past_due never overrides an ACTIVE user: a stale "worse" event of that second (e.g. a
    // subscription that was incomplete while its first payment was being confirmed) would otherwise leave a paying
    // customer without their plan for a whole period. canceled is terminal in Stripe, so it always applies.
    const notOlder =
      fields.billingStatus === 'past_due'
        ? [{ stripeEventAt: { $lt: at } }, { stripeEventAt: at, billingStatus: { $ne: 'active' } }]
        : [{ stripeEventAt: { $lte: at } }];
    filter = {
      ...filter,
      stripeLastEventId: { $ne: event.id },
      $or: [{ stripeEventAt: { $exists: false } }, ...notOlder],
    };
    fields = { ...fields, stripeEventAt: at, stripeLastEventId: event.id };
  }
  if (Object.keys(fields).length === 0) return 'skipped'; // nothing to write (defensive: every caller sets something)

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

/** Price id of the first item of a subscription (the legacy `plan` object on old API versions). */
function priceIdOf(sub: Record<string, any>): unknown {
  return sub.items?.data?.[0]?.price?.id ?? sub.plan?.id;
}

/** Plan and billing interval of a subscription, from its price id. Only the six configured prices count; anything else is undefined. */
export function subscriptionPrice(sub: Record<string, any>) {
  return planAndIntervalOfPrice(priceIdOf(sub));
}

/**
 * Paid plan of a subscription. The price is the source of truth (a plan switch in the customer portal
 * changes the price but not our metadata). A price id we do not know NEVER grants a plan, not even through metadata.plan:
 * metadata.plan is only the fallback when the event carries no price at all (old subscriptions, trimmed payloads).
 */
export function planFromSubscription(sub: Record<string, any>): PaidPlan | undefined {
  const priceId = priceIdOf(sub);
  if (typeof priceId === 'string' && priceId !== '') return planAndIntervalOfPrice(priceId)?.plan;
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

/** How many notice-only event ids are remembered per user (enough to absorb Stripe's redeliveries; the oldest are dropped). */
const NOTICE_IDS_KEPT = 20;

/**
 * Claims a notice-only event (trial ending, refund) for its user: atomically, once per event id. It changes NO billing state, so
 * it deliberately stays out of the stripeEventAt / stripeLastEventId guard: otherwise a refund created a second after a cancellation
 * but delivered first would make the (older) subscription.deleted look stale and leave the user on a paid plan for good.
 * Same result contract as updateUser; an event without id cannot be deduplicated and is skipped.
 */
async function claimNoticeEvent(event: StripeEvent, obj: Record<string, any>): Promise<UserHit | 'unknown' | 'skipped'> {
  const base = userFilter(obj);
  if (!base || typeof event.id !== 'string') return 'skipped';
  const user = await UserModel.findOneAndUpdate(
    { ...base, noticeEventIds: { $ne: event.id } },
    { $push: { noticeEventIds: { $each: [event.id], $slice: -NOTICE_IDS_KEPT } } },
    { new: true }
  ).select('_id email username locale plan pastDueSince');
  if (!user) return (await UserModel.exists(base)) ? 'skipped' : 'unknown';
  return user;
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
          // The interval chosen at checkout (our own metadata); subscription.created/updated refine it from the price right after
          ...(isBillingInterval(obj.metadata?.interval) && { billingInterval: obj.metadata.interval }),
          ...(typeof obj.customer === 'string' && { stripeCustomerId: obj.customer }),
          ...(typeof obj.subscription === 'string' && { stripeSubscriptionId: obj.subscription }),
        },
        { pastDue: 'clear' }
      );
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      // A subscription created as incomplete (first payment still being confirmed) or incomplete_expired (never paid)
      // says nothing about access: checkout.session.completed / subscription.updated(active) grant the plan, and a
      // half-finished checkout must neither grant it nor degrade a user. Only the ids are linked.
      if (event.type === 'customer.subscription.created' && ['incomplete', 'incomplete_expired'].includes(obj.status)) {
        result = await updateUser(event, obj, {
          stripeSubscriptionId: obj.id,
          ...(typeof obj.customer === 'string' && { stripeCustomerId: obj.customer }),
        });
        break;
      }
      const priced = subscriptionPrice(obj);
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
          ...(priced && { billingInterval: priced.interval }),
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
      result = await claimNoticeEvent(event, obj);
      afterApplied = (user) => notifyTrialWillEnd(user, new Date(obj.trial_end * 1000));
      break;
    }
    case 'charge.refunded':
      // Notice only: a cancellation that goes with a refund arrives as customer.subscription.deleted.
      result = await claimNoticeEvent(event, obj);
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

/** Checkout config from env; null when Stripe is not configured for that plan and interval. */
export function checkoutConfig(plan: PaidPlan, interval: BillingInterval = 'month'): { secretKey: string; priceId: string } | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = priceIdFor(plan, interval);
  return secretKey && priceId ? { secretKey, priceId } : null;
}

/** Names of the env vars that keep checkout from working for that plan and interval (empty = configured). */
export function missingCheckoutConfig(plan: PaidPlan, interval: BillingInterval = 'month'): string[] {
  return [
    ...(process.env.STRIPE_SECRET_KEY ? [] : ['STRIPE_SECRET_KEY']),
    ...(priceIdFor(plan, interval) ? [] : [priceEnvName(plan, interval)]),
  ];
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
  /** Billing interval of the chosen price (priceId must be that plan's price for it). Defaults to monthly. */
  interval?: BillingInterval;
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
    'metadata[interval]': input.interval ?? 'month',
    'metadata[userId]': input.userId,
    'subscription_data[metadata][plan]': input.plan,
    'subscription_data[metadata][interval]': input.interval ?? 'month',
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
 * including the Starter, Pro and Team prices if plan switching should be offered.
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

const cancelFailed = () =>
  new AppError('Could not cancel your subscription. Nothing was deleted; try again later.', ErrorCode.EXTERNAL_SERVICE_ERROR, 502);

/** Stripe statuses of a subscription that can still charge the customer (or become chargeable). */
const LIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']);
/** Statuses that mean the subscription is already over. */
const DEAD_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete_expired']);
/** Pages of 100 subscriptions read per customer at most (a customer never has that many; it only bounds a bad loop). */
const MAX_SUBSCRIPTION_PAGES = 10;

async function stripeFetch(url: string, secretKey: string, method: 'GET' | 'DELETE'): Promise<Response> {
  try {
    return await fetch(url, { method, headers: { Authorization: `Bearer ${secretKey}` }, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    console.error(`[Billing] Stripe ${method} failed:`, err instanceof Error ? err.name : 'unknown error');
    throw cancelFailed();
  }
}

/**
 * Cancels a subscription immediately (account deletion). Idempotent: a subscription Stripe no longer knows (404), or one
 * that a non-OK answer turns out to have already ended (re-read with a GET: canceled / incomplete_expired), counts as
 * cancelled. Only the status and Stripe's error code are logged.
 * @throws AppError 502 when it could not be cancelled
 */
export async function cancelSubscriptionNow(subscriptionId: string, secretKey: string): Promise<void> {
  const url = `${STRIPE_API}/subscriptions/${encodeURIComponent(subscriptionId)}`;
  const res = await stripeFetch(url, secretKey, 'DELETE');
  if (res.ok) return;
  const data: any = await res.json().catch(() => ({}));
  if (res.status === 404 && data?.error?.code === 'resource_missing') return;
  // The cancel may have raced with Stripe's own (e.g. the last dunning retry): check what the subscription is now
  const check = await stripeFetch(url, secretKey, 'GET').catch(() => null);
  const current: any = check?.ok ? await check.json().catch(() => ({})) : null;
  if (current && DEAD_SUBSCRIPTION_STATUSES.has(current.status)) return;
  console.error('[Billing] Stripe subscription cancel failed:', res.status, data?.error?.code ?? '');
  throw cancelFailed();
}

/** Ids of the customer's subscriptions that can still charge (every page, up to a sane cap). */
export async function listLiveSubscriptionIds(customerId: string, secretKey: string): Promise<string[]> {
  const ids: string[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_SUBSCRIPTION_PAGES; page++) {
    const params = new URLSearchParams({ customer: customerId, status: 'all', limit: '100' });
    if (startingAfter) params.set('starting_after', startingAfter);
    const res = await stripeFetch(`${STRIPE_API}/subscriptions?${params}`, secretKey, 'GET');
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(body?.data)) {
      console.error('[Billing] Stripe subscription list failed:', res.status, body?.error?.code ?? '');
      throw cancelFailed();
    }
    for (const sub of body.data) {
      if (typeof sub?.id === 'string' && LIVE_SUBSCRIPTION_STATUSES.has(sub.status)) ids.push(sub.id);
    }
    const last = body.data[body.data.length - 1]?.id;
    if (!body.has_more || typeof last !== 'string') return ids;
    startingAfter = last;
  }
  console.warn('[Billing] Stopped listing subscriptions after the page cap');
  return ids;
}

/**
 * Account deletion: cancels EVERY subscription of the user that can still charge the card, not only the one we stored
 * (a second checkout in another tab, or one created in the dashboard, would otherwise outlive the account). The stored
 * one goes first; then, with a customer id, every live subscription Stripe lists for it. After the stored one is
 * cancelled `billingStatus: 'canceled'` is written at once, so a retry after a later failure does not try it again.
 * @throws AppError 502 when any of them could not be cancelled or the list could not be read (the caller deletes nothing)
 */
export async function cancelAllSubscriptions(
  user: { _id: unknown; stripeCustomerId?: string | null; stripeSubscriptionId?: string | null; billingStatus?: string | null },
  secretKey: string
): Promise<void> {
  const markCanceled = () =>
    UserModel.updateOne({ _id: user._id }, { $set: { billingStatus: 'canceled', plan: 'free', cancelAtPeriodEnd: false } });
  const done = new Set<string>();
  if (user.stripeSubscriptionId && user.billingStatus !== 'canceled') {
    await cancelSubscriptionNow(user.stripeSubscriptionId, secretKey);
    done.add(user.stripeSubscriptionId);
    await markCanceled();
    invalidatePlanCache(String(user._id));
  }
  if (user.stripeCustomerId) {
    for (const id of await listLiveSubscriptionIds(user.stripeCustomerId, secretKey)) {
      if (done.has(id)) continue;
      await cancelSubscriptionNow(id, secretKey);
      done.add(id);
    }
  }
}

/** Plan, limits and usage of the current billing period, for the billing page. */
export async function getBillingOverview(userId: string, now = new Date()): Promise<BillingOverview> {
  const user = await UserModel.findById(userId)
    .select('plan billingStatus billingInterval pastDueSince stripeCustomerId cancelAtPeriodEnd currentPeriodEnd')
    .lean();
  if (!user) throw new AppError('User not found', ErrorCode.NOT_FOUND, 404);

  const plan = effectivePlan(user, now.getTime());
  const [activeProjects, monthlyRequests] = await Promise.all([
    ProjectModel.countDocuments({ ownerId: userId, isArchived: { $ne: true } }),
    getMonthlyUsage(userId, now),
  ]);
  const stripeReady = Boolean(process.env.STRIPE_SECRET_KEY);
  // A canceled (or never paid) account keeps no interval, even if an old value is left over
  const liveSubscription = asPaidPlan(user.plan) !== undefined && user.billingStatus !== 'canceled';

  return {
    plan,
    subscribedPlan: asPaidPlan(user.plan) ?? 'free',
    billingStatus: (user.billingStatus as BillingStatus) ?? 'active',
    cancelAtPeriodEnd: Boolean(user.cancelAtPeriodEnd),
    interval: liveSubscription && isBillingInterval(user.billingInterval) ? user.billingInterval : null,
    currentPeriodEnd: user.currentPeriodEnd ? new Date(user.currentPeriodEnd).toISOString() : null,
    pastDueUntil: graceEndsAt(user)?.toISOString() ?? null,
    limits: toLimitsDTO(PLAN_LIMITS[plan]),
    usage: { activeProjects, monthlyRequests, periodResetAt: nextPeriodStart(now).toISOString() },
    canManageBilling: stripeReady && Boolean(user.stripeCustomerId),
    checkoutAvailable: { starter: Boolean(checkoutConfig('starter')), pro: Boolean(checkoutConfig('pro')), team: Boolean(checkoutConfig('team')) },
    yearlyCheckoutAvailable: {
      starter: Boolean(checkoutConfig('starter', 'year')),
      pro: Boolean(checkoutConfig('pro', 'year')),
      team: Boolean(checkoutConfig('team', 'year')),
    },
  };
}
