import type { NextFunction, Request, Response } from 'express';

jest.mock('../models/User.js', () => ({ UserModel: { findById: jest.fn() } }));
jest.mock('../models/Project.js', () => ({ ProjectModel: { countDocuments: jest.fn() } }));
jest.mock('../models/Usage.js', () => ({ UsageModel: { findOne: jest.fn(), findOneAndUpdate: jest.fn() } }));
jest.mock('../modules/mock/mockCache.service.js', () => ({ mockCache: { getProject: jest.fn() } }));

import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { UsageModel } from '../models/Usage.js';
import { mockCache } from '../modules/mock/mockCache.service.js';
import { PLAN_LIMITS, effectivePlan, getUserPlan, graceEndsAt, invalidatePlanCache } from '../modules/billing/plans.js';
import { PAST_DUE_GRACE_DAYS } from '@mockia/shared';
import { consumeQuota, flushUsage, getMonthlyUsage, periodOf, resetUsage } from '../modules/billing/usage.js';
import { enforceProjectLimit, extractMockSlug, mockQuotaGate, recordMockRequest } from '../middlewares/planGate.js';
import { hashApiKey } from '../modules/mock/mockAuth.js';

const findById = UserModel.findById as unknown as jest.Mock;
const countDocuments = ProjectModel.countDocuments as unknown as jest.Mock;
const usageFindOne = UsageModel.findOne as unknown as jest.Mock;
const usageInc = UsageModel.findOneAndUpdate as unknown as jest.Mock;
const getProject = mockCache.getProject as unknown as jest.Mock;

/** UserModel.findById(id).select(...).lean() resolves to `user` */
const userIs = (user: Record<string, unknown> | null) =>
  findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(user) }) });

/** Fake `usages` collection: `${ownerId}:${period}` -> requests */
const usageDb = new Map<string, number>();
const dbKey = (f: { ownerId: string; period: string }) => `${f.ownerId}:${f.period}`;
const query = (value: unknown) => ({ select: () => ({ lean: () => Promise.resolve(value) }) });

function makeRes() {
  const res: any = { statusCode: 200, headers: {} as Record<string, string>, body: undefined, locals: {} };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  res.setHeader = (k: string, v: string) => ((res.headers[k] = v), res);
  return res as Response & { statusCode: number; headers: Record<string, string>; body: any };
}

const run = async (mw: any, req: Partial<Request> & Record<string, any>) => {
  const res = makeRes();
  const next = jest.fn() as unknown as NextFunction & jest.Mock;
  await mw(req, res, next);
  return { res, next };
};

beforeEach(() => {
  jest.clearAllMocks();
  invalidatePlanCache();
  resetUsage();
  usageDb.clear();
  usageFindOne.mockImplementation((f) => query(usageDb.has(dbKey(f)) ? { requests: usageDb.get(dbKey(f)) } : null));
  usageInc.mockImplementation((f, update) => {
    usageDb.set(dbKey(f), (usageDb.get(dbKey(f)) ?? 0) + update.$inc.requests);
    return query({ requests: usageDb.get(dbKey(f)) });
  });
});

afterAll(() => resetUsage());

