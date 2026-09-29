import type { NextFunction, Request, Response } from 'express';

jest.mock('../models/User.js', () => ({ UserModel: { findById: jest.fn() } }));
jest.mock('../models/Project.js', () => ({ ProjectModel: { countDocuments: jest.fn() } }));
jest.mock('../modules/mock/mockCache.service.js', () => ({ mockCache: { getProject: jest.fn() } }));

import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { mockCache } from '../modules/mock/mockCache.service.js';
import { PLAN_LIMITS, effectivePlan, invalidatePlanCache } from '../modules/billing/plans.js';
import {
  consumeQuota,
  enforceProjectLimit,
  extractMockSlug,
  getUsage,
  mockQuotaGate,
  resetUsage,
} from '../middlewares/planGate.js';

const findById = UserModel.findById as unknown as jest.Mock;
const countDocuments = ProjectModel.countDocuments as unknown as jest.Mock;
const getProject = mockCache.getProject as unknown as jest.Mock;

/** UserModel.findById(id).select(...).lean() resolves to `user` */
const userIs = (user: Record<string, unknown> | null) =>
  findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(user) }) });

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
});

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
  it('keeps the single config: free = 5 projects / 10k requests, paid unlimited', () => {
    expect(PLAN_LIMITS.free).toEqual({ maxActiveProjects: 5, maxMonthlyRequests: 10_000 });
    expect(PLAN_LIMITS.pro.maxActiveProjects).toBe(Infinity);
    expect(PLAN_LIMITS.team.maxMonthlyRequests).toBe(Infinity);
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

  it('never counts for an active pro user', async () => {
    userIs({ plan: 'pro', billingStatus: 'active' });
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

describe('consumeQuota', () => {
  it('allows up to the limit, then rejects without counting the rejected calls', () => {
    for (let i = 1; i <= 3; i++) expect(consumeQuota('o1', 3)).toEqual({ allowed: true, used: i });
    expect(consumeQuota('o1', 3)).toEqual({ allowed: false, used: 3 });
    expect(consumeQuota('o1', 3).used).toBe(3);
    expect(consumeQuota('o2', 3).allowed).toBe(true); // other owner unaffected
  });

  it('resets on a new UTC month', () => {
    const jan = new Date('2026-01-31T23:59:59Z');
    const feb = new Date('2026-02-01T00:00:00Z');
    consumeQuota('o1', 1, jan);
    expect(consumeQuota('o1', 1, jan).allowed).toBe(false);
    expect(consumeQuota('o1', 1, feb).allowed).toBe(true);
    expect(getUsage('o1', jan)).toBe(0); // entry now belongs to February
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
  const project = { ownerId: { toString: () => 'owner1' }, apiKey: 'k1' };
  const call = (over: Record<string, any> = {}) =>
    run(mockQuotaGate, { method: 'GET', path: '/mock/p/users', headers: { 'x-mockia-api-key': 'k1' }, ...over });

  beforeEach(() => {
    getProject.mockResolvedValue(project);
    userIs({ plan: 'free' });
  });

  it('counts calls and returns 429 QUOTA_EXCEEDED past 10k with Retry-After', async () => {
    consumeQuotaTo('owner1', 9_999);
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
    expect(getUsage('owner1')).toBe(10_000);
  });

  it('does not count or block unlimited plans', async () => {
    userIs({ plan: 'team', billingStatus: 'active' });
    const { next, res } = await call();
    expect(next).toHaveBeenCalledWith();
    expect(res.headers['X-Quota-Limit']).toBeUndefined();
    expect(getUsage('owner1')).toBe(0);
  });

  it('a wrong API key is not counted (mock router answers 401)', async () => {
    const { next } = await call({ headers: { 'x-mockia-api-key': 'wrong' } });
    expect(next).toHaveBeenCalledWith();
    expect(getUsage('owner1')).toBe(0);
  });

  it('ignores OPTIONS, non-mock paths and unknown projects', async () => {
    await call({ method: 'OPTIONS' });
    await call({ path: '/api/projects' });
    getProject.mockResolvedValue(null);
    const { next } = await call();
    expect(next).toHaveBeenCalledWith();
    expect(getProject).toHaveBeenCalledTimes(1);
    expect(getUsage('owner1')).toBe(0);
  });

  it('fails open when the lookup throws', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    getProject.mockRejectedValue(new Error('db down'));
    const { next, res } = await call();
    expect(next).toHaveBeenCalledWith();
    expect(res.statusCode).toBe(200);
  });
});

function consumeQuotaTo(ownerId: string, n: number) {
  for (let i = 0; i < n; i++) consumeQuota(ownerId, 10_000);
}
