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
import { errorHandler } from '../middlewares/errorHandler.js';
import { billingRouter } from '../modules/billing/routes.js';
import { createCheckoutSession } from '../modules/billing/service.js';
import { TERMS_ACCEPTANCE_MESSAGES, stripeCheckoutLocale } from '../modules/billing/checkoutText.js';

const findById = UserModel.findById as unknown as jest.Mock;
const UID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

const app = express();
app.use('/api/billing', billingRouter);
app.use(express.json());
app.use(errorHandler);

const env = { ...process.env };
const realFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_PRICE_PRO = 'price_pro';
  process.env.APP_URL = 'https://app.mockia.test/';
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' }) });
  (global as any).fetch = fetchMock;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...env };
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

const base = { userId: UID, email: 'a@b.co', plan: 'pro' as const, secretKey: 'sk_test_123', priceId: 'price_pro' };
const sentBody = (): URLSearchParams => fetchMock.mock.calls[0][1].body as URLSearchParams;

describe('createCheckoutSession: impuestos, factura y consentimiento', () => {
  it('pide IVA automatico, NIF-IVA, direccion de facturacion y aceptacion de los terminos', async () => {
    await createCheckoutSession({ ...base });
    const sent = sentBody();
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(sent.get('automatic_tax[enabled]')).toBe('true');
    expect(sent.get('tax_id_collection[enabled]')).toBe('true');
    expect(sent.get('billing_address_collection')).toBe('required');
    expect(sent.get('consent_collection[terms_of_service]')).toBe('required');
  });

  it('no envia invoice_creation: solo vale en mode=payment y las suscripciones ya generan factura', async () => {
    await createCheckoutSession({ ...base });
    const sent = sentBody();
    expect(sent.get('mode')).toBe('subscription');
    expect([...sent.keys()].filter((k) => k.startsWith('invoice_creation'))).toEqual([]);
  });

  it('con un cliente de Stripe existente envia customer_update[address|name]=auto y no customer_email', async () => {
    await createCheckoutSession({ ...base, stripeCustomerId: 'cus_1' });
    const sent = sentBody();
    expect(sent.get('customer')).toBe('cus_1');
    expect(sent.get('customer_email')).toBeNull();
    expect(sent.get('customer_update[address]')).toBe('auto');
    expect(sent.get('customer_update[name]')).toBe('auto');
  });

  it('sin cliente (customer_email) NO envia customer_update: Stripe lo rechaza', async () => {
    await createCheckoutSession({ ...base });
    const sent = sentBody();
    expect(sent.get('customer_email')).toBe('a@b.co');
    expect(sent.get('customer')).toBeNull();
    expect([...sent.keys()].filter((k) => k.startsWith('customer_update'))).toEqual([]);
  });

  it.each([
    ['en', 'en'],
    ['es', 'es'],
    ['zh', 'zh'],
  ])('locale guardado %s -> locale %s de Stripe', async (saved, expected) => {
    await createCheckoutSession({ ...base, locale: saved });
    expect(sentBody().get('locale')).toBe(expected);
  });

  it.each([[undefined], [null], ['fr'], ['']])('locale desconocido (%p) -> auto', async (saved) => {
    await createCheckoutSession({ ...base, locale: saved as any });
    expect(sentBody().get('locale')).toBe('auto');
  });

  it('stripeCheckoutLocale cubre los tres idiomas y cae a auto', () => {
    expect(stripeCheckoutLocale('es')).toBe('es');
    expect(stripeCheckoutLocale('de')).toBe('auto');
    expect(stripeCheckoutLocale(undefined)).toBe('auto');
  });

  it.each(['en', 'es', 'zh'])('custom_text[terms_of_service_acceptance][message] en %s: presente, <=1200 y con el enlace a /terms', async (locale) => {
    await createCheckoutSession({ ...base, locale });
    const message = sentBody().get('custom_text[terms_of_service_acceptance][message]');
    expect(message).toBeTruthy();
    expect(message!.length).toBeLessThanOrEqual(1200);
    // APP_URL llega sin barra final aunque se configure con ella
    expect(message).toContain('(https://app.mockia.test/terms)');
    expect(message).not.toContain('test//terms');
  });

  it('el mensaje de desistimiento difiere por idioma y reconoce acceso inmediato y perdida de los 14 dias', () => {
    const url = 'https://app.mockia.test/terms';
    const texts = (['en', 'es', 'zh'] as const).map((l) => TERMS_ACCEPTANCE_MESSAGES[l](url));
    expect(new Set(texts).size).toBe(3);
    expect(texts[0]).toMatch(/immediate/i);
    expect(texts[0]).toMatch(/14/);
    expect(texts[1]).toMatch(/inmediato/i);
    expect(texts[1]).toMatch(/14/);
    expect(texts[2]).toMatch(/14/);
    expect(texts[2]).toContain('立即');
    for (const text of texts) expect(text.length).toBeLessThanOrEqual(1200);
  });

  it('el locale sin soporte usa el mensaje en ingles', async () => {
    await createCheckoutSession({ ...base, locale: 'fr' as any });
    expect(sentBody().get('custom_text[terms_of_service_acceptance][message]')).toMatch(/immediate/i);
  });

  it('se conservan los campos de siempre (modo, precio, referencias, metadatos)', async () => {
    await createCheckoutSession({ ...base });
    const sent = sentBody();
    expect(sent.get('mode')).toBe('subscription');
    expect(sent.get('line_items[0][price]')).toBe('price_pro');
    expect(sent.get('client_reference_id')).toBe(UID);
    expect(sent.get('subscription_data[metadata][plan]')).toBe('pro');
    expect(sent.get('allow_promotion_codes')).toBe('true');
  });
});

describe('POST /api/billing/checkout: usa el idioma guardado del usuario', () => {
  it('envia locale y el mensaje en el idioma del usuario y customer_update solo con cliente', async () => {
    findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ email: 'a@b.co', locale: 'es', stripeCustomerId: 'cus_9', plan: 'free' }) }) });
    const res = await request(app).post('/api/billing/checkout').send({ plan: 'pro' });
    expect(res.status).toBe(200);
    const sent = sentBody();
    expect(sent.get('locale')).toBe('es');
    expect(sent.get('custom_text[terms_of_service_acceptance][message]')).toMatch(/inmediato/i);
    expect(sent.get('customer_update[address]')).toBe('auto');
  });

  it('un usuario nuevo sin locale ni cliente: locale auto, customer_email y sin customer_update', async () => {
    findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ email: 'a@b.co', plan: 'free' }) }) });
    const res = await request(app).post('/api/billing/checkout').send({ plan: 'pro' });
    expect(res.status).toBe(200);
    const sent = sentBody();
    expect(sent.get('locale')).toBe('auto');
    expect(sent.get('customer_email')).toBe('a@b.co');
    expect(sent.has('customer_update[address]')).toBe(false);
  });
});
