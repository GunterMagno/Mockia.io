import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';

jest.mock('../models/User.js', () => ({
  UserModel: { findOneAndUpdate: jest.fn(), findById: jest.fn(), exists: jest.fn(), updateOne: jest.fn() },
}));
jest.mock('../services/mailer.js', () => ({
  ...jest.requireActual('../services/mailer.js'),
  sendMail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/notification.service.js', () => ({
  createNotification: jest.fn().mockResolvedValue({}),
}));
jest.mock('../models/Project.js', () => ({ ProjectModel: { countDocuments: jest.fn() } }));
jest.mock('../models/Usage.js', () => ({ UsageModel: { findOne: jest.fn(), findOneAndUpdate: jest.fn() } }));
jest.mock('../middlewares/authenticateToken.js', () => ({
  authenticateToken: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' };
    next();
  },
}));

import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { UsageModel } from '../models/Usage.js';
import { resetUsage } from '../modules/billing/usage.js';
import { errorHandler } from '../middlewares/errorHandler.js';
import { billingRouter } from '../modules/billing/routes.js';
import { getUserPlan } from '../modules/billing/plans.js';
import { sendMail } from '../services/mailer.js';
import { createNotification } from '../services/notification.service.js';
import { NotificationType } from '@mockia/shared';

const findOneAndUpdate = UserModel.findOneAndUpdate as unknown as jest.Mock;
const findById = UserModel.findById as unknown as jest.Mock;
const exists = UserModel.exists as unknown as jest.Mock;
const updateOne = UserModel.updateOne as unknown as jest.Mock;
const sendMailMock = sendMail as unknown as jest.Mock;
const createNotificationMock = createNotification as unknown as jest.Mock;

const SECRET = 'whsec_webhook_test';
const UID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

// Same order as index.ts: billing router BEFORE the global express.json.
const app = express();
app.use('/api/billing', billingRouter);
app.use(express.json());
app.use(errorHandler);

