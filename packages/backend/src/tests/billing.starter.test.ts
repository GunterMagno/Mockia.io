import express from 'express';
import request from 'supertest';

jest.mock('../models/User.js', () => ({
  UserModel: { findOneAndUpdate: jest.fn(), findById: jest.fn(), exists: jest.fn(), updateOne: jest.fn() },
}));
jest.mock('../models/Project.js', () => ({ ProjectModel: { countDocuments: jest.fn() } }));
jest.mock('../models/Usage.js', () => ({ UsageModel: { findOne: jest.fn(), findOneAndUpdate: jest.fn() } }));
jest.mock('../middlewares/authenticateToken.js', () => ({
  authenticateToken: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' };
    next();
  },
}));

import { PAST_DUE_GRACE_DAYS, PLANS, PLAN_LIMITS, PLAN_PRICE_USD, annualDiscountPercent, toLimitsDTO } from '@mockia/shared';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { UsageModel } from '../models/Usage.js';
import { resetUsage } from '../modules/billing/usage.js';
import { errorHandler } from '../middlewares/errorHandler.js';
import { billingRouter } from '../modules/billing/routes.js';
import { effectivePlan } from '../modules/billing/plans.js';
import { planAndIntervalOfPrice } from '../modules/billing/prices.js';
import { planFromSubscription, subscriptionPrice } from '../modules/billing/service.js';

const findById = UserModel.findById as unknown as jest.Mock;
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
  process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_m';
  process.env.STRIPE_PRICE_STARTER_YEARLY = 'price_starter_y';
  process.env.STRIPE_PRICE_PRO = 'price_pro_m';
  process.env.STRIPE_PRICE_PRO_YEARLY = 'price_pro_y';
  process.env.STRIPE_PRICE_TEAM = 'price_team_m';
  process.env.STRIPE_PRICE_TEAM_YEARLY = 'price_team_y';
  process.env.APP_URL = 'https://app.mockia.test';
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...env };
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

const userIs = (u: unknown) => findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(u) }) });

describe('(a) los seis price ids resuelven a su plan e intervalo', () => {
  it.each([
    ['price_starter_m', 'starter', 'month'],
    ['price_starter_y', 'starter', 'year'],
    ['price_pro_m', 'pro', 'month'],
    ['price_pro_y', 'pro', 'year'],
    ['price_team_m', 'team', 'month'],
    ['price_team_y', 'team', 'year'],
  ])('%s -> %s / %s', (priceId, plan, interval) => {
    expect(planAndIntervalOfPrice(priceId)).toEqual({ plan, interval });
    const sub = { id: 'sub_1', items: { data: [{ price: { id: priceId } }] } };
    expect(subscriptionPrice(sub)).toEqual({ plan, interval });
    expect(planFromSubscription(sub)).toBe(plan);
  });

  it('un id desconocido o vacio no concede plan de pago ni intervalo, ni con metadatos que digan starter', () => {
    for (const id of ['price_otro', '', undefined, null, 5]) expect(planAndIntervalOfPrice(id)).toBeUndefined();
    const sub = { id: 'sub_1', metadata: { plan: 'starter' }, items: { data: [{ price: { id: 'price_otro' } }] } };
    expect(planFromSubscription(sub)).toBeUndefined();
  });

  it('una variable de Starter vacia significa "no configurada" y nunca coincide con un id vacio', () => {
    process.env.STRIPE_PRICE_STARTER_MONTHLY = '';
    process.env.STRIPE_PRICE_STARTER_YEARLY = '   ';
    expect(planAndIntervalOfPrice('')).toBeUndefined();
    expect(planAndIntervalOfPrice('price_starter_m')).toBeUndefined();
  });
});

