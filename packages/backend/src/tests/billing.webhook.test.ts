import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';

jest.mock('../models/User.js', () => ({
  UserModel: { findOneAndUpdate: jest.fn(), findById: jest.fn() },
}));
jest.mock('../middlewares/authenticateToken.js', () => ({
  authenticateToken: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' };
    next();
  },
}));

import { UserModel } from '../models/User.js';
import { errorHandler } from '../middlewares/errorHandler.js';
import { billingRouter } from '../modules/billing/routes.js';
import { getUserPlan } from '../modules/billing/plans.js';

const findOneAndUpdate = UserModel.findOneAndUpdate as unknown as jest.Mock;
const findById = UserModel.findById as unknown as jest.Mock;

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

const env = { ...process.env };
const realFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  updateResolves({ _id: { toString: () => UID } });
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
      { $set: { plan: 'pro', billingStatus: 'active', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' } },
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
    ['active', 'active'],
    ['trialing', 'active'],
    ['past_due', 'past_due'],
    ['unpaid', 'past_due'],
    ['canceled', 'canceled'],
    ['something_new', 'past_due'],
  ])('customer.subscription.updated status %s -> billingStatus %s (found by customer id)', async (status, expected) => {
    const res = await post({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status, metadata: { plan: 'team' } } },
    });
    expect(res.status).toBe(200);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { stripeCustomerId: 'cus_1' },
      { $set: { billingStatus: expected, stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1', plan: 'team' } },
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
      { $set: { plan: 'free', billingStatus: 'canceled' } },
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
      { $set: { plan: 'free', billingStatus: 'canceled', stripeEventAt: at, stripeLastEventId: 'evt_9' } },
      { new: true }
    );
    // Stale/duplicate event: DB matches nothing -> acked, no retry storm
    updateResolves(null);
    const stale = await post({ id: 'evt_9', created: 1, type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1' } } });
    expect(stale.status).toBe(200);
    expect(stale.body.result).toBe('ignored');
  });

  it('acks unsupported events with 200 and does not touch users', async () => {
    const res = await post({ type: 'invoice.paid', data: { object: {} } });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('ignored');
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('acks with 200 when no user matches (avoids a Stripe retry storm)', async () => {
    updateResolves(null);
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
