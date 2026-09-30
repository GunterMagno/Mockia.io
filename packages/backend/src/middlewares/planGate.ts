import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthenticatedRequest } from './authenticateToken.js';
import { ProjectModel } from '../models/Project.js';
import { mockCache } from '../modules/mock/mockCache.service.js';
import { PLAN_LIMITS, getUserPlan } from '../modules/billing/plans.js';
import { consumeQuota, nextPeriodStart } from '../modules/billing/usage.js';

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

/** Project slug of a public mock call (/mock/:slug/* or /api/mock/:slug/*), or null for anything else. */
export function extractMockSlug(path: string): string | null {
  const m = /^\/(api\/)?mock\/([^/]+)(\/.*)?$/.exec(path);
  if (!m) return null;
  const [, api, rawSlug, rest = ''] = m;
  if (api && RESERVED_API_MOCK.has(rawSlug)) return null;
  if (!api && rest === '/docs') return null; // Swagger page, not a mock call
  try {
    return decodeURIComponent(rawSlug);
  } catch {
    return null;
  }
}

/**
 * Global middleware: counts public mock calls per project owner and answers 429 QUOTA_EXCEEDED
 * once the owner's effective plan quota is spent. It ignores every non-mock path, so it can be
 * mounted once with app.use(). Every plan has a finite monthly quota (see PLAN_LIMITS).
 *
 * - Calls with a wrong API key are not counted (the mock router answers 401), so strangers
 *   cannot burn an owner's quota by guessing.
 * - Fails open on lookup errors: a billing hiccup must not take mocks down.
 */
export const mockQuotaGate: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.method === 'OPTIONS') return next();
    const slug = extractMockSlug(req.path);
    if (!slug) return next();

    const project = await mockCache.getProject(slug);
    if (!project) return next(); // mock router answers 404
    if (project.apiKey && project.apiKey !== req.headers['x-mockia-api-key']) return next();

    const ownerId = project.ownerId.toString();
    const plan = await getUserPlan(ownerId);
    const limit = PLAN_LIMITS[plan].maxMonthlyRequests;
    if (!Number.isFinite(limit)) return next();

    const now = new Date();
    const { allowed, used } = await consumeQuota(ownerId, limit, now);
    res.setHeader('X-Quota-Limit', String(limit));
    res.setHeader('X-Quota-Remaining', String(Math.max(0, limit - used)));
    if (allowed) return next();

    const resetAt = nextPeriodStart(now);
    res.setHeader('Retry-After', String(Math.ceil((resetAt.getTime() - now.getTime()) / 1000)));
    // This runs before the mock routes' own cors(origin '*'), so browsers need the header here to read the 429.
    res.setHeader('Access-Control-Allow-Origin', '*');
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