describe('effectivePlan', () => {
  it('uses the paid plan only while billing is active', () => {
    expect(effectivePlan({ plan: 'pro', billingStatus: 'active' })).toBe('pro');
    expect(effectivePlan({ plan: 'team', billingStatus: 'active' })).toBe('team');
    expect(effectivePlan({ plan: 'pro', billingStatus: 'past_due' })).toBe('free');
    expect(effectivePlan({ plan: 'team', billingStatus: 'canceled' })).toBe('free');
  });
  it('treats legacy users without fields, unknown plans and null as free', () => {
    expect(effectivePlan({})).toBe('free');
    expect(effectivePlan({ plan: 'enterprise' })).toBe('free');
    expect(effectivePlan(null)).toBe('free');
  });
  it('matches the tiers of the monetization plan (shared catalog)', () => {
    expect(PLAN_LIMITS.free).toEqual({ maxActiveProjects: 5, maxMonthlyRequests: 10_000, maxMonthlyAiGenerations: 5 });
    expect(PLAN_LIMITS.pro).toEqual({ maxActiveProjects: 50, maxMonthlyRequests: 1_000_000, maxMonthlyAiGenerations: 300 });
    expect(PLAN_LIMITS.team).toEqual({ maxActiveProjects: Infinity, maxMonthlyRequests: 10_000_000, maxMonthlyAiGenerations: 1500 });
    expect(PLAN_LIMITS.starter).toEqual({ maxActiveProjects: 15, maxMonthlyRequests: 100_000, maxMonthlyAiGenerations: 40 });
  });
});

describe('effectivePlan: periodo de gracia del impago', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const since = new Date('2026-10-01T10:00:00Z');
  const user = { plan: 'pro', billingStatus: 'past_due', pastDueSince: since };
  const at = (days: number) => since.getTime() + days * DAY;

  it('the grace period is 7 days (what the Terms promise)', () => {
    expect(PAST_DUE_GRACE_DAYS).toBe(7);
    expect(graceEndsAt(user)?.getTime()).toBe(at(7));
  });

  it('keeps the paid plan on day 0 and on day 6.9, and degrades to free from day 7.1', () => {
    expect(effectivePlan(user, at(0))).toBe('pro');
    expect(effectivePlan(user, at(6.9))).toBe('pro');
    expect(effectivePlan({ ...user, plan: 'team' }, at(6.9))).toBe('team');
    expect(effectivePlan(user, at(7))).toBe('free'); // the instant the grace ends is already free
    expect(effectivePlan(user, at(7.1))).toBe('free');
    expect(effectivePlan(user, at(8))).toBe('free');
  });

  it('past_due without a known start (legacy rows) has no grace: free', () => {
    expect(effectivePlan({ plan: 'pro', billingStatus: 'past_due' }, at(0))).toBe('free');
    expect(effectivePlan({ plan: 'pro', billingStatus: 'past_due', pastDueSince: null }, at(0))).toBe('free');
  });

  it('canceled is free even right after, active ignores pastDueSince', () => {
    expect(effectivePlan({ ...user, billingStatus: 'canceled' }, at(1))).toBe('free');
    expect(effectivePlan({ ...user, billingStatus: 'active' }, at(30))).toBe('pro');
  });

  it('defaults "now" to the current time', () => {
    const recent = { plan: 'pro', billingStatus: 'past_due', pastDueSince: new Date(Date.now() - DAY) };
    expect(effectivePlan(recent)).toBe('pro');
    expect(effectivePlan({ ...recent, pastDueSince: new Date(Date.now() - 8 * DAY) })).toBe('free');
  });

  it('accepts an ISO string for pastDueSince (lean/JSON)', () => {
    expect(effectivePlan({ ...user, pastDueSince: since.toISOString() }, at(6.9))).toBe('pro');
  });
});