describe('(b) POST /api/billing/checkout con plan starter', () => {
  const fetchOk = () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' }) });
    (global as any).fetch = fetchMock;
    return fetchMock;
  };
  const sent = (fetchMock: jest.Mock) => fetchMock.mock.calls[0][1].body as URLSearchParams;
  beforeEach(() => userIs({ email: 'a@b.co', plan: 'free' }));

  it.each([
    ['month', 'price_starter_m'],
    ['year', 'price_starter_y'],
  ])('interval %s usa el price %s', async (interval, priceId) => {
    const fetchMock = fetchOk();
    const res = await request(app).post('/api/billing/checkout').send({ plan: 'starter', interval });
    expect(res.status).toBe(200);
    expect(sent(fetchMock).get('line_items[0][price]')).toBe(priceId);
    expect(sent(fetchMock).get('metadata[plan]')).toBe('starter');
    expect(sent(fetchMock).get('metadata[interval]')).toBe(interval);
  });

  it('sin interval usa el mensual', async () => {
    const fetchMock = fetchOk();
    expect((await request(app).post('/api/billing/checkout').send({ plan: 'starter' })).status).toBe(200);
    expect(sent(fetchMock).get('line_items[0][price]')).toBe('price_starter_m');
  });

  it.each([
    ['month', 'STRIPE_PRICE_STARTER_MONTHLY'],
    ['year', 'STRIPE_PRICE_STARTER_YEARLY'],
  ])('si falta el price (%s): 501 BILLING_NOT_CONFIGURED nombrando %s y sin llamar a Stripe', async (interval, variable) => {
    const fetchMock = fetchOk();
    delete process.env[variable];
    const res = await request(app).post('/api/billing/checkout').send({ plan: 'starter', interval });
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('BILLING_NOT_CONFIGURED');
    expect(res.body.error.message).toContain(variable);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('free sigue sin ser un plan contratable', async () => {
    expect((await request(app).post('/api/billing/checkout').send({ plan: 'free' })).status).toBe(400);
  });
});

describe('GET /api/billing/me con Starter', () => {
  beforeEach(() => {
    resetUsage();
    (ProjectModel.countDocuments as unknown as jest.Mock).mockResolvedValue(3);
    (UsageModel.findOne as unknown as jest.Mock).mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ requests: 5 }) }) });
  });

  it('checkoutAvailable y yearlyCheckoutAvailable incluyen starter y dependen de sus variables', async () => {
    userIs({ plan: 'free', billingStatus: 'active' });
    delete process.env.STRIPE_PRICE_STARTER_YEARLY;
    const { data } = (await request(app).get('/api/billing/me')).body;
    expect(data.checkoutAvailable).toEqual({ starter: true, pro: true, team: true });
    expect(data.yearlyCheckoutAvailable).toEqual({ starter: false, pro: true, team: true });
  });

  it('un suscriptor Starter ve su plan, sus limites (con IA) e intervalo', async () => {
    userIs({ plan: 'starter', billingStatus: 'active', billingInterval: 'year', stripeCustomerId: 'cus_1' });
    const { data } = (await request(app).get('/api/billing/me')).body;
    expect(data.plan).toBe('starter');
    expect(data.subscribedPlan).toBe('starter');
    expect(data.interval).toBe('year');
    expect(data.limits).toEqual({ maxActiveProjects: 15, maxMonthlyRequests: 100_000, maxMonthlyAiGenerations: 40 });
  });
});

describe('(c) effectivePlan de un usuario starter', () => {
  const now = Date.UTC(2026, 9, 9);
  const day = 24 * 60 * 60 * 1000;
  it('activo = starter', () => {
    expect(effectivePlan({ plan: 'starter', billingStatus: 'active' }, now)).toBe('starter');
    expect(effectivePlan({ plan: 'starter' }, now)).toBe('starter');
  });
  it('past_due dentro de la gracia = starter; pasada la gracia = free', () => {
    expect(effectivePlan({ plan: 'starter', billingStatus: 'past_due', pastDueSince: new Date(now - 2 * day) }, now)).toBe('starter');
    expect(effectivePlan({ plan: 'starter', billingStatus: 'past_due', pastDueSince: new Date(now - (PAST_DUE_GRACE_DAYS + 1) * day) }, now)).toBe('free');
  });
  it('canceled = free', () => {
    expect(effectivePlan({ plan: 'starter', billingStatus: 'canceled' }, now)).toBe('free');
  });
});

