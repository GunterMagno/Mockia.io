import { createHmac } from 'node:crypto';
import request from 'supertest';
import { NotificationType } from '@mockia/shared';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { NotificationModel } from '../models/Notification.js';
import { clearTestOutbox, getTestOutbox } from '../services/mailer.js';
import { effectivePlan, getUserPlan, invalidatePlanCache } from '../modules/billing/plans.js';
import { getBillingOverview } from '../modules/billing/service.js';

/**
 * The payment-failure lifecycle against a real MongoDB: the $ifNull pipeline that keeps pastDueSince from moving, the atomic
 * "announce once" claim, recovery and the unknown-customer rule. The mocked suite (billing.webhook.test.ts) covers the shapes
 * of the queries; this one proves they do what they claim.
 */
const SECRET = 'whsec_dunning_test';
const DAY = 24 * 60 * 60;
const nowSec = () => Math.floor(Date.now() / 1000);

const sign = (body: string) => {
  const t = nowSec();
  return `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`;
};
const send = (event: object) => {
  const body = JSON.stringify(event);
  return request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', sign(body)).send(body);
};

let seq = 0;
const failedInvoice = (invoice: string, created: number, id = `evt_f_${++seq}`) => ({
  id,
  created,
  type: 'invoice.payment_failed',
  data: { object: { id: invoice, customer: 'cus_dun', subscription: 'sub_dun', billing_reason: 'subscription_cycle' } },
});
const paidInvoice = (invoice: string, created: number, type = 'invoice.paid') => ({
  id: `evt_p_${++seq}`,
  created,
  type,
  data: { object: { id: invoice, customer: 'cus_dun', billing_reason: 'subscription_cycle' } },
});
const subscriptionEvent = (status: string, created: number) => ({
  id: `evt_s_${++seq}`,
  created,
  type: 'customer.subscription.updated',
  data: { object: { id: 'sub_dun', customer: 'cus_dun', status, metadata: { plan: 'pro' } } },
});

const reload = () => UserModel.findOne({ email: 'dun@example.com' }).lean();
const mails = () => getTestOutbox().filter((m) => m.template === 'payment_failed');
const notices = () => NotificationModel.find({ type: NotificationType.BILLING }).lean();

