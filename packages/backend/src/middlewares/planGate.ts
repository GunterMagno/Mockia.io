import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthenticatedRequest } from './authenticateToken.js';
import { ProjectModel } from '../models/Project.js';
import { mockCache } from '../modules/mock/mockCache.service.js';
import { PLAN_LIMITS, getUserPlan } from '../modules/billing/plans.js';
import { nextPeriodStart, peekQuota, recordRequest } from '../modules/billing/usage.js';
import { MOCK_EXPOSED_HEADERS, mockAccessAllowed } from '../modules/mock/mockAuth.js';

const body = (code: string, message: string, details: Record<string, unknown>) => ({
  success: false,
  error: { code, message, details },
  timestamp: new Date().toISOString(),
});

/**
 * Blocks creating a project when the owner is at the active-project limit of their effective plan.
 * Mount after authenticateToken on POST /api/projects. Responds 402 PLAN_LIMIT_REACHED.
 * Archived projects do not count. Unlimited plans (team) skip the count query.
 *
 * ponytail: count-then-create is not atomic; two concurrent creates at limit-1 can both pass.
 * Acceptable for a soft commercial limit; use a transaction/unique counter if it must be strict.
 */
export const enforceProjectLimit: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) return next(); // authenticateToken owns the 401
    const plan = await getUserPlan(userId);
    const limit = PLAN_LIMITS[plan].maxActiveProjects;
    if (Number.isFinite(limit)) {
      const active = await ProjectModel.countDocuments({ ownerId: userId, isArchived: { $ne: true } });
      if (active >= limit) {
        res.status(402).json(
          body('PLAN_LIMIT_REACHED', `The ${plan} plan allows ${limit} active projects. Archive one or upgrade.`, {
            plan,
            limit,
            active,
          })
        );
        return;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Monthly mock request quota (counter persisted in Mongo, see modules/billing/usage.ts)
// ---------------------------------------------------------------------------

const RESERVED_API_MOCK = new Set(['resolve-route', 'endpoints']); // authenticated management routes under /api/mock

/** Clock of the quota (UTC month boundaries). Tests replace `now` to cross a month without touching the system date. */
export const mockClock = { now: (): Date => new Date() };

/** Project slug of a public mock call (/mock/:slug/* or /api/mock/:slug/*), or null for anything else. */
export function extractMockSlug(path: string): string | null {
  const m = /^\/(api\/)?mock\/([^/]+)(\/.*)?$/.exec(path);
  if (!m) return null;
  const [, api, rawSlug] = m;
  if (api && RESERVED_API_MOCK.has(rawSlug)) return null;
  try {
    return decodeURIComponent(rawSlug);
  } catch {
    return null;
  }
}

/** What the gate hands to the mock handlers: the quota check passed, count the request once it is actually served. */
interface QuotaTicket {
  ownerId: string;
  limit: number;
  now: Date;
  counted: boolean;
}

const epochSeconds = (d: Date) => Math.floor(d.getTime() / 1000);

function setRateLimitHeaders(res: Response, limit: number, remaining: number, resetAt: Date): void {
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, remaining)));
  res.setHeader('X-RateLimit-Reset', String(epochSeconds(resetAt)));
}

/**
 * Global middleware, first half of the monthly mock quota. For public mock calls it answers 429 QUOTA_EXCEEDED once
 * the project owner's effective plan quota is spent; otherwise it leaves a ticket in `res.locals` and the mock
 * handler calls `recordMockRequest(res)` when it really serves the request. It ignores every non-mock path, so it can
 * be mounted once with app.use(). Every plan has a finite monthly quota (see PLAN_LIMITS).
 *
 * Only served requests count. Rejected ones (wrong or missing API key, unknown project or route, 429, CORS preflight)
 * never consume quota, so strangers cannot burn an owner's quota by guessing slugs, routes or keys.
 * Fails open on lookup errors: a billing hiccup must not take mocks down.
 */
export const mockQuotaGate: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.method === 'OPTIONS') return next();
    const slug = extractMockSlug(req.path);
    if (!slug) return next();

    const project = await mockCache.getProject(slug);
    if (!project) return next(); // mock router answers 404
    if (!mockAccessAllowed(project, req.headers)) return next(); // mock router answers 401

    const ownerId = project.ownerId.toString();
    const plan = await getUserPlan(ownerId);
    const limit = PLAN_LIMITS[plan].maxMonthlyRequests;
    if (!Number.isFinite(limit)) return next();

    const now = mockClock.now();
    const { allowed } = await peekQuota(ownerId, limit, now);
    if (allowed) {
      const ticket: QuotaTicket = { ownerId, limit, now, counted: false };
      res.locals.mockQuota = ticket;
      return next();
    }

    const resetAt = nextPeriodStart(now);
    setRateLimitHeaders(res, limit, 0, resetAt);
    res.setHeader('Retry-After', String(Math.ceil((resetAt.getTime() - now.getTime()) / 1000)));
    // This runs before the mock routes' own cors(origin '*'), so browsers need these headers here to read the 429.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', MOCK_EXPOSED_HEADERS.join(', '));
    res.status(429).json(
      body('QUOTA_EXCEEDED', `Monthly mock request quota (${limit}) exceeded for the ${plan} plan`, {
        plan,
        limit,
        resetAt: resetAt.toISOString(),
      })
    );
  } catch (err) {
    console.error('[planGate] quota check failed, allowing request:', err);
    next();
  }
};

/**
 * Second half of the quota: called by the mock handlers once the request is accepted (project found, key valid, route
 * resolved). Counts it against the owner (in memory, written to Mongo in batches) and sets the X-RateLimit-* headers.
 * Safe to call more than once and when the gate left no ticket (unlimited plan, lookup failure).
 */
export function recordMockRequest(res: Response): void {
  const ticket = res.locals?.mockQuota as QuotaTicket | undefined;
  if (!ticket || ticket.counted) return;
  ticket.counted = true;
  const used = recordRequest(ticket.ownerId, ticket.now);
  setRateLimitHeaders(res, ticket.limit, ticket.limit - used, nextPeriodStart(ticket.now));
}
