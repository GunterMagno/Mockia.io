import type { NextFunction, Request, Response } from 'express';

jest.mock('../models/User.js', () => ({ UserModel: { findById: jest.fn() } }));
jest.mock('../models/Project.js', () => ({ ProjectModel: { countDocuments: jest.fn() } }));
jest.mock('../models/Usage.js', () => ({ UsageModel: { findOne: jest.fn(), findOneAndUpdate: jest.fn() } }));
jest.mock('../modules/mock/mockCache.service.js', () => ({ mockCache: { getProject: jest.fn() } }));

import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { UsageModel } from '../models/Usage.js';
import { mockCache } from '../modules/mock/mockCache.service.js';
import { PLAN_LIMITS, effectivePlan, invalidatePlanCache } from '../modules/billing/plans.js';
import { consumeQuota, flushUsage, getMonthlyUsage, periodOf, resetUsage } from '../modules/billing/usage.js';
import { enforceProjectLimit, extractMockSlug, mockQuotaGate } from '../middlewares/planGate.js';

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
  const res: any = { statusCode: 200, headers: {} as Record<string, string>, body: undefined };
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
    expect(PLAN_LIMITS.free).toEqual({ maxActiveProjects: 5, maxMonthlyRequests: 10_000 });
    expect(PLAN_LIMITS.pro).toEqual({ maxActiveProjects: 50, maxMonthlyRequests: 1_000_000 });
    expect(PLAN_LIMITS.team).toEqual({ maxActiveProjects: Infinity, maxMonthlyRequests: 10_000_000 });
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
  ])('%s -> %s', (path, slug) => expect(extractMockSlug(path)).toBe(slug));

  it.each([
    '/api/mock/resolve-route',
    '/api/mock/endpoints/my-proj',
    '/mock/my-proj/docs',
    '/api/projects',
    '/api/billing/webhook',
    '/mock/%E0%A4%A/x',
  ])('ignores %s', (path) => expect(extractMockSlug(path)).toBeNull());
});

describe('mockQuotaGate', () => {
  const ownerId = '64b0000000000000000000aa';
  const project = { ownerId: { toString: () => ownerId }, apiKey: 'k1' };
  const call = (over: Record<string, any> = {}) =>
    run(mockQuotaGate, { method: 'GET', path: '/mock/p/users', headers: { 'x-mockia-api-key': 'k1' }, ...over });
  const used = () => getMonthlyUsage(ownerId);

  beforeEach(() => {
    getProject.mockResolvedValue(project);
    userIs({ plan: 'free' });
  });

  it('counts calls and returns 429 QUOTA_EXCEEDED past 10k with Retry-After', async () => {
    usageDb.set(`${ownerId}:${periodOf(new Date())}`, 9_999);
    const last = await call();
    expect(last.next).toHaveBeenCalledWith();
    expect(last.res.headers['X-Quota-Remaining']).toBe('0');

    const over = await call();
    expect(over.res.statusCode).toBe(429);
    expect(over.res.body.error.code).toBe('QUOTA_EXCEEDED');
    expect(over.res.body.error.details).toMatchObject({ plan: 'free', limit: 10_000 });
    expect(Number(over.res.headers['Retry-After'])).toBeGreaterThan(0);
    expect(over.res.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(over.next).not.toHaveBeenCalled();
    expect(await used()).toBe(10_000);
  });

  it('applies the team quota (10M) instead of the free one', async () => {
    userIs({ plan: 'team', billingStatus: 'active' });
    usageDb.set(`${ownerId}:${periodOf(new Date())}`, 50_000);
    const { next, res } = await call();
    expect(next).toHaveBeenCalledWith();
    expect(res.headers['X-Quota-Limit']).toBe('10000000');
    expect(await used()).toBe(50_001);
  });

  it('a wrong API key is not counted (mock router answers 401)', async () => {
    const { next } = await call({ headers: { 'x-mockia-api-key': 'wrong' } });
    expect(next).toHaveBeenCalledWith();
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
