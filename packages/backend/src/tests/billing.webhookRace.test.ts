import bcrypt from 'bcrypt';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { handleStripeEvent, type StripeEvent } from '../modules/billing/service.js';
import { effectivePlan, invalidatePlanCache } from '../modules/billing/plans.js';

/**
 * Stripe sends checkout.session.completed, customer.subscription.created (status incomplete while the first payment
 * is being confirmed) and customer.subscription.updated (active) within the same second, and delivers them in any
 * order. With the real database: whatever the order, a customer whose first payment succeeded ends active on Pro.
 * (Reproduced bug: created(incomplete) processed last left `pro / past_due / pastDueSince null` = Free for a period.)
 */
describe('Stripe webhook: same-second events in any order', () => {
  const SECOND = 1_790_000_000;
  let userId: string;
  const savedEnv = { ...process.env };
  let warn: jest.SpyInstance;

  const checkoutCompleted = (): StripeEvent => ({
    id: 'evt_checkout',
    type: 'checkout.session.completed',
    created: SECOND,
    data: {
      object: {
        mode: 'subscription',
        payment_status: 'paid',
        client_reference_id: userId,
        customer: 'cus_race',
        subscription: 'sub_race',
        metadata: { plan: 'pro', interval: 'month', userId },
      },
    },
  });
  const subscription = (type: string, id: string, status: string): StripeEvent => ({
    id,
    type,
    created: SECOND,
    data: {
      object: {
        id: 'sub_race',
        customer: 'cus_race',
        status,
        metadata: { plan: 'pro', userId },
        items: { data: [{ price: { id: 'price_pro_race' }, current_period_end: SECOND + 30 * 86400 }] },
        cancel_at_period_end: false,
      },
    },
  });
  const createdIncomplete = () => subscription('customer.subscription.created', 'evt_created', 'incomplete');
  const updatedActive = () => subscription('customer.subscription.updated', 'evt_updated', 'active');

  const state = async () => {
    const user = await UserModel.findById(userId).lean();
    return { plan: user?.plan, billingStatus: user?.billingStatus, pastDueSince: user?.pastDueSince ?? null, effective: effectivePlan(user) };
  };

  beforeAll(async () => {
    await connectDB();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  beforeEach(async () => {
    process.env.STRIPE_PRICE_PRO = 'price_pro_race';
    await UserModel.deleteMany({ email: 'race@example.com' });
    const user = await UserModel.create({ email: 'race@example.com', username: 'raceuser', passwordHash: await bcrypt.hash('x', 4) });
    userId = user._id.toString();
    invalidatePlanCache(userId);
  });

  afterAll(async () => {
    process.env = savedEnv;
    warn.mockRestore();
    await UserModel.deleteMany({ email: 'race@example.com' });
    await disconnectDB();
  });

  it('checkout.completed -> updated(active) -> created(incomplete), same second: active Pro', async () => {
    for (const event of [checkoutCompleted(), updatedActive(), createdIncomplete()]) await handleStripeEvent(event);
    expect(await state()).toEqual({ plan: 'pro', billingStatus: 'active', pastDueSince: null, effective: 'pro' });
  });

  it('reverse order created(incomplete) -> updated(active) -> checkout.completed: active Pro', async () => {
    for (const event of [createdIncomplete(), updatedActive(), checkoutCompleted()]) await handleStripeEvent(event);
    expect(await state()).toEqual({ plan: 'pro', billingStatus: 'active', pastDueSince: null, effective: 'pro' });
  });

  it('updated(active) -> created(incomplete) -> checkout.completed: active Pro', async () => {
    for (const event of [updatedActive(), createdIncomplete(), checkoutCompleted()]) await handleStripeEvent(event);
    expect(await state()).toEqual({ plan: 'pro', billingStatus: 'active', pastDueSince: null, effective: 'pro' });
  });

  it('created(incomplete) alone grants nothing and degrades nothing (it still links the subscription)', async () => {
    await handleStripeEvent(createdIncomplete());
    const user = await UserModel.findById(userId).lean();
    expect(user?.plan).toBe('free');
    expect(user?.billingStatus).toBe('active'); // the default of a free account, untouched
    expect(user?.stripeSubscriptionId).toBe('sub_race');
  });

  it('on equal timestamps a past_due update does not override an active user', async () => {
    for (const event of [checkoutCompleted(), updatedActive()]) await handleStripeEvent(event);
    await handleStripeEvent(subscription('customer.subscription.updated', 'evt_pastdue_same', 'past_due'));
    expect((await state()).billingStatus).toBe('active');
  });

  it('a LATER past_due update still applies (the grace period starts)', async () => {
    for (const event of [checkoutCompleted(), updatedActive()]) await handleStripeEvent(event);
    await handleStripeEvent({ ...subscription('customer.subscription.updated', 'evt_pastdue_later', 'past_due'), created: SECOND + 60 });
    const s = await state();
    expect(s.billingStatus).toBe('past_due');
    expect(s.pastDueSince).toEqual(new Date((SECOND + 60) * 1000));
  });

  it('subscription.deleted in the same second as updated(active) still cancels (canceled is terminal)', async () => {
    for (const event of [checkoutCompleted(), updatedActive()]) await handleStripeEvent(event);
    await handleStripeEvent({ id: 'evt_deleted', type: 'customer.subscription.deleted', created: SECOND, data: { object: { id: 'sub_race', customer: 'cus_race', metadata: { userId } } } });
    expect(await state()).toMatchObject({ plan: 'free', billingStatus: 'canceled' });
  });
});
