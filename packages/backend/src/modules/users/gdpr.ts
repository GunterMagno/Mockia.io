import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { ErrorCode } from '@mockia/shared';
import { AppError } from '../../middlewares/errorHandler.js';
import { UserModel } from '../../models/User.js';
import { ProjectModel } from '../../models/Project.js';
import { EndpointModel, MockAPIModel, ResponseModel } from '../../models/MockAPI.js';
import { EndpointConfigModel } from '../../models/EndpointConfig.js';
import { GitHubContextModel } from '../../models/GitHubContext.js';
import { NotificationModel } from '../../models/Notification.js';
import { UsageModel } from '../../models/Usage.js';
import { AiRateWindowModel } from '../../models/AiRateWindow.js';
import { RefreshSessionModel } from '../../models/RefreshSession.js';
import { AuthTokenModel } from '../../models/AuthToken.js';
import { deleteProjectsCascade } from '../projects/cascade.js';
import { cancelSubscriptionNow } from '../billing/service.js';
import { invalidatePlanCache } from '../billing/plans.js';
import { listActiveSessions, revokeAllForUser } from '../auth/sessions.js';

/** Version of the shape of the export file; bump it when a field is renamed or removed. */
export const EXPORT_SCHEMA_VERSION = 1;

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

/** The account no longer exists (deleted, e.g. from another tab): the access token is worthless. */
function accountGone(): AppError {
  return new AppError('Invalid or expired token', ErrorCode.UNAUTHORIZED, 401);
}

/**
 * Everything personal Mockia stores about a user, as a JSON-serialisable object (GDPR art. 15 and 20).
 *
 * Never included: the password hash, Stripe internal ids, project API keys (credentials), refresh token ids or
 * family ids, auth-token hashes, and anything that belongs to other users (other members of a shared project appear
 * only as a count).
 */
export async function exportUserData(userId: string): Promise<Record<string, unknown>> {
  const user = await UserModel.findById(userId).lean();
  if (!user) throw accountGone();

  const uid = new Types.ObjectId(userId);
  const projects = await ProjectModel.find({ ownerId: uid }).sort({ createdAt: 1 }).lean();
  const projectIds = projects.map((p) => p._id);

  const [mockApis, githubContexts, notifications, usage, sessions, memberOf] = await Promise.all([
    MockAPIModel.find({ projectId: { $in: projectIds } }).sort({ createdAt: 1 }).lean(),
    GitHubContextModel.find({ projectId: { $in: projectIds } }).lean(),
    NotificationModel.find({ userId: uid }).sort({ createdAt: 1 }).lean(),
    UsageModel.find({ ownerId: uid }).sort({ period: 1 }).lean(),
    listActiveSessions(userId),
    ProjectModel.find({ ownerId: { $ne: uid }, 'members.userId': uid }).select('title slug members').lean(),
  ]);

  const endpoints = await EndpointModel.find({ mockApiId: { $in: mockApis.map((m) => m._id) } })
    .sort({ createdAt: 1 })
    .lean();
  const [responses, configs] = await Promise.all([
    ResponseModel.find({ _id: { $in: endpoints.flatMap((e) => e.responses ?? []) } }).lean(),
    EndpointConfigModel.find({ endpointId: { $in: endpoints.map((e) => e._id) } }).lean(),
  ]);
  const responseById = new Map(responses.map((r) => [r._id.toString(), r]));
  const configByEndpoint = new Map(configs.map((c) => [c.endpointId.toString(), c]));

  const endpointDTO = (e: (typeof endpoints)[number]) => {
    const config = configByEndpoint.get(e._id.toString());
    return {
      id: e._id.toString(),
      path: e.path,
      method: e.method,
      description: e.description,
      requestSchema: e.requestSchema ?? {},
      responses: (e.responses ?? [])
        .map((id) => responseById.get(id.toString()))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => ({
          id: r._id.toString(),
          statusCode: r.statusCode,
          name: r.name ?? null,
          description: r.description,
          schema: r.schema ?? null,
          examples: r.examples ?? null,
          createdAt: iso(r.createdAt),
        })),
      config: config
        ? {
            force_status_code: config.force_status_code ?? null,
            delay_ms: config.delay_ms ?? null,
            jitter_ms: config.jitter_ms ?? null,
            headers: config.headers ?? null,
            override_response: config.override_response ?? null,
          }
        : null,
      createdAt: iso(e.createdAt),
      updatedAt: iso(e.updatedAt),
    };
  };

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    account: {
      id: user._id.toString(),
      email: user.email,
      username: user.username,
      locale: user.locale ?? null,
      plan: user.plan,
      billingStatus: user.billingStatus,
      createdAt: iso(user.createdAt),
      emailVerifiedAt: iso(user.emailVerifiedAt),
    },
    billing: {
      plan: user.plan,
      status: user.billingStatus,
      cancelAtPeriodEnd: Boolean(user.cancelAtPeriodEnd),
      currentPeriodEnd: iso(user.currentPeriodEnd),
    },
    projects: projects.map((p) => ({
      id: p._id.toString(),
      title: p.title,
      description: p.description ?? null,
      slug: p.slug,
      isArchived: p.isArchived,
      archivedAt: iso(p.archivedAt),
      gitHubRepo: p.gitHubRepo
        ? { owner: p.gitHubRepo.owner, repo: p.gitHubRepo.repo, branch: p.gitHubRepo.branch ?? null, url: p.gitHubRepo.url, importedAt: iso(p.gitHubRepo.importedAt) }
        : null,
      memberCount: p.members?.length ?? 0,
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
      mockApis: mockApis
        .filter((m) => m.projectId.toString() === p._id.toString())
        .map((m) => ({
          id: m._id.toString(),
          title: m.title,
          description: m.description,
          apiVersion: m.apiVersion,
          createdAt: iso(m.createdAt),
          updatedAt: iso(m.updatedAt),
          endpoints: endpoints.filter((e) => e.mockApiId.toString() === m._id.toString()).map(endpointDTO),
        })),
      githubContexts: githubContexts
        .filter((g) => g.projectId.toString() === p._id.toString())
        .map((g) => ({
          repoUrl: g.repoUrl,
          repoOwner: g.repoOwner,
          repoName: g.repoName,
          branch: g.branch ?? null,
          summary: g.summary,
          files: g.files,
          stats: g.stats,
          createdAt: iso(g.createdAt),
        })),
    })),
    memberships: memberOf.map((p) => {
      const mine = p.members.find((m) => m.userId.toString() === userId);
      return { projectId: p._id.toString(), title: p.title, role: mine?.role ?? null, addedAt: iso(mine?.addedAt) };
    }),
    notifications: notifications.map((n) => ({
      id: n._id.toString(),
      type: n.type,
      title: n.title,
      message: n.message,
      link: n.link ?? null,
      isRead: n.isRead,
      projectId: n.projectId?.toString() ?? null,
      createdAt: iso(n.createdAt),
    })),
    usage: usage.map((u) => ({ period: u.period, requests: u.requests })),
    sessions: sessions.map((s) => ({ createdAt: iso(s.createdAt), ip: s.ip ?? null, ua: s.ua ?? null })),
  };
}