describe('Impagos: periodo de gracia, avisos y recuperacion (MongoDB real)', () => {
  const saved = { ...process.env };
  let userId: string;

  beforeAll(async () => {
    await connectDB();
  });
  afterAll(async () => {
    await UserModel.deleteMany({});
    await NotificationModel.deleteMany({});
    await disconnectDB();
    process.env = saved;
  });
  beforeEach(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.APP_URL = 'https://app.mockia.test';
    await UserModel.deleteMany({});
    await NotificationModel.deleteMany({});
    clearTestOutbox();
    invalidatePlanCache();
    const user = await UserModel.create({
      email: 'dun@example.com',
      username: 'Dun',
      passwordHash: 'x'.repeat(60),
      locale: 'es',
      plan: 'pro',
      billingStatus: 'active',
      stripeCustomerId: 'cus_dun',
      stripeSubscriptionId: 'sub_dun',
    });
    userId = user._id.toString();
  });

  it('first failure: past_due since the event time, one email in the user language and one in-app notice', async () => {
    const t0 = nowSec() - 3 * DAY;
    const res = await send(failedInvoice('in_1', t0));
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('handled');

    const user = await reload();
    expect(user?.billingStatus).toBe('past_due');
    expect(user?.plan).toBe('pro');
    expect(user?.pastDueSince?.getTime()).toBe(t0 * 1000);
    expect(user?.lastPaymentFailedInvoiceId).toBe('in_1');

    expect(mails()).toHaveLength(1);
    expect(mails()[0]).toMatchObject({ to: 'dun@example.com', locale: 'es', link: 'https://app.mockia.test/billing' });
    const graceEnd = new Intl.DateTimeFormat('es', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date((t0 + 7 * DAY) * 1000));
    expect(mails()[0].text).toContain(graceEnd);

    const list = await notices();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ link: '/billing', isRead: false });
    expect(list[0].userId.toString()).toBe(userId);
    expect(list[0].message).toContain(graceEnd);
  });

  it('replaying the same event twice sends ONE email and ONE notice', async () => {
    const event = failedInvoice('in_1', nowSec() - DAY, 'evt_same');
    expect((await send(event)).body.result).toBe('handled');
    const again = await send(event);
    expect(again.status).toBe(200);
    expect(again.body.result).toBe('ignored');
    expect(mails()).toHaveLength(1);
    expect(await notices()).toHaveLength(1);
  });

  it('retries of the same invoice and a second failed invoice neither extend the grace nor repeat the notice', async () => {
    const t0 = nowSec() - 4 * DAY;
    await send(failedInvoice('in_1', t0));
    await send(failedInvoice('in_1', t0 + 1 * DAY)); // Stripe retry: new event, same invoice
    await send(failedInvoice('in_2', t0 + 2 * DAY)); // a second invoice fails while still past_due

    const user = await reload();
    expect(user?.pastDueSince?.getTime()).toBe(t0 * 1000); // not extended
    expect(user?.lastPaymentFailedInvoiceId).toBe('in_1');
    expect(mails()).toHaveLength(1);
    expect(await notices()).toHaveLength(1);
  });

  it('keeps the paid plan until day 7 and is free after it, in the plan gate and in the billing overview', async () => {
    const t0 = nowSec() - 6 * DAY - Math.floor(0.9 * DAY); // day 6.9
    await send(failedInvoice('in_1', t0));
    const user = (await reload())!;

    expect(effectivePlan(user)).toBe('pro');
    expect(await getUserPlan(userId)).toBe('pro');
    const inGrace = await getBillingOverview(userId);
    expect(inGrace).toMatchObject({ plan: 'pro', subscribedPlan: 'pro', billingStatus: 'past_due' });
    expect(inGrace.pastDueUntil).toBe(new Date((t0 + 7 * DAY) * 1000).toISOString());

    // day 7.1: same row, later clock
    const later = t0 * 1000 + 7.1 * DAY * 1000;
    expect(effectivePlan(user, later)).toBe('free');
    const afterGrace = await getBillingOverview(userId, new Date(later));
    expect(afterGrace).toMatchObject({ plan: 'free', subscribedPlan: 'pro', billingStatus: 'past_due' });
  });

  it('a payment that finally goes through (invoice.paid) restores active and ends the sequence; a later failure notifies again', async () => {
    const t0 = nowSec() - 20 * DAY;
    await send(failedInvoice('in_1', t0));
    await send(paidInvoice('in_1', t0 + 3 * DAY));

    let user = await reload();
    expect(user).toMatchObject({ billingStatus: 'active', pastDueSince: null, lastPaymentFailedInvoiceId: null });
    expect(effectivePlan(user!)).toBe('pro');

    // invoice.payment_succeeded for the same payment is a no-op
    const dup = await send(paidInvoice('in_1', t0 + 3 * DAY, 'invoice.payment_succeeded'));
    expect(dup.status).toBe(200);
    expect(dup.body.result).toBe('ignored');

    // a new failure a month later is a new sequence
    const t1 = t0 + 15 * DAY;
    await send(failedInvoice('in_9', t1));
    user = await reload();
    expect(user?.pastDueSince?.getTime()).toBe(t1 * 1000);
    expect(mails()).toHaveLength(2);
    expect(await notices()).toHaveLength(2);
  });

  it('subscription.updated(active) after a successful retry also restores active and clears the markers', async () => {
    const t0 = nowSec() - 5 * DAY;
    await send(failedInvoice('in_1', t0));
    await send(subscriptionEvent('active', t0 + 2 * DAY));
    expect(await reload()).toMatchObject({ billingStatus: 'active', pastDueSince: null, lastPaymentFailedInvoiceId: null });
  });

  it('an unrelated invoice paid while the failed one is still open does not restore the plan', async () => {
    const t0 = nowSec() - 2 * DAY;
    await send(failedInvoice('in_1', t0));
    await send(paidInvoice('in_other', t0 + 3600));
    expect(await reload()).toMatchObject({ billingStatus: 'past_due', lastPaymentFailedInvoiceId: 'in_1' });
  });

  it('subscription.updated(past_due) arriving before invoice.payment_failed still gets the user ONE email, and one grace period', async () => {
    const t0 = nowSec() - 2 * DAY;
    await send(subscriptionEvent('past_due', t0));
    expect(mails()).toHaveLength(0); // subscription events do not notify by themselves
    expect((await reload())?.pastDueSince?.getTime()).toBe(t0 * 1000);

    await send(failedInvoice('in_1', t0 + 5)); // a few seconds later
    expect((await reload())?.pastDueSince?.getTime()).toBe(t0 * 1000); // unchanged
    expect(mails()).toHaveLength(1);
    expect(await notices()).toHaveLength(1);
  });

  it('an unpaid / incomplete subscription gets no grace period (it never had a paid, failing renewal)', async () => {
    await UserModel.updateOne({ _id: userId }, { $set: { plan: 'free', stripeSubscriptionId: undefined } });
    await send(subscriptionEvent('incomplete', nowSec() - 60));
    const user = await reload();
    expect(user?.billingStatus).toBe('past_due');
    expect(user?.pastDueSince ?? null).toBeNull();
    expect(effectivePlan(user!)).toBe('free');
  });

  it('the failure of the first invoice of a subscription does not touch the user', async () => {
    const event = failedInvoice('in_first', nowSec() - 60);
    (event.data.object as any).billing_reason = 'subscription_create';
    const res = await send(event);
    expect(res.body.result).toBe('ignored');
    expect(await reload()).toMatchObject({ billingStatus: 'active' });
    expect(mails()).toHaveLength(0);
  });

  it('a user that is not on a paid plan is not moved to past_due by a stray failed invoice', async () => {
    await UserModel.updateOne({ _id: userId }, { $set: { plan: 'free', billingStatus: 'canceled' } });
    const res = await send(failedInvoice('in_x', nowSec() - 60));
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('ignored');
    expect(await reload()).toMatchObject({ billingStatus: 'canceled', plan: 'free' });
    expect(mails()).toHaveLength(0);
  });

  it('cancellation ends the sequence', async () => {
    const t0 = nowSec() - 9 * DAY;
    await send(failedInvoice('in_1', t0));
    await send({ id: 'evt_del', created: t0 + 8 * DAY, type: 'customer.subscription.deleted', data: { object: { id: 'sub_dun', customer: 'cus_dun' } } });
    expect(await reload()).toMatchObject({ plan: 'free', billingStatus: 'canceled', pastDueSince: null, lastPaymentFailedInvoiceId: null });
  });

  it('trial_will_end emails once and refunds leave only an in-app notice', async () => {
    const trialEnd = nowSec() + 3 * DAY;
    const trial = {
      id: 'evt_trial',
      created: nowSec() - 30,
      type: 'customer.subscription.trial_will_end',
      data: { object: { id: 'sub_dun', customer: 'cus_dun', trial_end: trialEnd } },
    };
    await send(trial);
    await send(trial);
    expect(getTestOutbox().filter((m) => m.template === 'trial_will_end')).toHaveLength(1);
    expect(await notices()).toHaveLength(1);

    const refund = {
      id: 'evt_refund',
      created: nowSec() - 10,
      type: 'charge.refunded',
      data: { object: { id: 'ch_1', customer: 'cus_dun', amount_refunded: 2900, currency: 'usd' } },
    };
    await send(refund);
    await send(refund);
    expect(getTestOutbox()).toHaveLength(1); // no extra email
    const all = await notices();
    expect(all).toHaveLength(2);
    expect(all.map((n) => n.message).join(' ')).toContain('29,00');
    expect(await reload()).toMatchObject({ plan: 'pro', billingStatus: 'active' }); // refund changes no plan
  });

  describe('notice-only events do not consume the replay / out-of-order guard', () => {
    const deleted = (created: number) => ({
      id: `evt_del_${created}`,
      created,
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_dun', customer: 'cus_dun' } },
    });
    const refund = (created: number, id = `evt_ref_${created}`) => ({
      id,
      created,
      type: 'charge.refunded',
      data: { object: { id: 'ch_1', customer: 'cus_dun', amount_refunded: 2900, currency: 'usd' } },
    });
    const trial = (created: number, id = `evt_tr_${created}`) => ({
      id,
      created,
      type: 'customer.subscription.trial_will_end',
      data: { object: { id: 'sub_dun', customer: 'cus_dun', trial_end: created + 3 * DAY } },
    });

    it('charge.refunded (created T) delivered BEFORE customer.subscription.deleted (created T-1): the deletion still applies', async () => {
      const T = nowSec() - 60;
      await send(refund(T));
      const res = await send(deleted(T - 1));
      expect(res.body.result).toBe('handled');
      expect(await reload()).toMatchObject({ plan: 'free', billingStatus: 'canceled' });
    });

    it('trial_will_end (created T) delivered BEFORE customer.subscription.deleted (created T-1): the deletion still applies', async () => {
      const T = nowSec() - 60;
      await send(trial(T));
      const res = await send(deleted(T - 1));
      expect(res.body.result).toBe('handled');
      expect(await reload()).toMatchObject({ plan: 'free', billingStatus: 'canceled' });
    });

    it('a notice-only event leaves stripeEventAt / stripeLastEventId untouched', async () => {
      const T = nowSec() - 3600;
      await send(subscriptionEvent('active', T));
      const before = (await reload())!;
      expect(before.stripeLastEventId).toBeTruthy();

      await send(refund(T + 100));
      await send(trial(T + 200));
      const after = (await reload())!;
      expect(after.stripeEventAt?.getTime()).toBe(before.stripeEventAt?.getTime());
      expect(after.stripeLastEventId).toBe(before.stripeLastEventId);
      expect(await notices()).toHaveLength(2);
    });

    it('a delayed payment_failed still applies after a refund notice that is newer', async () => {
      const T = nowSec() - 120;
      await send(refund(T));
      await send(failedInvoice('in_late', T - 30));
      expect(await reload()).toMatchObject({ billingStatus: 'past_due', pastDueSince: new Date((T - 30) * 1000) });
      expect(mails()).toHaveLength(1);
    });

    it('replaying the same refund event (and interleaving another notice) yields ONE notice each', async () => {
      const T = nowSec() - 60;
      const r = refund(T, 'evt_ref_same');
      await send(r);
      await send(trial(T + 1, 'evt_tr_between'));
      const again = await send(r);
      expect(again.status).toBe(200);
      expect(again.body.result).toBe('ignored');
      expect(await notices()).toHaveLength(2); // one refund + one trial
    });

    it('simultaneous deliveries of the same notice event announce once', async () => {
      const r = refund(nowSec() - 30, 'evt_ref_race');
      await Promise.all([send(r), send(r), send(r)]);
      expect(await notices()).toHaveLength(1);
    });

    it('payment_failed still announces once per sequence (unchanged)', async () => {
      const t0 = nowSec() - 2 * DAY;
      await send(failedInvoice('in_1', t0, 'evt_pf_same'));
      await send(failedInvoice('in_1', t0, 'evt_pf_same'));
      await send(failedInvoice('in_1', t0 + 60));
      expect(mails()).toHaveLength(1);
      expect(await notices()).toHaveLength(1);
    });
  });

  it('unknown customer: 500 for a young event, 200 for an old one', async () => {
    const ghost = (created: number) => ({
      id: `evt_ghost_${created}`,
      created,
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_g', customer: 'cus_nobody', billing_reason: 'subscription_cycle' } },
    });
    const young = await send(ghost(nowSec() - 120));
    expect(young.status).toBe(500);
    const old = await send(ghost(nowSec() - 3 * 3600));
    expect(old.status).toBe(200);
    expect(old.body.result).toBe('ignored');
    expect(mails()).toHaveLength(0);
  });
});