const sign = (body: string, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`;

const post = (event: object, header?: (body: string) => string) => {
  const body = JSON.stringify(event);
  return request(app)
    .post('/api/billing/webhook')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', (header ?? sign)(body))
    .send(body);
};

/** findOneAndUpdate(...).select('_id') resolves to `doc` */
const updateResolves = (doc: unknown) =>
  findOneAndUpdate.mockReturnValue({ select: () => Promise.resolve(doc) });

/** Becoming active (or canceled) closes any payment-failure sequence. */
const NO_DUNNING = { pastDueSince: null, lastPaymentFailedInvoiceId: null };

const env = { ...process.env };
const realFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  updateResolves({ _id: { toString: () => UID } });
  exists.mockResolvedValue({ _id: UID }); // a user exists for the customer unless a test says otherwise
  updateOne.mockResolvedValue({ modifiedCount: 1 });
  sendMailMock.mockResolvedValue(undefined);
  createNotificationMock.mockResolvedValue({});
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...env };
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('POST /api/billing/webhook', () => {
  it('501 when STRIPE_WEBHOOK_SECRET is not configured (never accepts unsigned events)', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await post({ type: 'customer.subscription.deleted', data: { object: {} } });
    expect(res.status).toBe(501);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('400 on invalid signature, 400 on expired timestamp, nothing applied', async () => {
    const event = { id: 'evt', type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1' } } };
    const bad = await post(event, () => 't=1,v1=abcd');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_SIGNATURE');
    const old = await post(event, (b) => sign(b, Math.floor(Date.now() / 1000) - 600));
    expect(old.status).toBe(400);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('400 on valid signature over malformed JSON', async () => {
    const body = '{not json';
    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', sign(body))
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PAYLOAD');
  });

  it('checkout.session.completed upgrades the user to the plan in metadata', async () => {
    const res = await post({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          client_reference_id: UID,
          customer: 'cus_1',
          subscription: 'sub_1',
          metadata: { plan: 'pro' },
        },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, result: 'handled' });
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: UID },
      { $set: { plan: 'pro', billingStatus: 'active', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', ...NO_DUNNING } },
      { new: true }
    );
  });

  it('checkout.session.completed with unknown plan or unpaid status changes nothing', async () => {
    const base = { mode: 'subscription', client_reference_id: UID, customer: 'cus_1' };
    const r1 = await post({ type: 'checkout.session.completed', data: { object: { ...base, metadata: { plan: 'god' } } } });
    const r2 = await post({
      type: 'checkout.session.completed',
      data: { object: { ...base, payment_status: 'unpaid', metadata: { plan: 'pro' } } },
    });
    expect(r1.body.result).toBe('ignored');
    expect(r2.body.result).toBe('ignored');
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['active', 'active', NO_DUNNING],
    ['trialing', 'active', NO_DUNNING],
    ['canceled', 'canceled', NO_DUNNING],
    ['incomplete_expired', 'canceled', NO_DUNNING],
    // unpaid / incomplete / paused / unknown: no access and NO grace period either (they never had a failing-but-paid state)
    ['unpaid', 'past_due', {}],
    ['incomplete', 'past_due', {}],
    ['something_new', 'past_due', {}],
  ])('customer.subscription.updated status %s -> billingStatus %s (found by customer id)', async (status, expected, extra) => {
    const res = await post({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status, metadata: { plan: 'team' } } },
    });
    expect(res.status).toBe(200);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { stripeCustomerId: 'cus_1' },
      { $set: { billingStatus: expected, stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1', plan: 'team', ...extra } },
      { new: true }
    );
  });

  it('customer.subscription.deleted downgrades to free/canceled', async () => {
    const res = await post({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', customer: 'cus_1' } },
    });
    expect(res.body.result).toBe('handled');
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { stripeCustomerId: 'cus_1' },
      { $set: { plan: 'free', billingStatus: 'canceled', cancelAtPeriodEnd: false, currentPeriodEnd: null, ...NO_DUNNING } },
      { new: true }
    );
  });

  it('guards against replays and out-of-order events using event id and created time', async () => {
    const res = await post({
      id: 'evt_9',
      created: 1_700_000_000,
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_1' } },
    });
    expect(res.body.result).toBe('handled');
    const at = new Date(1_700_000_000_000);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      {
        stripeCustomerId: 'cus_1',
        stripeLastEventId: { $ne: 'evt_9' },
        $or: [{ stripeEventAt: { $exists: false } }, { stripeEventAt: { $lte: at } }],
      },
      {
        $set: {
          plan: 'free',
          billingStatus: 'canceled',
          cancelAtPeriodEnd: false,
          currentPeriodEnd: null,
          ...NO_DUNNING,
          stripeEventAt: at,
          stripeLastEventId: 'evt_9',
        },
      },
      { new: true }
    );
    // Stale/duplicate event: DB matches nothing -> acked, no retry storm
    updateResolves(null);
    const stale = await post({ id: 'evt_9', created: 1, type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1' } } });
    expect(stale.status).toBe(200);
    expect(stale.body.result).toBe('ignored');
  });

  it('acks unsupported events with 200 and does not touch users', async () => {
    const res = await post({ type: 'customer.created', data: { object: {} } });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('ignored');
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('acks with 200 when no user matches and the event carries no timestamp (avoids a Stripe retry storm)', async () => {
    updateResolves(null);
    exists.mockResolvedValue(null);
    const res = await post({ type: 'customer.subscription.deleted', data: { object: { customer: 'cus_ghost' } } });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('ignored');
  });

  it('500 when the DB write fails so Stripe retries', async () => {
    findOneAndUpdate.mockReturnValue({ select: () => Promise.reject(new Error('db down')) });
    const res = await post({ type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1' } } });
    expect(res.status).toBe(500);
  });

  it('invalidates the cached plan so the upgrade applies immediately', async () => {
    const lean = jest.fn().mockResolvedValue({ plan: 'free', billingStatus: 'active' });
    findById.mockReturnValue({ select: () => ({ lean }) });
    expect(await getUserPlan(UID)).toBe('free');
    lean.mockResolvedValue({ plan: 'pro', billingStatus: 'active' });
    expect(await getUserPlan(UID)).toBe('free'); // still cached

    await post({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { plan: 'pro', userId: UID } } },
    });
    expect(await getUserPlan(UID)).toBe('pro');
  });
});

describe('subscription details', () => {
  it('takes the plan from the price (portal plan switch) over stale metadata', async () => {
    process.env.STRIPE_PRICE_PRO = 'price_pro';
    process.env.STRIPE_PRICE_TEAM = 'price_team';
    await post({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'active',
          metadata: { plan: 'pro' },
          items: { data: [{ price: { id: 'price_team' }, current_period_end: 1_790_000_000 }] },
          cancel_at_period_end: false,
        },
      },
    });
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { stripeCustomerId: 'cus_1' },
      {
        $set: {
          billingStatus: 'active',
          stripeSubscriptionId: 'sub_1',
          stripeCustomerId: 'cus_1',
          plan: 'team',
          currentPeriodEnd: new Date(1_790_000_000_000),
          cancelAtPeriodEnd: false,
          ...NO_DUNNING,
        },
      },
      { new: true }
    );
  });

  it('customer.subscription.created is applied like an update and records a scheduled cancellation', async () => {
    const res = await post({
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_2',
          customer: 'cus_2',
          status: 'active',
          metadata: { plan: 'pro', userId: UID },
          current_period_end: 1_790_000_000,
          cancel_at: 1_790_000_000,
        },
      },
    });
    expect(res.body.result).toBe('handled');
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: UID },
      {
        $set: expect.objectContaining({
          plan: 'pro',
          billingStatus: 'active',
          currentPeriodEnd: new Date(1_790_000_000_000),
          cancelAtPeriodEnd: true,
        }),
      },
      { new: true }
    );
  });
});

const nowSec = () => Math.floor(Date.now() / 1000);
const DAY_S = 24 * 60 * 60;

/** The user document `findOneAndUpdate(...).select(...)` returns after an applied event. */
const userDoc = (extra: Record<string, unknown> = {}) => ({
  _id: { toString: () => UID },
  email: 'ana@example.com',
  username: 'Ana',
  locale: 'es',
  plan: 'pro',
  ...extra,
});

describe('invoice.payment_failed: past_due with grace period and notices', () => {
  const failedAt = 1_790_000_000;
  const failed = (extra: Record<string, unknown> = {}, eventExtra: Record<string, unknown> = {}) => ({
    id: 'evt_f1',
    created: failedAt,
    type: 'invoice.payment_failed',
    data: { object: { id: 'in_1', customer: 'cus_1', subscription: 'sub_1', billing_reason: 'subscription_cycle', ...extra } },
    ...eventExtra,
  });
  const graceEnd = new Date((failedAt + 7 * DAY_S) * 1000);

  beforeEach(() => updateResolves(userDoc({ pastDueSince: new Date(failedAt * 1000) })));

  it('moves a paying user to past_due, starting the grace period only if it is not already running', async () => {
    const res = await post(failed());
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('handled');
    const [filter, update, options] = findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({
      stripeCustomerId: 'cus_1',
      plan: { $in: ['pro', 'team'] },
      stripeLastEventId: { $ne: 'evt_f1' },
    });
    expect(options).toEqual({ new: true });
    // pipeline update: pastDueSince keeps its previous value when there is one ($ifNull), so a retry or a second invoice cannot extend the grace
    expect(Array.isArray(update)).toBe(true);
    expect(update[0].$set).toMatchObject({
      billingStatus: { $literal: 'past_due' },
      pastDueSince: { $ifNull: ['$pastDueSince', new Date(failedAt * 1000)] },
      stripeLastEventId: { $literal: 'evt_f1' },
    });
  });

  it('emails the user once (in their language, with the grace end and a link to /billing) and creates an in-app notification', async () => {
    process.env.APP_URL = 'https://app.mockia.test';
    await post(failed());

    expect(updateOne).toHaveBeenCalledWith({ _id: expect.anything(), lastPaymentFailedInvoiceId: null }, { $set: { lastPaymentFailedInvoiceId: 'in_1' } });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const [to, template, data] = sendMailMock.mock.calls[0];
    expect(to).toBe('ana@example.com');
    expect(template).toBe('payment_failed');
    expect(data).toMatchObject({ locale: 'es', username: 'Ana', link: 'https://app.mockia.test/billing' });
    expect(data.date).toMatch(/2026/); // grace end formatted for the user
    expect(data.date).toBe(new Intl.DateTimeFormat('es', { dateStyle: 'long', timeZone: 'UTC' }).format(graceEnd));

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: UID, type: NotificationType.BILLING, link: '/billing' })
    );
    expect(createNotificationMock.mock.calls[0][0].message).toContain(data.date);
  });

  it('sends nothing when the failure sequence was already notified (same invoice retried, or a second invoice)', async () => {
    updateOne.mockResolvedValue({ modifiedCount: 0 }); // lastPaymentFailedInvoiceId already set
    const res = await post(failed());
    expect(res.status).toBe(200);
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it('replaying the same event twice sends ONE email (the event guard stops the second delivery)', async () => {
    const first = await post(failed());
    updateResolves(null); // DB: stripeLastEventId == evt_f1 -> nothing matches
    const second = await post(failed());
    expect(first.body.result).toBe('handled');
    expect(second.status).toBe(200);
    expect(second.body.result).toBe('ignored');
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('ignores the failure of the very first invoice of a subscription (no paid access was ever granted)', async () => {
    const res = await post(failed({ billing_reason: 'subscription_create' }));
    expect(res.body.result).toBe('ignored');
    expect(findOneAndUpdate).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('a mail or notification failure never fails the webhook (the state change is already stored)', async () => {
    sendMailMock.mockRejectedValue(new Error('smtp down'));
    createNotificationMock.mockRejectedValue(new Error('db hiccup'));
    const res = await post(failed());
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('handled');
    expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toContain('ana@example.com');
  });

  it('English is the fallback language of the notices', async () => {
    updateResolves(userDoc({ locale: undefined, pastDueSince: new Date(failedAt * 1000) }));
    await post(failed());
    expect(sendMailMock.mock.calls[0][2].locale).toBe('en');
    expect(createNotificationMock.mock.calls[0][0].title).toMatch(/payment/i);
  });

  it('uses the stored pastDueSince (the first failure) to compute the grace end shown to the user', async () => {
    const first = failedAt - 3 * DAY_S;
    updateResolves(userDoc({ locale: 'en', pastDueSince: new Date(first * 1000) }));
    await post(failed());
    expect(sendMailMock.mock.calls[0][2].date).toBe(
      new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date((first + 7 * DAY_S) * 1000))
    );
  });
});

describe('recovery: invoice.paid / invoice.payment_succeeded', () => {
  it.each(['invoice.paid', 'invoice.payment_succeeded'])('%s brings a past_due user back to active and clears the grace markers', async (type) => {
    const res = await post({
      id: 'evt_p1',
      created: 1_790_100_000,
      type,
      data: { object: { id: 'in_1', customer: 'cus_1', billing_reason: 'subscription_cycle' } },
    });
    expect(res.body.result).toBe('handled');
    const [filter, update] = findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({
      stripeCustomerId: 'cus_1',
      billingStatus: 'past_due',
      lastPaymentFailedInvoiceId: { $in: ['in_1', null] }, // not an unrelated invoice while another one still fails
    });
    expect(update).toEqual({
      $set: expect.objectContaining({ billingStatus: 'active', pastDueSince: null, lastPaymentFailedInvoiceId: null }),
    });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('is a no-op (200, ignored) for a user that is not past_due', async () => {
    updateResolves(null); // the billingStatus filter matches nothing
    const res = await post({ id: 'evt_p2', created: 1, type: 'invoice.paid', data: { object: { id: 'in_2', customer: 'cus_1' } } });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('ignored');
  });

  it('customer.subscription.updated(active) also clears the markers; (past_due) starts the grace via the pipeline', async () => {
    await post({
      id: 'evt_s1',
      created: 1_790_100_000,
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { plan: 'pro' } } },
    });
    expect(findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({ billingStatus: 'active', ...NO_DUNNING });

    await post({
      id: 'evt_s2',
      created: 1_790_200_000,
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'past_due', metadata: { plan: 'pro' } } },
    });
    const update = findOneAndUpdate.mock.calls[1][1];
    expect(update[0].$set.billingStatus).toEqual({ $literal: 'past_due' });
    expect(update[0].$set.pastDueSince).toEqual({ $ifNull: ['$pastDueSince', new Date(1_790_200_000_000)] });
    // subscription events do not notify by themselves: invoice.payment_failed does
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe('customer.subscription.trial_will_end and charge.refunded', () => {
  const trialEnd = 1_790_300_000;

  it('trial_will_end: emails the user and leaves an in-app notice with the trial end date, without touching the plan', async () => {
    updateResolves(userDoc({ locale: 'en' }));
    const res = await post({
      id: 'evt_t1',
      created: 1_790_000_000,
      type: 'customer.subscription.trial_will_end',
      data: { object: { id: 'sub_1', customer: 'cus_1', trial_end: trialEnd } },
    });
    expect(res.body.result).toBe('handled');
    const [, update] = findOneAndUpdate.mock.calls[0];
    expect(Object.keys(update.$set).sort()).toEqual(['stripeEventAt', 'stripeLastEventId']); // guard only
    const date = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(trialEnd * 1000));
    expect(sendMailMock).toHaveBeenCalledWith('ana@example.com', 'trial_will_end', expect.objectContaining({ locale: 'en', date }));
    expect(createNotificationMock).toHaveBeenCalledWith(expect.objectContaining({ type: NotificationType.BILLING, link: '/billing' }));
    expect(createNotificationMock.mock.calls[0][0].message).toContain(date);
  });

  it('trial_will_end replayed: one email', async () => {
    updateResolves(userDoc());
    const event = { id: 'evt_t2', created: 1_790_000_000, type: 'customer.subscription.trial_will_end', data: { object: { customer: 'cus_1', trial_end: trialEnd } } };
    await post(event);
    updateResolves(null);
    await post(event);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('charge.refunded: in-app notification with the refunded amount, no email and no plan change', async () => {
    updateResolves(userDoc({ locale: 'en' }));
    const res = await post({
      id: 'evt_r1',
      created: 1_790_000_000,
      type: 'charge.refunded',
      data: { object: { id: 'ch_1', customer: 'cus_1', amount_refunded: 2900, currency: 'usd' } },
    });
    expect(res.body.result).toBe('handled');
    const [, update] = findOneAndUpdate.mock.calls[0];
    expect(Object.keys(update.$set).sort()).toEqual(['stripeEventAt', 'stripeLastEventId']);
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock.mock.calls[0][0]).toMatchObject({ userId: UID, type: NotificationType.BILLING });
    expect(createNotificationMock.mock.calls[0][0].message).toContain('$29.00');
  });

  it('charge.refunded without an amount still produces a generic notice; replay produces none', async () => {
    updateResolves(userDoc());
    const event = { id: 'evt_r2', created: 1_790_000_000, type: 'charge.refunded', data: { object: { customer: 'cus_1' } } };
    await post(event);
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    updateResolves(null);
    await post(event);
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
  });
});

describe('unknown customer: let Stripe retry only while a checkout may still be linking the customer', () => {
  const ghost = (ageSeconds: number) => ({
    id: 'evt_ghost',
    created: nowSec() - ageSeconds,
    type: 'invoice.payment_failed',
    data: { object: { id: 'in_9', customer: 'cus_ghost', billing_reason: 'subscription_cycle' } },
  });

  beforeEach(() => {
    updateResolves(null);
    exists.mockResolvedValue(null);
  });

  it('500 for an event younger than one hour (checkout.session.completed may not have linked the customer yet)', async () => {
    const res = await post(ghost(60));
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('BILLING_USER_NOT_LINKED');
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('200 and a warning without personal data for an older event (orphan Stripe customers of deleted accounts)', async () => {
    const res = await post(ghost(2 * 3600));
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('ignored');
    const logged = JSON.stringify((console.warn as jest.Mock).mock.calls);
    expect(logged).toContain('evt_ghost');
    expect(logged).not.toContain('cus_ghost');
  });

  it('the boundary is one hour', async () => {
    expect((await post(ghost(3600 - 30))).status).toBe(500);
    expect((await post(ghost(3600 + 30))).status).toBe(200);
  });

  it('a stale or duplicate event of an EXISTING user is acknowledged (200), never retried', async () => {
    exists.mockResolvedValue({ _id: UID });
    const res = await post(ghost(10));
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('ignored');
  });

  it('other event types behave the same (subscription.updated, trial_will_end, refunds, invoice.paid)', async () => {
    for (const type of ['customer.subscription.updated', 'customer.subscription.trial_will_end', 'charge.refunded', 'invoice.paid']) {
      const res = await post({ id: `evt_${type}`, created: nowSec() - 10, type, data: { object: { id: 'x', customer: 'cus_ghost', status: 'active', trial_end: nowSec() + 3 * DAY_S } } });
      expect(res.status).toBe(500);
    }
  });

  it('the signature is verified first: a forged young event for an unknown customer is a 400 and looks nothing up', async () => {
    const body = JSON.stringify(ghost(10));
    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 't=1,v1=abcd')
      .send(body);
    expect(res.status).toBe(400);
    expect(exists).not.toHaveBeenCalled();
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('POST /api/billing/checkout', () => {
  const userDoc = { email: 'a@b.co', stripeCustomerId: undefined };
  beforeEach(() => {
    findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(userDoc) }) });
  });

  it('400 for an invalid plan', async () => {
    const res = await request(app).post('/api/billing/checkout').send({ plan: 'free' });
    expect(res.status).toBe(400);
  });

  it('501 BILLING_NOT_CONFIGURED without STRIPE_SECRET_KEY', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await request(app).post('/api/billing/checkout').send({ plan: 'pro' });
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('BILLING_NOT_CONFIGURED');
  });

  it('calls the Stripe REST API with native fetch and returns the session url', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRICE_PRO = 'price_pro';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' }),
    });
    (global as any).fetch = fetchMock;

    const res = await request(app).post('/api/billing/checkout').send({ plan: 'pro' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(init.headers.Authorization).toBe('Bearer sk_test_123');
    const sent = init.body as URLSearchParams;
    expect(sent.get('mode')).toBe('subscription');
    expect(sent.get('line_items[0][price]')).toBe('price_pro');
    expect(sent.get('client_reference_id')).toBe(UID);
    expect(sent.get('subscription_data[metadata][plan]')).toBe('pro');
    expect(sent.get('customer_email')).toBe('a@b.co');
    expect(sent.get('allow_promotion_codes')).toBe('true');
    expect(sent.get('success_url')).toMatch(/\/billing\?checkout=success$/);
    expect(sent.get('cancel_url')).toMatch(/\/billing\?checkout=cancel$/);
  });

  it('409 ALREADY_SUBSCRIBED for a user with an open subscription (no second subscription)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRICE_TEAM = 'price_team';
    const fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    for (const billingStatus of ['active', 'past_due']) {
      findById.mockReturnValue({
        select: () => ({
          lean: () => Promise.resolve({ email: 'a@b.co', plan: 'pro', billingStatus, stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1' }),
        }),
      });
      const res = await request(app).post('/api/billing/checkout').send({ plan: 'team' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_SUBSCRIBED');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a canceled subscriber can check out again with the existing customer', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRICE_PRO = 'price_pro';
    findById.mockReturnValue({
      select: () => ({
        lean: () => Promise.resolve({ email: 'a@b.co', plan: 'free', billingStatus: 'canceled', stripeSubscriptionId: 'sub_old', stripeCustomerId: 'cus_1' }),
      }),
    });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'cs_2', url: 'https://checkout.stripe.com/c/cs_2' }) });
    (global as any).fetch = fetchMock;
    const res = await request(app).post('/api/billing/checkout').send({ plan: 'pro' });
    expect(res.status).toBe(200);
    const sent = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(sent.get('customer')).toBe('cus_1');
    expect(sent.get('customer_email')).toBeNull();
  });

  it('502 without leaking Stripe details when Stripe rejects the request', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRICE_TEAM = 'price_team';
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid API Key provided: sk_test_123' } }),
    });
    const res = await request(app).post('/api/billing/checkout').send({ plan: 'team' });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('sk_test_123');
  });
});

describe('POST /api/billing/portal', () => {
  const withCustomer = (stripeCustomerId?: string) =>
    findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ stripeCustomerId }) }) });

  it('501 without STRIPE_SECRET_KEY', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await request(app).post('/api/billing/portal');
    expect(res.status).toBe(501);
  });

  it('409 NO_BILLING_ACCOUNT for a user that never subscribed', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    withCustomer(undefined);
    const res = await request(app).post('/api/billing/portal');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_BILLING_ACCOUNT');
  });

  it('creates a portal session for the Stripe customer and returns its url', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.FRONTEND_URL = 'https://app.mockia.io/';
    withCustomer('cus_1');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://billing.stripe.com/p/session/x' }),
    });
    (global as any).fetch = fetchMock;
    const res = await request(app).post('/api/billing/portal');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ url: 'https://billing.stripe.com/p/session/x' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/billing_portal/sessions');
    const sent = init.body as URLSearchParams;
    expect(sent.get('customer')).toBe('cus_1');
    expect(sent.get('return_url')).toBe('https://app.mockia.io/billing');
  });

  it('502 without leaking Stripe details', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    withCustomer('cus_1');
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'No configuration provided for sk_test_123' } }),
    });
    const res = await request(app).post('/api/billing/portal');
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('sk_test_123');
  });
});

describe('GET /api/billing/me', () => {
  const countDocuments = ProjectModel.countDocuments as unknown as jest.Mock;
  const usageFindOne = UsageModel.findOne as unknown as jest.Mock;
  const userIs = (user: unknown) => findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(user) }) });

  beforeEach(() => {
    resetUsage();
    countDocuments.mockResolvedValue(3);
    usageFindOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ requests: 1234 }) }) });
  });

  it('returns plan, limits (null = unlimited) and usage of the month', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    userIs({ plan: 'team', billingStatus: 'active', stripeCustomerId: 'cus_1', cancelAtPeriodEnd: true, currentPeriodEnd: new Date('2026-10-30T00:00:00Z') });
    const res = await request(app).get('/api/billing/me');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      plan: 'team',
      subscribedPlan: 'team',
      billingStatus: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-10-30T00:00:00.000Z',
      limits: { maxActiveProjects: null, maxMonthlyRequests: 10_000_000 },
      usage: { activeProjects: 3, monthlyRequests: 1234 },
      canManageBilling: false, // Stripe not configured
      checkoutAvailable: { pro: false, team: false },
    });
    expect(countDocuments).toHaveBeenCalledWith({ ownerId: UID, isArchived: { $ne: true } });
  });

  it('a past_due subscriber is enforced as free but still sees the plan they pay for', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRICE_PRO = 'price_pro';
    userIs({ plan: 'pro', billingStatus: 'past_due', stripeCustomerId: 'cus_1' });
    const res = await request(app).get('/api/billing/me');
    expect(res.body.data).toMatchObject({
      plan: 'free',
      subscribedPlan: 'pro',
      billingStatus: 'past_due',
      limits: { maxActiveProjects: 5, maxMonthlyRequests: 10_000 },
      canManageBilling: true,
      checkoutAvailable: { pro: true, team: false },
    });
  });

  it('a past_due subscriber inside the grace period keeps the paid plan and sees when it ends', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    const pastDueSince = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    userIs({ plan: 'pro', billingStatus: 'past_due', pastDueSince, stripeCustomerId: 'cus_1' });
    const res = await request(app).get('/api/billing/me');
    expect(res.body.data).toMatchObject({
      plan: 'pro',
      subscribedPlan: 'pro',
      billingStatus: 'past_due',
      pastDueUntil: new Date(pastDueSince.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      limits: { maxActiveProjects: 50, maxMonthlyRequests: 1_000_000 },
    });
  });

  it('after the grace period the plan is free while pastDueUntil stays as information; non past_due users get null', async () => {
    userIs({ plan: 'pro', billingStatus: 'past_due', pastDueSince: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) });
    const expired = await request(app).get('/api/billing/me');
    expect(expired.body.data).toMatchObject({ plan: 'free', subscribedPlan: 'pro', billingStatus: 'past_due' });
    expect(typeof expired.body.data.pastDueUntil).toBe('string');

    userIs({ plan: 'pro', billingStatus: 'active', pastDueSince: new Date() });
    const active = await request(app).get('/api/billing/me');
    expect(active.body.data.pastDueUntil).toBeNull();
  });

  it('404 when the user no longer exists', async () => {
    userIs(null);
    const res = await request(app).get('/api/billing/me');
    expect(res.status).toBe(404);
  });
});
