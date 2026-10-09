import express from 'express';
import request from 'supertest';

jest.mock('../models/User.js', () => ({
  UserModel: { findOneAndUpdate: jest.fn(), findById: jest.fn(), exists: jest.fn(), updateOne: jest.fn() },
}));
jest.mock('../services/mailer.js', () => ({ ...jest.requireActual('../services/mailer.js'), sendMail: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/notification.service.js', () => ({ createNotification: jest.fn().mockResolvedValue({}) }));
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
import { handleStripeEvent, planFromSubscription, subscriptionPrice } from '../modules/billing/service.js';

const findById = UserModel.findById as unknown as jest.Mock;
const findOneAndUpdate = UserModel.findOneAndUpdate as unknown as jest.Mock;
const UID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

const app = express();
app.use('/api/billing', billingRouter);
app.use(express.json());
app.use(errorHandler);

const env = { ...process.env };
const realFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_PRICE_PRO = 'price_pro_m';
  process.env.STRIPE_PRICE_TEAM = 'price_team_m';
  process.env.STRIPE_PRICE_PRO_YEARLY = 'price_pro_y';
  process.env.STRIPE_PRICE_TEAM_YEARLY = 'price_team_y';
  findOneAndUpdate.mockReturnValue({ select: () => Promise.resolve({ _id: { toString: () => UID } }) });
  (UserModel.exists as unknown as jest.Mock).mockResolvedValue({ _id: UID });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...env };
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

const subWithPrice = (id: string | undefined, metadata?: Record<string, string>) => ({
  id: 'sub_1',
  metadata,
  items: { data: id !== undefined ? [{ price: { id } }] : [] },
});

describe('plan e intervalo desde el price id de la suscripcion', () => {
  it.each([
    ['price_pro_m', 'pro', 'month'],
    ['price_pro_y', 'pro', 'year'],
    ['price_team_m', 'team', 'month'],
    ['price_team_y', 'team', 'year'],
  ])('%s -> %s / %s', (priceId, plan, interval) => {
    expect(subscriptionPrice(subWithPrice(priceId))).toEqual({ plan, interval });
    expect(planFromSubscription(subWithPrice(priceId))).toBe(plan);
  });

  it('un price id desconocido no concede plan ni intervalo, aunque los metadatos digan team', () => {
    const sub = subWithPrice('price_desconocido', { plan: 'team' });
    expect(subscriptionPrice(sub)).toBeUndefined();
    expect(planFromSubscription(sub)).toBeUndefined();
  });

  it('un env vacio nunca coincide con un price id vacio', () => {
    process.env.STRIPE_PRICE_PRO_YEARLY = '';
    expect(subscriptionPrice(subWithPrice(''))).toBeUndefined();
    expect(planFromSubscription(subWithPrice(''))).toBeUndefined();
  });

  it('sin price id (suscripcion antigua o evento sin items) se conserva el plan de los metadatos y no hay intervalo', () => {
    expect(planFromSubscription(subWithPrice(undefined, { plan: 'pro' }))).toBe('pro');
    expect(subscriptionPrice(subWithPrice(undefined, { plan: 'pro' }))).toBeUndefined();
  });

  it('con el precio anual configurado solo en un plan, el otro anual sigue sin reconocerse', () => {
    delete process.env.STRIPE_PRICE_TEAM_YEARLY;
    expect(subscriptionPrice(subWithPrice('price_pro_y'))).toEqual({ plan: 'pro', interval: 'year' });
    expect(subscriptionPrice(subWithPrice('price_team_y'))).toBeUndefined();
  });
});

describe('webhook: guarda el intervalo de la suscripcion', () => {
  const updated = (price: string | undefined) =>
    handleStripeEvent({
      id: 'evt_1',
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'active',
          metadata: { userId: UID },
          items: { data: price ? [{ price: { id: price } }] : [] },
        },
      },
    });
  const lastSet = () => findOneAndUpdate.mock.calls[0][1].$set;

  it('subscription.updated con un price anual guarda plan e intervalo year', async () => {
    await updated('price_team_y');
    expect(lastSet()).toMatchObject({ plan: 'team', billingInterval: 'year' });
  });

  it('un cambio anual -> mensual en el portal actualiza el intervalo', async () => {
    await updated('price_pro_m');
    expect(lastSet()).toMatchObject({ plan: 'pro', billingInterval: 'month' });
  });

  it('un price desconocido no toca ni el plan ni el intervalo', async () => {
    await updated('price_otro');
    expect(lastSet()).not.toHaveProperty('plan');
    expect(lastSet()).not.toHaveProperty('billingInterval');
  });

  it('checkout.session.completed guarda el intervalo de los metadatos solo si es valido', async () => {
    const run = (interval: string) =>
      handleStripeEvent({
        id: `evt_${interval}`,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: { object: { mode: 'subscription', client_reference_id: UID, customer: 'cus_1', subscription: 'sub_1', metadata: { plan: 'pro', interval } } },
      });
    await run('year');
    expect(lastSet()).toMatchObject({ plan: 'pro', billingInterval: 'year' });
    findOneAndUpdate.mockClear();
    await run('weekly');
    expect(lastSet()).not.toHaveProperty('billingInterval');
  });
});

