import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';

jest.mock('../models/User.js', () => ({
  UserModel: { findOneAndUpdate: jest.fn(), findById: jest.fn() },
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
      { $set: { plan: 'free', billingStatus: 'canceled', cancelAtPeriodEnd: false, currentPeriodEnd: null } },
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

  it('404 when the user no longer exists', async () => {
    userIs(null);
    const res = await request(app).get('/api/billing/me');
    expect(res.status).toBe(404);
  });
});