describe('(d)(e) catalogo', () => {
  it('el catalogo tiene cuatro planes ordenados', () => {
    expect(PLANS).toEqual(['free', 'starter', 'pro', 'team']);
  });

  it('Starter: 15 proyectos, 100 000 peticiones, 40 generaciones de IA, 5 USD al mes y 50 al ano', () => {
    expect(PLAN_LIMITS.starter).toEqual({ maxActiveProjects: 15, maxMonthlyRequests: 100_000, maxMonthlyAiGenerations: 40 });
    expect(PLAN_PRICE_USD.starter).toEqual({ monthly: 5, annual: 50 });
  });

  it('las generaciones de IA de la decision D2 por plan', () => {
    expect(PLANS.map((p) => PLAN_LIMITS[p].maxMonthlyAiGenerations)).toEqual([5, 40, 300, 1500]);
  });

  it('PLAN_LIMITS crece estrictamente free -> starter -> pro -> team en proyectos, peticiones e IA', () => {
    const order = ['free', 'starter', 'pro', 'team'] as const;
    for (const key of ['maxActiveProjects', 'maxMonthlyRequests', 'maxMonthlyAiGenerations'] as const) {
      for (let i = 1; i < order.length; i++) {
        expect(PLAN_LIMITS[order[i]][key]).toBeGreaterThan(PLAN_LIMITS[order[i - 1]][key]);
      }
    }
  });

  it('toLimitsDTO serializa la IA y deja null lo ilimitado', () => {
    expect(toLimitsDTO(PLAN_LIMITS.starter)).toEqual({ maxActiveProjects: 15, maxMonthlyRequests: 100_000, maxMonthlyAiGenerations: 40 });
    expect(toLimitsDTO(PLAN_LIMITS.team).maxActiveProjects).toBeNull();
    expect(toLimitsDTO(PLAN_LIMITS.team).maxMonthlyAiGenerations).toBe(1500);
  });

  it('el descuento anual de Starter es 17 %', () => {
    expect(annualDiscountPercent('starter')).toBe(17);
  });
});

describe('(f) datos antiguos', () => {
  it.each([[undefined], [null], ['enterprise'], ['']])('un usuario con plan %p se trata como free', (plan) => {
    expect(effectivePlan({ plan: plan as any, billingStatus: 'active' })).toBe('free');
  });

  it('un usuario sin plan guardado (anterior al enum) se carga en GET /billing/me como free, sin error', async () => {
    resetUsage();
    (ProjectModel.countDocuments as unknown as jest.Mock).mockResolvedValue(0);
    (UsageModel.findOne as unknown as jest.Mock).mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });
    userIs({ billingStatus: 'active' });
    const res = await request(app).get('/api/billing/me');
    expect(res.status).toBe(200);
    expect(res.body.data.plan).toBe('free');
    expect(res.body.data.subscribedPlan).toBe('free');
    expect(res.body.data.limits.maxMonthlyAiGenerations).toBe(5);
  });

  it('el esquema de User acepta starter y un documento con un plan desconocido se hidrata sin lanzar', () => {
    const { UserModel: Real } = jest.requireActual('../models/User.js');
    expect(Real.schema.path('plan').enumValues).toEqual(['free', 'starter', 'pro', 'team']);
    const doc = Real.hydrate({ _id: UID, plan: 'enterprise' });
    expect(effectivePlan(doc)).toBe('free');
    expect(Real.hydrate({ _id: UID, plan: 'starter' }).validateSync()?.errors?.plan).toBeUndefined();
  });
});