/**
 * Permanently deletes an account and everything that hangs from it (GDPR art. 17).
 *
 * Order, so that a failure never leaves a half-deleted account behind a live subscription:
 *  1. password check (401, nothing touched)
 *  2. live Stripe subscription: cancelled FIRST; if Stripe fails (502) or is not configured (409) nothing is deleted
 *  3. projects with all their children (`deleteProjectsCascade`, archived ones too); where the user is only a member
 *     of somebody else's project, just the membership is removed
 *  4. notifications, usage counters, refresh sessions, auth tokens
 *  5. the user
 * Steps 3-5 are idempotent: if one fails the user still exists and can simply retry.
 *
 * The Stripe customer (invoices) is NOT deleted: Stripe keeps it for fiscal obligations (see docs/08_despliegue.md).
 *
 * @throws AppError 401 wrong password or account already gone, 409 Stripe not configured, 502 Stripe failed
 */
export async function deleteUserAccount(userId: string, password: string): Promise<void> {
  const user = await UserModel.findById(userId).exec();
  if (!user) throw accountGone();

  if (typeof password !== 'string' || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError('Incorrect password', ErrorCode.UNAUTHORIZED, 401);
  }

  // A subscription still live in Stripe (anything but already cancelled, past_due included) keeps charging the card.
  if (user.stripeSubscriptionId && user.billingStatus !== 'canceled') {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new AppError(
        'Your account has an active subscription and payments are not configured on this server, so we cannot guarantee it would be cancelled. Nothing was deleted; contact support.',
        ErrorCode.CONFLICT,
        409
      );
    }
    await cancelSubscriptionNow(user.stripeSubscriptionId, secretKey);
  }

  const uid = new Types.ObjectId(userId);

  const owned = await ProjectModel.find({ ownerId: uid }).select('_id').lean();
  await deleteProjectsCascade(owned.map((p) => p._id));
  // Only a member of somebody else's project: drop the membership, the project stays
  await ProjectModel.updateMany({ 'members.userId': uid }, { $pull: { members: { userId: uid } } });

  await NotificationModel.deleteMany({ userId: uid });
  await UsageModel.deleteMany({ ownerId: uid });
  // Per-minute AI call counters: not exported (operational, expire within minutes) but erased with the account
  await AiRateWindowModel.deleteMany({ userId: uid });
  await revokeAllForUser(userId);
  await RefreshSessionModel.deleteMany({ userId: uid });
  await AuthTokenModel.deleteMany({ userId: uid });

  await UserModel.deleteOne({ _id: uid });
  invalidatePlanCache(userId);
}