describe('getUserPlan cache vs grace period', () => {
  const DAY = 24 * 60 * 60 * 1000;
  afterEach(() => jest.restoreAllMocks());

  it('never keeps a cached "paid" answer beyond the end of the grace period', async () => {
    const now = new Date('2026-10-08T00:00:00Z').getTime();
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(now);
    // 5 s of grace left, well under the 30 s TTL
    userIs({ plan: 'pro', billingStatus: 'past_due', pastDueSince: new Date(now - 7 * DAY + 5_000) });
    expect(await getUserPlan('u-grace')).toBe('pro');

    dateNow.mockReturnValue(now + 4_000);
    expect(await getUserPlan('u-grace')).toBe('pro'); // still cached, still inside the grace
    expect(findById).toHaveBeenCalledTimes(1);

    dateNow.mockReturnValue(now + 6_000); // grace over, cache TTL (30 s) not
    expect(await getUserPlan('u-grace')).toBe('free');
    expect(findById).toHaveBeenCalledTimes(2);
  });

  it('keeps the normal 30 s TTL for active users', async () => {
    const now = new Date('2026-10-08T00:00:00Z').getTime();
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(now);
    userIs({ plan: 'pro', billingStatus: 'active' });
    await getUserPlan('u-active');
    dateNow.mockReturnValue(now + 29_000);
    await getUserPlan('u-active');
    expect(findById).toHaveBeenCalledTimes(1);
    dateNow.mockReturnValue(now + 31_000);
    await getUserPlan('u-active');
    expect(findById).toHaveBeenCalledTimes(2);
  });

  it('asks the DB for pastDueSince', async () => {
    const select = jest.fn(() => ({ lean: () => Promise.resolve({ plan: 'free' }) }));
    findById.mockReturnValue({ select });
    await getUserPlan('u-select');
    expect(select).toHaveBeenCalledWith(expect.stringContaining('pastDueSince'));
  });
});