describe('POST /api/billing/checkout con intervalo', () => {
  const fetchOk = () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' }) });
    (global as any).fetch = fetchMock;
    return fetchMock;
  };
  const user = (extra: Record<string, unknown> = {}) =>
    findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ email: 'a@b.co', ...extra }) }) });
  const sent = (fetchMock: jest.Mock) => fetchMock.mock.calls[0][1].body as URLSearchParams;

  beforeEach(() => user());

  it('sin interval usa el precio mensual (compatibilidad)', async () => {
    const fetchMock = fetchOk();
    const res = await request(app).post('/api/billing/checkout').send({ plan: 'pro' });
    expect(res.status).toBe(200);
    expect(sent(fetchMock).get('line_items[0][price]')).toBe('price_pro_m');
    expect(sent(fetchMock).get('metadata[interval]')).toBe('month');
  });

  it.each([
    ['pro', 'month', 'price_pro_m'],
    ['pro', 'year', 'price_pro_y'],
    ['team', 'month', 'price_team_m'],
    ['team', 'year', 'price_team_y'],
  ])('%s / %s usa %s', async (plan, interval, priceId) => {
    const fetchMock = fetchOk();
    const res = await request(app).post('/api/billing/checkout').send({ plan, interval });
    expect(res.status).toBe(200);
    expect(sent(fetchMock).get('line_items[0][price]')).toBe(priceId);
    expect(sent(fetchMock).get('metadata[interval]')).toBe(interval);
    expect(sent(fetchMock).get('subscription_data[metadata][interval]')).toBe(interval);
  });

  it.each(['weekly', 'annual', '', 'YEAR', 12, null, ['year']])('interval invalido %p -> 400 y no se llama a Stripe', async (interval) => {
    const fetchMock = fetchOk();
    const res = await request(app).post('/api/billing/checkout').send({ plan: 'pro', interval });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un plan invalido sigue siendo 400', async () => {
    expect((await request(app).post('/api/billing/checkout').send({ plan: 'free', interval: 'year' })).status).toBe(400);
    expect((await request(app).post('/api/billing/checkout').send({ interval: 'year' })).status).toBe(400);
  });

  it('sin el price anual configurado del plan pedido: 501 con un mensaje que nombra la variable, sin llamar a Stripe', async () => {
    const fetchMock = fetchOk();
    delete process.env.STRIPE_PRICE_TEAM_YEARLY;
    const res = await request(app).post('/api/billing/checkout').send({ plan: 'team', interval: 'year' });
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('BILLING_NOT_CONFIGURED');
    expect(res.body.error.message).toContain('STRIPE_PRICE_TEAM_YEARLY');
    expect(fetchMock).not.toHaveBeenCalled();
    // el mensual del mismo plan sigue funcionando
    const ok = await request(app).post('/api/billing/checkout').send({ plan: 'team', interval: 'month' });
    expect(ok.status).toBe(200);
  });

  it('el 501 del precio mensual tambien nombra su variable', async () => {
    delete process.env.STRIPE_PRICE_PRO;
    const res = await request(app).post('/api/billing/checkout').send({ plan: 'pro' });
    expect(res.status).toBe(501);
    expect(res.body.error.message).toContain('STRIPE_PRICE_PRO');
  });
});

describe('GET /api/billing/me: intervalo y disponibilidad anual', () => {
  const userIs = (u: unknown) => findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(u) }) });
  beforeEach(() => {
    resetUsage();
    (ProjectModel.countDocuments as unknown as jest.Mock).mockResolvedValue(1);
    (UsageModel.findOne as unknown as jest.Mock).mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ requests: 5 }) }) });
  });

  it('un suscriptor anual ve interval year', async () => {
    userIs({ plan: 'pro', billingStatus: 'active', billingInterval: 'year', stripeCustomerId: 'cus_1' });
    const res = await request(app).get('/api/billing/me');
    expect(res.body.data.interval).toBe('year');
  });

  it('sin suscripcion o cancelada el intervalo es null, aunque quede un valor antiguo', async () => {
    userIs({ plan: 'free', billingStatus: 'active' });
    expect((await request(app).get('/api/billing/me')).body.data.interval).toBeNull();
    userIs({ plan: 'free', billingStatus: 'canceled', billingInterval: 'year' });
    expect((await request(app).get('/api/billing/me')).body.data.interval).toBeNull();
  });

  it('un suscriptor con plan de pago y sin intervalo registrado (anterior a esta version) ve null', async () => {
    userIs({ plan: 'pro', billingStatus: 'active' });
    expect((await request(app).get('/api/billing/me')).body.data.interval).toBeNull();
  });

  it('yearlyCheckoutAvailable depende de cada variable anual', async () => {
    delete process.env.STRIPE_PRICE_TEAM_YEARLY;
    userIs({ plan: 'free', billingStatus: 'active' });
    const { data } = (await request(app).get('/api/billing/me')).body;
    // Starter no esta configurado en este test: no se ofrece, ni mensual ni anual
    expect(data.checkoutAvailable).toEqual({ starter: false, pro: true, team: true });
    expect(data.yearlyCheckoutAvailable).toEqual({ starter: false, pro: true, team: false });
  });
});
