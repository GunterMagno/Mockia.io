import request from 'supertest';
import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { UsageModel } from '../models/Usage.js';
import { RefreshSessionModel } from '../models/RefreshSession.js';
import { exportUserData } from '../modules/users/gdpr.js';
import { setAiTrainingConsent } from '../modules/ai/consent.js';
import { flushUsage, periodOf, recordRequest, resetUsage } from '../modules/billing/usage.js';

/**
 * Account deletion vs. billing (every live Stripe subscription of the customer is cancelled, retries do not loop),
 * the in-memory usage counters of a deleted owner, and what the GDPR export carries about billing, consent and sessions.
 */
const PASSWORD = 'gdpr-billing-password-1';
const STRIPE_KEY = 'sk_test_gdpr_billing';
const realFetch = global.fetch;
const realStripeKey = process.env.STRIPE_SECRET_KEY;

async function createUser(email: string, extra: Record<string, unknown> = {}) {
  return UserModel.create({ email, username: email.split('@')[0], passwordHash: await bcrypt.hash(PASSWORD, 4), ...extra });
}
async function login(email: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.data.tokens.accessToken as string}` };
}
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as any;

/** A fake Stripe REST API: subscriptions of one customer, list with pagination, DELETE and GET of one subscription. */
function fakeStripe(subs: Array<{ id: string; status: string }>, opts: { failDeleteOf?: string[]; pageSize?: number } = {}) {
  const calls: Array<{ method: string; url: string }> = [];
  const pageSize = opts.pageSize ?? 100;
  global.fetch = jest.fn(async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ method, url: url.pathname + url.search });
    if (method === 'GET' && url.pathname === '/v1/subscriptions') {
      expect(url.searchParams.get('customer')).toBe('cus_del');
      expect(url.searchParams.get('status')).toBe('all');
      const after = url.searchParams.get('starting_after');
      const start = after ? subs.findIndex((s) => s.id === after) + 1 : 0;
      const page = subs.slice(start, start + pageSize);
      return json(200, { object: 'list', data: page, has_more: start + pageSize < subs.length });
    }
    const match = /^\/v1\/subscriptions\/([^/]+)$/.exec(url.pathname);
    if (match) {
      const sub = subs.find((s) => s.id === decodeURIComponent(match[1]));
      if (!sub) return json(404, { error: { code: 'resource_missing' } });
      if (method === 'DELETE') {
        if (opts.failDeleteOf?.includes(sub.id)) return json(400, { error: { message: 'already being cancelled' } });
        sub.status = 'canceled';
        return json(200, sub);
      }
      return json(200, sub);
    }
    return json(500, {});
  }) as any;
  return calls;
}

describe('account deletion and billing; GDPR export of billing and consent', () => {
  let errorSpy: jest.SpyInstance;
  beforeAll(async () => {
    await connectDB();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterAll(async () => {
    errorSpy.mockRestore();
    resetUsage();
    await UserModel.deleteMany({});
    await UsageModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
    await disconnectDB();
  });
  beforeEach(async () => {
    resetUsage();
    await UserModel.deleteMany({});
    await UsageModel.deleteMany({});
    await RefreshSessionModel.deleteMany({});
    process.env.STRIPE_SECRET_KEY = STRIPE_KEY;
  });
  afterEach(() => {
    global.fetch = realFetch;
    if (realStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = realStripeKey;
  });

  describe('B6: every live subscription of the Stripe customer is cancelled', () => {
    it('also cancels subscriptions we never stored (listed by customer, across pages); ignores dead ones', async () => {
      await createUser('del@example.com', { plan: 'pro', billingStatus: 'active', stripeCustomerId: 'cus_del', stripeSubscriptionId: 'sub_stored' });
      const auth = await login('del@example.com');
      const subs = [
        { id: 'sub_stored', status: 'active' },
        { id: 'sub_extra_trial', status: 'trialing' },
        { id: 'sub_old', status: 'canceled' },
        { id: 'sub_extra_pastdue', status: 'past_due' },
        { id: 'sub_expired', status: 'incomplete_expired' },
        { id: 'sub_extra_unpaid', status: 'unpaid' },
        { id: 'sub_extra_incomplete', status: 'incomplete' },
      ];
      const calls = fakeStripe(subs, { pageSize: 2 });

      const res = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });

      expect(res.status).toBe(204);
      const deleted = calls.filter((c) => c.method === 'DELETE').map((c) => c.url.split('/').pop()).sort();
      expect(deleted).toEqual(['sub_extra_incomplete', 'sub_extra_pastdue', 'sub_extra_trial', 'sub_extra_unpaid', 'sub_stored']);
      expect(calls.filter((c) => c.method === 'GET' && c.url.startsWith('/v1/subscriptions?')).length).toBeGreaterThan(1);
      expect(await UserModel.exists({ email: 'del@example.com' })).toBeNull();
    });

    it('a user whose stored subscription is canceled but who has a customer id still gets the customer checked', async () => {
      await createUser('del@example.com', { plan: 'free', billingStatus: 'canceled', stripeCustomerId: 'cus_del', stripeSubscriptionId: 'sub_old' });
      const auth = await login('del@example.com');
      const calls = fakeStripe([{ id: 'sub_old', status: 'canceled' }, { id: 'sub_forgotten', status: 'active' }]);
      const res = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });
      expect(res.status).toBe(204);
      expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/v1/subscriptions/sub_forgotten']);
    });

    it('a non-OK cancel is re-checked with a GET: a subscription that is already canceled counts as success', async () => {
      await createUser('del@example.com', { plan: 'pro', billingStatus: 'active', stripeCustomerId: 'cus_del', stripeSubscriptionId: 'sub_stored' });
      const auth = await login('del@example.com');
      const subs = [{ id: 'sub_stored', status: 'active' }];
      // DELETE answers 400 but Stripe had in fact already cancelled it
      global.fetch = jest.fn(async (input: any, init: any = {}) => {
        const url = new URL(String(input));
        const method = (init.method ?? 'GET').toUpperCase();
        if (url.pathname === '/v1/subscriptions') return json(200, { data: subs, has_more: false });
        if (method === 'DELETE') {
          subs[0].status = 'canceled';
          return json(400, { error: { message: 'x' } });
        }
        return json(200, subs[0]);
      }) as any;
      const res = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });
      expect(res.status).toBe(204);
    });

    it('a cancel that really failed: 502, nothing deleted; subscriptions already cancelled are recorded so a retry does not loop', async () => {
      await createUser('del@example.com', { plan: 'pro', billingStatus: 'active', stripeCustomerId: 'cus_del', stripeSubscriptionId: 'sub_stored' });
      const auth = await login('del@example.com');
      const subs = [
        { id: 'sub_stored', status: 'active' },
        { id: 'sub_stuck', status: 'active' },
      ];
      fakeStripe(subs, { failDeleteOf: ['sub_stuck'] });

      const res = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });
      expect(res.status).toBe(502);
      const user = await UserModel.findOne({ email: 'del@example.com' }).lean();
      expect(user).not.toBeNull();
      // the stored subscription was cancelled: recorded locally (a retry will not try to cancel it again)
      expect(user?.billingStatus).toBe('canceled');

      // Retry once Stripe works again: only the stuck one is cancelled
      const calls = fakeStripe(subs);
      const retry = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });
      expect(retry.status).toBe(204);
      expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/v1/subscriptions/sub_stuck']);
    });

    it('listing the customer subscriptions fails: 502 and nothing is deleted', async () => {
      await createUser('del@example.com', { plan: 'free', billingStatus: 'canceled', stripeCustomerId: 'cus_del' });
      const auth = await login('del@example.com');
      global.fetch = jest.fn().mockResolvedValue(json(500, { error: { message: 'boom' } })) as any;
      const res = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });
      expect(res.status).toBe(502);
      expect(await UserModel.exists({ email: 'del@example.com' })).toBeTruthy();
    });
  });

  describe('B7: the in-memory usage counter of a deleted owner cannot recreate a Usage row', () => {
    it('pending mock requests of the deleted owner are dropped, not flushed after the deletion', async () => {
      const user = await createUser('usage@example.com');
      const auth = await login('usage@example.com');
      recordRequest(user._id.toString());
      recordRequest(user._id.toString());

      const res = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });
      expect(res.status).toBe(204);
      await flushUsage();
      expect(await UsageModel.countDocuments({ ownerId: user._id })).toBe(0);
    });
  });

  describe('B4 / B8: what the export says about billing, consent and sessions', () => {
    it('carries billingInterval and pastDueSince', async () => {
      const since = new Date('2026-09-01T10:00:00Z');
      const user = await createUser('exp@example.com', { plan: 'pro', billingStatus: 'past_due', billingInterval: 'year', pastDueSince: since });
      const data = (await exportUserData(user._id.toString())) as any;
      expect(data.billing).toMatchObject({ interval: 'year', pastDueSince: since.toISOString() });
    });

    it('lists used-but-unexpired sessions too (the refresh history the server still keeps)', async () => {
      const user = await createUser('exp@example.com');
      const base = { userId: user._id, familyId: 'fam1', expiresAt: new Date(Date.now() + 86_400_000), ip: '1.2.3.4', ua: 'jest' };
      await RefreshSessionModel.create({ ...base, jti: 'j-used', usedAt: new Date() });
      await RefreshSessionModel.create({ ...base, jti: 'j-live' });
      await RefreshSessionModel.create({ ...base, jti: 'j-expired', expiresAt: new Date(Date.now() - 1000) });
      const data = (await exportUserData(user._id.toString())) as any;
      expect(data.sessions).toHaveLength(2);
      expect(JSON.stringify(data.sessions)).not.toContain('j-used'); // never the token ids
      expect(data.sessions.map((s: any) => s.status).sort()).toEqual(['live', 'used']);
    });

    it('consent: withdrawal keeps the grant time and adds the withdrawal time; both are exported', async () => {
      const user = await createUser('consent@example.com');
      const id = user._id.toString();
      const granted = await setAiTrainingConsent(id, true);
      expect(granted.grantedAt).toBeInstanceOf(Date);
      await new Promise((r) => setTimeout(r, 15));
      const withdrawn = await setAiTrainingConsent(id, false);
      expect(withdrawn.granted).toBe(false);
      expect(withdrawn.grantedAt?.getTime()).toBe(granted.grantedAt!.getTime());
      expect(withdrawn.withdrawnAt!.getTime()).toBeGreaterThan(granted.grantedAt!.getTime());
      // `at` keeps meaning "when the current choice was made" for older readers
      expect(withdrawn.at.getTime()).toBe(withdrawn.withdrawnAt!.getTime());

      const data = (await exportUserData(id)) as any;
      expect(data.account.aiTrainingConsent).toEqual({
        granted: false,
        at: withdrawn.withdrawnAt!.toISOString(),
        grantedAt: granted.grantedAt!.toISOString(),
        withdrawnAt: withdrawn.withdrawnAt!.toISOString(),
      });
    });

    it('consent: a legacy row ({ granted, at } only) keeps its grant time when withdrawn', async () => {
      const at = new Date('2026-08-01T00:00:00Z');
      const user = await createUser('legacy@example.com');
      await UserModel.collection.updateOne({ _id: new Types.ObjectId(user._id.toString()) }, { $set: { aiTrainingConsent: { granted: true, at } } });
      const withdrawn = await setAiTrainingConsent(user._id.toString(), false);
      expect(withdrawn.grantedAt?.toISOString()).toBe(at.toISOString());
    });

    it('consent: granting again after a withdrawal starts a new consent (new grant time, no withdrawal time)', async () => {
      const user = await createUser('again@example.com');
      const id = user._id.toString();
      await setAiTrainingConsent(id, true);
      await setAiTrainingConsent(id, false);
      await new Promise((r) => setTimeout(r, 15));
      const again = await setAiTrainingConsent(id, true);
      expect(again.granted).toBe(true);
      expect(again.withdrawnAt ?? null).toBeNull();
      const stored = (await UserModel.findById(id).lean())!.aiTrainingConsent!;
      expect(stored.grantedAt?.getTime()).toBe(again.grantedAt!.getTime());
    });
  });
});