describe('enforceProjectLimit', () => {
  const req = { user: { id: 'u1' } };

  it('blocks a free user at the limit with 402 PLAN_LIMIT_REACHED', async () => {
    userIs({ plan: 'free', billingStatus: 'active' });
    countDocuments.mockResolvedValue(5);
    const { res, next } = await run(enforceProjectLimit, req);
    expect(res.statusCode).toBe(402);
    expect(res.body.error.code).toBe('PLAN_LIMIT_REACHED');
    expect(res.body.error.details).toMatchObject({ plan: 'free', limit: 5, active: 5 });
    expect(next).not.toHaveBeenCalled();
    expect(countDocuments).toHaveBeenCalledWith({ ownerId: 'u1', isArchived: { $ne: true } });
  });

  it('allows a free user below the limit', async () => {
    userIs({ plan: 'free' });
    countDocuments.mockResolvedValue(4);
    const { res, next } = await run(enforceProjectLimit, req);
    expect(next).toHaveBeenCalledWith();
    expect(res.statusCode).toBe(200);
  });

  it('lets a pro user go past the free limit and stops them at 50', async () => {
    userIs({ plan: 'pro', billingStatus: 'active' });
    countDocuments.mockResolvedValue(12);
    expect((await run(enforceProjectLimit, req)).next).toHaveBeenCalledWith();
    countDocuments.mockResolvedValue(50);
    const { res } = await run(enforceProjectLimit, req);
    expect(res.statusCode).toBe(402);
    expect(res.body.error.details).toMatchObject({ plan: 'pro', limit: 50 });
  });

  it('never counts for an active team user (unlimited projects)', async () => {
    userIs({ plan: 'team', billingStatus: 'active' });
    const { next } = await run(enforceProjectLimit, req);
    expect(next).toHaveBeenCalledWith();
    expect(countDocuments).not.toHaveBeenCalled();
  });

  it('degrades a past_due pro user to free and blocks at the limit', async () => {
    userIs({ plan: 'pro', billingStatus: 'past_due' });
    countDocuments.mockResolvedValue(7);
    const { res } = await run(enforceProjectLimit, req);
    expect(res.statusCode).toBe(402);
  });

  it('forwards DB errors to next(err)', async () => {
    userIs({ plan: 'free' });
    const boom = new Error('db down');
    countDocuments.mockRejectedValue(boom);
    const { next } = await run(enforceProjectLimit, req);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('consumeQuota (persistent monthly meter)', () => {
  const owner = '64b000000000000000000001';

  it('allows up to the limit, then rejects without counting the rejected calls', async () => {
    for (let i = 1; i <= 3; i++) expect(await consumeQuota(owner, 3)).toEqual({ allowed: true, used: i });
    expect(await consumeQuota(owner, 3)).toEqual({ allowed: false, used: 3 });
    expect((await consumeQuota(owner, 3)).used).toBe(3);
    expect((await consumeQuota('64b000000000000000000002', 3)).allowed).toBe(true); // other owner unaffected
  });

  it('flushes increments with $inc and keeps counting after a restart', async () => {
    const now = new Date('2026-09-15T10:00:00Z');
    for (let i = 0; i < 3; i++) await consumeQuota(owner, 5, now);
    await flushUsage();
    expect(usageDb.get(`${owner}:2026-09`)).toBe(3);
    expect(usageInc).toHaveBeenCalledWith(
      { ownerId: owner, period: '2026-09' },
      { $inc: { requests: 3 } },
      expect.objectContaining({ upsert: true })
    );

    resetUsage(); // new process: local state is gone, Mongo keeps the total
    expect(await consumeQuota(owner, 5, now)).toEqual({ allowed: true, used: 4 });
    expect(await consumeQuota(owner, 5, now)).toEqual({ allowed: true, used: 5 });
    expect((await consumeQuota(owner, 5, now)).allowed).toBe(false);
  });

  it('starts from the persisted total written by other instances', async () => {
    usageDb.set(`${owner}:2026-09`, 9);
    expect(await consumeQuota(owner, 10, new Date('2026-09-20T00:00:00Z'))).toEqual({ allowed: true, used: 10 });
    expect((await consumeQuota(owner, 10, new Date('2026-09-20T00:00:01Z'))).allowed).toBe(false);
  });

  it('resets on a new UTC month', async () => {
    const jan = new Date('2026-01-31T23:59:59Z');
    const feb = new Date('2026-02-01T00:00:00Z');
    await consumeQuota(owner, 1, jan);
    expect((await consumeQuota(owner, 1, jan)).allowed).toBe(false);
    expect((await consumeQuota(owner, 1, feb)).allowed).toBe(true);
    expect(periodOf(jan)).toBe('2026-01');
    expect(periodOf(feb)).toBe('2026-02');
  });

  it('fails open if Mongo cannot be read', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    usageFindOne.mockImplementation(() => ({ select: () => ({ lean: () => Promise.reject(new Error('down')) }) }));
    expect((await consumeQuota(owner, 2)).allowed).toBe(true);
  });

  it('re-queues increments when a flush fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const now = new Date('2026-09-15T10:00:00Z');
    await consumeQuota(owner, 10, now);
    usageInc.mockImplementationOnce(() => ({ select: () => ({ lean: () => Promise.reject(new Error('down')) }) }));
    await flushUsage();
    expect(usageDb.size).toBe(0);
    await flushUsage();
    expect(usageDb.get(`${owner}:2026-09`)).toBe(1);
  });

  it('getMonthlyUsage adds what this process has not flushed yet', async () => {
    const now = new Date();
    usageDb.set(`${owner}:${periodOf(now)}`, 40);
    await consumeQuota(owner, 100, now);
    await consumeQuota(owner, 100, now);
    expect(await getMonthlyUsage(owner, now)).toBe(42);
  });
});

describe('extractMockSlug', () => {
  it.each([
    ['/mock/my-proj/users/1', 'my-proj'],
    ['/mock/my-proj', 'my-proj'],
    ['/api/mock/my-proj/users', 'my-proj'],
    ['/mock/caf%C3%A9/x', 'café'],
    // the per-project Swagger page is gone: /docs is an ordinary mock path and counts like any other
    ['/mock/my-proj/docs', 'my-proj'],
  ])('%s -> %s', (path, slug) => expect(extractMockSlug(path)).toBe(slug));

  it.each([
    '/api/mock/resolve-route',
    '/api/mock/endpoints/my-proj',
    '/api/projects',
    '/api/billing/webhook',
    '/mock/%E0%A4%A/x',
  ])('ignores %s', (path) => expect(extractMockSlug(path)).toBeNull());
});

describe('mockQuotaGate', () => {
  const ownerId = '64b0000000000000000000aa';
  const project = { ownerId: { toString: () => ownerId }, visibility: 'key', apiKeyHash: hashApiKey('k1') };
  const call = (over: Record<string, any> = {}) =>
    run(mockQuotaGate, { method: 'GET', path: '/mock/p/users', headers: { 'x-mockia-api-key': 'k1' }, ...over });
  /** The gate lets it through and the mock handler serves it: that is what counts. */
  const serve = async (over: Record<string, any> = {}) => {
    const out = await call(over);
    if (out.next.mock.calls.length > 0 && out.res.statusCode === 200) recordMockRequest(out.res);
    return out;
  };
  const used = () => getMonthlyUsage(ownerId);

  beforeEach(() => {
    getProject.mockResolvedValue(project);
    userIs({ plan: 'free' });
  });

  it('counts served calls and returns 429 QUOTA_EXCEEDED past 10k with Retry-After', async () => {
    usageDb.set(`${ownerId}:${periodOf(new Date())}`, 9_999);
    const last = await serve();
    expect(last.next).toHaveBeenCalledWith();
    expect(last.res.headers['X-RateLimit-Remaining']).toBe('0');

    const over = await call();
    expect(over.res.statusCode).toBe(429);
    expect(over.res.body.error.code).toBe('QUOTA_EXCEEDED');
    expect(over.res.body.error.details).toMatchObject({ plan: 'free', limit: 10_000 });
    expect(Number(over.res.headers['Retry-After'])).toBeGreaterThan(0);
    expect(over.res.headers['X-RateLimit-Limit']).toBe('10000');
    expect(over.res.headers['X-RateLimit-Remaining']).toBe('0');
    expect(Number(over.res.headers['X-RateLimit-Reset'])).toBeGreaterThan(Date.now() / 1000);
    expect(over.res.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(over.next).not.toHaveBeenCalled();
    expect(await used()).toBe(10_000);
  });

  it('the gate alone consumes nothing: a request the handler never serves (404) is not counted', async () => {
    const { next } = await call();
    expect(next).toHaveBeenCalledWith();
    expect(await used()).toBe(0);
  });

  it('recordMockRequest counts once even if called twice, and is a no-op without a ticket', async () => {
    const { res } = await call();
    recordMockRequest(res);
    recordMockRequest(res);
    expect(await used()).toBe(1);
    recordMockRequest(makeRes());
    expect(await used()).toBe(1);
  });

  it('applies the team quota (10M) instead of the free one', async () => {
    userIs({ plan: 'team', billingStatus: 'active' });
    usageDb.set(`${ownerId}:${periodOf(new Date())}`, 50_000);
    const { next, res } = await serve();
    expect(next).toHaveBeenCalledWith();
    expect(res.headers['X-RateLimit-Limit']).toBe('10000000');
    expect(await used()).toBe(50_001);
  });

  it('a wrong or missing API key is not counted (mock router answers 401)', async () => {
    const wrong = await serve({ headers: { 'x-mockia-api-key': 'wrong' } });
    expect(wrong.next).toHaveBeenCalledWith();
    expect(wrong.res.locals.mockQuota).toBeUndefined();
    await serve({ headers: {} });
    expect(await used()).toBe(0);
  });

  it('ignores OPTIONS, non-mock paths and unknown projects', async () => {
    await call({ method: 'OPTIONS' });
    await call({ path: '/api/projects' });
    getProject.mockResolvedValue(null);
    const { next } = await call();
    expect(next).toHaveBeenCalledWith();
    expect(getProject).toHaveBeenCalledTimes(1);
    expect(await used()).toBe(0);
  });

  it('fails open when the lookup throws', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    getProject.mockRejectedValue(new Error('db down'));
    const { next, res } = await call();
    expect(next).toHaveBeenCalledWith();
    expect(res.statusCode).toBe(200);
  });
});
