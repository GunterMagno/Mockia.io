import request from 'supertest';
import bcrypt from 'bcrypt';
import mongoose, { Types } from 'mongoose';
import { NotificationType } from '@mockia/shared';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { ProjectModel, ProjectRoleEnum } from '../models/Project.js';
import { EndpointModel, MockAPIModel, ResponseModel } from '../models/MockAPI.js';
import { EndpointConfigModel } from '../models/EndpointConfig.js';
import { GitHubContextModel } from '../models/GitHubContext.js';
import { NotificationModel } from '../models/Notification.js';
import { UsageModel } from '../models/Usage.js';
import { RefreshSessionModel } from '../models/RefreshSession.js';
import { AuthTokenModel } from '../models/AuthToken.js';

// RGPD: derecho de acceso/portabilidad (GET /users/me/export) y de supresion (DELETE /users/me).
const PASSWORD = 'gdpr-test-password-1';
const STRIPE_KEY = 'sk_test_gdpr';

/** Every model this task knows how to erase. A new model must be added here AND to deleteUserAccount/exportUserData. */
const ALL_MODELS = [
  UserModel,
  ProjectModel,
  MockAPIModel,
  EndpointModel,
  ResponseModel,
  EndpointConfigModel,
  NotificationModel,
  UsageModel,
  RefreshSessionModel,
  AuthTokenModel,
  GitHubContextModel,
] as const;

const realFetch = global.fetch;
const realStripeKey = process.env.STRIPE_SECRET_KEY;

async function createUser(email: string, extra: Record<string, unknown> = {}) {
  return UserModel.create({
    email,
    username: email.split('@')[0],
    passwordHash: await bcrypt.hash(PASSWORD, 12),
    locale: 'es',
    ...extra,
  });
}

async function login(email: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.data.tokens.accessToken as string}` };
}

/** A project of `ownerId` with one child in every collection that hangs from a project. */
async function seedProject(ownerId: Types.ObjectId, slug: string, extra: Record<string, unknown> = {}) {
  const project = await ProjectModel.create({
    title: `Title ${slug}`,
    description: `Desc ${slug}`,
    slug,
    ownerId,
    members: [{ userId: ownerId, role: ProjectRoleEnum.OWNER, addedAt: new Date() }],
    apiKey: `key-${slug}`,
    ...extra,
  });
  const mockApi = await MockAPIModel.create({ projectId: project._id, title: `Api ${slug}` });
  const response = await ResponseModel.create({ statusCode: 200, description: `resp ${slug}` });
  const endpoint = await EndpointModel.create({
    path: `/${slug}`,
    method: 'GET',
    description: `ep ${slug}`,
    responses: [response._id],
    mockApiId: mockApi._id,
  });
  await MockAPIModel.updateOne({ _id: mockApi._id }, { endpoints: [endpoint._id] });
  await EndpointConfigModel.create({ endpointId: endpoint._id, delay_ms: 25 });
  await GitHubContextModel.create({
    projectId: project._id,
    repoUrl: 'https://github.com/o/r',
    repoOwner: 'o',
    repoName: `repo-${slug}`,
    summary: `summary ${slug}`,
    files: [],
    stats: { totalFiles: 0, totalInterfaces: 0, totalFunctions: 0, totalRoutes: 0 },
  });
  await NotificationModel.create({
    userId: ownerId,
    type: Object.values(NotificationType)[0],
    title: `n-${slug}`,
    message: 'm',
    projectId: project._id,
  });
  return project;
}

/** Everything that belongs to a user besides projects: session, token, usage, notification without project. */
async function seedUserData(userId: Types.ObjectId) {
  await UsageModel.create({ ownerId: userId, period: '2026-10', requests: 7 });
  await AuthTokenModel.create({
    tokenHash: `hash-${userId.toString()}`,
    userId,
    purpose: 'reset',
    expiresAt: new Date(Date.now() + 60_000),
  });
  await NotificationModel.create({
    userId,
    type: Object.values(NotificationType)[0],
    title: `loose-${userId.toString()}`,
    message: 'm',
  });
}

const counts = async () => Promise.all(ALL_MODELS.map((model) => (model as any).countDocuments({})));

describe('RGPD - exportar y borrar la cuenta', () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await Promise.all(ALL_MODELS.map((model) => (model as any).deleteMany({})));
    await disconnectDB();
  });

  beforeEach(async () => {
    await Promise.all(ALL_MODELS.map((model) => (model as any).deleteMany({})));
    process.env.STRIPE_SECRET_KEY = STRIPE_KEY;
  });

  afterEach(() => {
    global.fetch = realFetch;
    if (realStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = realStripeKey;
  });

  it('the list of covered models matches every registered mongoose model', () => {
    const covered = ALL_MODELS.map((m) => m.modelName).sort();
    expect(mongoose.modelNames().sort()).toEqual(covered);
  });

  describe('GET /api/users/me/export', () => {
    it('401 without a token', async () => {
      const res = await request(app).get('/api/users/me/export');
      expect(res.status).toBe(401);
    });

    it('downloads a JSON attachment with the account, its projects and children, and never a hash or other users data', async () => {
      const alice = await createUser('alice@example.com', { plan: 'pro', stripeCustomerId: 'cus_internal', stripeSubscriptionId: 'sub_internal' });
      const bob = await createUser('bob@example.com');
      await seedProject(alice._id as Types.ObjectId, 'alice-proj');
      await seedProject(bob._id as Types.ObjectId, 'bob-proj');
      await seedUserData(alice._id as Types.ObjectId);
      await seedUserData(bob._id as Types.ObjectId);
      const auth = await login('alice@example.com');

      const res = await request(app).get('/api/users/me/export').set(auth);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="mockia-export-\d{4}-\d{2}-\d{2}\.json"$/);
      const raw = res.text;
      const data = JSON.parse(raw);

      expect(data.schemaVersion).toBe(1);
      expect(Number.isNaN(Date.parse(data.exportedAt))).toBe(false);
      expect(data.account).toMatchObject({ email: 'alice@example.com', username: 'alice', locale: 'es', plan: 'pro', billingStatus: 'active' });
      expect(data.account.id).toBe(alice._id.toString());
      expect(data.account.createdAt).toBeDefined();
      expect(data.billing).toEqual(expect.objectContaining({ plan: 'pro', status: 'active' }));

      // Secrets and internals are never exported
      const passwordHash = (await UserModel.findById(alice._id))!.passwordHash;
      expect(raw).not.toContain(passwordHash);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('cus_internal');
      expect(raw).not.toContain('sub_internal');
      expect(raw).not.toContain('tokenHash');
      expect(raw).not.toContain('familyId');
      expect(raw).not.toContain('key-alice-proj');

      // Own project with its whole tree
      expect(data.projects).toHaveLength(1);
      const project = data.projects[0];
      expect(project).toMatchObject({ title: 'Title alice-proj', slug: 'alice-proj' });
      expect(project.mockApis).toHaveLength(1);
      const endpoint = project.mockApis[0].endpoints[0];
      expect(endpoint).toMatchObject({ path: '/alice-proj', method: 'GET' });
      expect(endpoint.responses[0]).toMatchObject({ statusCode: 200, description: 'resp alice-proj' });
      expect(endpoint.config).toMatchObject({ delay_ms: 25 });
      expect(project.githubContexts[0]).toMatchObject({ repoName: 'repo-alice-proj' });

      // Notifications (own, incl. the project one), usage, sessions
      expect(data.notifications.map((n: any) => n.title).sort()).toEqual([`loose-${alice._id.toString()}`, 'n-alice-proj'].sort());
      expect(data.usage).toEqual([expect.objectContaining({ period: '2026-10', requests: 7 })]);
      expect(data.sessions.length).toBeGreaterThanOrEqual(1);
      expect(Object.keys(data.sessions[0]).sort()).toEqual(['createdAt', 'ip', 'ua'].sort());

      // Nothing of the other user
      expect(raw).not.toContain('bob@example.com');
      expect(raw).not.toContain('bob-proj');
      expect(raw).not.toContain(bob._id.toString());
    });

    it('does not export a project owned by someone else where the user is only a member (listed as membership only)', async () => {
      const alice = await createUser('alice@example.com');
      const bob = await createUser('bob@example.com');
      await seedProject(bob._id as Types.ObjectId, 'shared-proj', {
        members: [
          { userId: bob._id, role: ProjectRoleEnum.OWNER, addedAt: new Date() },
          { userId: alice._id, role: ProjectRoleEnum.EDITOR, addedAt: new Date() },
        ],
      });
      const auth = await login('alice@example.com');

      const res = await request(app).get('/api/users/me/export').set(auth);

      expect(res.status).toBe(200);
      expect(res.body.projects).toEqual([]);
      expect(res.body.memberships).toEqual([expect.objectContaining({ title: 'Title shared-proj', role: 'editor' })]);
      expect(res.text).not.toContain('bob@example.com');
      expect(res.text).not.toContain('summary shared-proj');
    });

    it('401 when the account no longer exists', async () => {
      const alice = await createUser('alice@example.com');
      const auth = await login('alice@example.com');
      await UserModel.deleteOne({ _id: alice._id });

      const res = await request(app).get('/api/users/me/export').set(auth);
      expect(res.status).toBe(401);
    });

    it('is rate limited: the 6th export within 15 minutes is a 429', async () => {
      await createUser('alice@example.com');
      const auth = await login('alice@example.com');
      for (let i = 0; i < 5; i++) {
        expect((await request(app).get('/api/users/me/export').set(auth)).status).toBe(200);
      }
      const res = await request(app).get('/api/users/me/export').set(auth);
      expect(res.status).toBe(429);
    });
  });

  describe('DELETE /api/users/me', () => {
    it('401 without a token', async () => {
      const res = await request(app).delete('/api/users/me').send({ password: PASSWORD });
      expect(res.status).toBe(401);
    });

    it('400 without a password and nothing is deleted', async () => {
      const alice = await createUser('alice@example.com');
      const auth = await login('alice@example.com');
      const res = await request(app).delete('/api/users/me').set(auth).send({});
      expect(res.status).toBe(400);
      expect(await UserModel.exists({ _id: alice._id })).toBeTruthy();
    });

    it('wrong password: 401, nothing is deleted and Stripe is not called', async () => {
      const alice = await createUser('alice@example.com', { plan: 'pro', stripeSubscriptionId: 'sub_1' });
      await seedProject(alice._id as Types.ObjectId, 'alice-proj');
      await seedUserData(alice._id as Types.ObjectId);
      const auth = await login('alice@example.com');
      const fetchMock = jest.fn();
      global.fetch = fetchMock as any;
      const before = await counts();

      const res = await request(app).delete('/api/users/me').set(auth).send({ password: 'not-the-password-1' });

      expect(res.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await counts()).toEqual(before);
      // and the account still logs in
      await login('alice@example.com');
    });

    it('with an active subscription it cancels in Stripe BEFORE deleting anything', async () => {
      const alice = await createUser('alice@example.com', {
        plan: 'pro',
        billingStatus: 'active',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_123',
      });
      await seedProject(alice._id as Types.ObjectId, 'alice-proj');
      const auth = await login('alice@example.com');

      const seenAtCall: Array<{ userExists: boolean; projects: number; url: string; init: any }> = [];
      global.fetch = jest.fn(async (url: any, init: any) => {
        seenAtCall.push({
          url: String(url),
          init,
          userExists: Boolean(await UserModel.exists({ _id: alice._id })),
          projects: await ProjectModel.countDocuments({ ownerId: alice._id }),
        });
        return { ok: true, status: 200, json: async () => ({ id: 'sub_123', status: 'canceled' }) } as any;
      }) as any;

      const res = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });

      expect(res.status).toBe(204);
      expect(seenAtCall).toHaveLength(1);
      expect(seenAtCall[0].url).toBe('https://api.stripe.com/v1/subscriptions/sub_123');
      expect(seenAtCall[0].init.method).toBe('DELETE');
      expect(seenAtCall[0].init.headers.Authorization).toBe(`Bearer ${STRIPE_KEY}`);
      // at the moment Stripe was called nothing had been deleted yet
      expect(seenAtCall[0].userExists).toBe(true);
      expect(seenAtCall[0].projects).toBe(1);
      // and afterwards everything is gone
      expect(await UserModel.exists({ _id: alice._id })).toBeNull();
      expect(await ProjectModel.countDocuments({})).toBe(0);
    });

    it('Stripe failure: 502 with a clear message and NOTHING is deleted', async () => {
      const alice = await createUser('alice@example.com', { plan: 'pro', stripeSubscriptionId: 'sub_1' });
      await seedProject(alice._id as Types.ObjectId, 'alice-proj');
      await seedUserData(alice._id as Types.ObjectId);
      const auth = await login('alice@example.com');
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) }) as any;
      const before = await counts();

      const res = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });

      expect(res.status).toBe(502);
      expect(JSON.stringify(res.body)).toMatch(/subscription/i);
      expect(JSON.stringify(res.body)).not.toContain('boom');
      expect(await counts()).toEqual(before);
    });

    it('Stripe network error: 502 and nothing is deleted', async () => {
      const alice = await createUser('alice@example.com', { plan: 'pro', stripeSubscriptionId: 'sub_1' });
      await seedProject(alice._id as Types.ObjectId, 'alice-proj');
      const auth = await login('alice@example.com');
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as any;
      const before = await counts();

      const res = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });

      expect(res.status).toBe(502);
      expect(await counts()).toEqual(before);
    });

    it('a subscription Stripe no longer knows (404) counts as already cancelled', async () => {
      const alice = await createUser('alice@example.com', { plan: 'pro', stripeSubscriptionId: 'sub_gone' });
      const auth = await login('alice@example.com');
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: { code: 'resource_missing' } }) }) as any;

      const res = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });

      expect(res.status).toBe(204);
      expect(await UserModel.exists({ _id: alice._id })).toBeNull();
    });

    it('Stripe not configured but the user has a subscription: 409 and nothing is deleted', async () => {
      delete process.env.STRIPE_SECRET_KEY;
      const alice = await createUser('alice@example.com', { plan: 'pro', stripeSubscriptionId: 'sub_1' });
      await seedProject(alice._id as Types.ObjectId, 'alice-proj');
      const auth = await login('alice@example.com');
      const fetchMock = jest.fn();
      global.fetch = fetchMock as any;
      const before = await counts();

      const res = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });

      expect(res.status).toBe(409);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await counts()).toEqual(before);
    });

    it('a user without subscription (or with a cancelled one) never touches Stripe', async () => {
      const free = await createUser('free@example.com');
      const cancelled = await createUser('cancelled@example.com', { plan: 'free', billingStatus: 'canceled', stripeSubscriptionId: 'sub_old' });
      const fetchMock = jest.fn();
      global.fetch = fetchMock as any;

      for (const email of ['free@example.com', 'cancelled@example.com']) {
        const auth = await login(email);
        const res = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });
        expect(res.status).toBe(204);
      }
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await UserModel.exists({ _id: { $in: [free._id, cancelled._id] } })).toBeNull();
    });

    it('leaves no document of the user in ANY collection and the other user is intact', async () => {
      const bob = await createUser('bob@example.com');
      await seedProject(bob._id as Types.ObjectId, 'bob-proj');
      await seedUserData(bob._id as Types.ObjectId);
      await login('bob@example.com'); // bob has a refresh session too
      const onlyBob = await counts();
      expect(onlyBob.every((n) => n > 0)).toBe(true);

      const alice = await createUser('alice@example.com');
      const aliceProject = await seedProject(alice._id as Types.ObjectId, 'alice-proj');
      await seedProject(alice._id as Types.ObjectId, 'alice-archived', { isArchived: true, archivedAt: new Date() });
      await seedUserData(alice._id as Types.ObjectId);
      const auth = await login('alice@example.com');
      expect((await counts()).every((n, i) => n > onlyBob[i])).toBe(true);

      const res = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });

      expect(res.status).toBe(204);
      expect(await counts()).toEqual(onlyBob);
      expect(await ProjectModel.exists({ _id: aliceProject._id })).toBeNull();
      expect(await UserModel.exists({ _id: bob._id })).toBeTruthy();
      expect(await ProjectModel.countDocuments({ ownerId: bob._id })).toBe(1);
    });

    it('clears the refresh cookie in the response', async () => {
      await createUser('alice@example.com');
      const loginRes = await request(app).post('/api/auth/login').send({ email: 'alice@example.com', password: PASSWORD });
      const auth = { Authorization: `Bearer ${loginRes.body.data.tokens.accessToken as string}` };

      const res = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });

      expect(res.status).toBe(204);
      const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
      expect(cookies.some((c) => c.startsWith('mockia_rt=;') && /Path=\/api\/auth/.test(c))).toBe(true);
    });

    it('memberships: a project the user owns is deleted (members included); where only a member, just the membership goes', async () => {
      const alice = await createUser('alice@example.com');
      const bob = await createUser('bob@example.com');
      const owned = await seedProject(alice._id as Types.ObjectId, 'alice-proj', {
        members: [
          { userId: alice._id, role: ProjectRoleEnum.OWNER, addedAt: new Date() },
          { userId: bob._id, role: ProjectRoleEnum.EDITOR, addedAt: new Date() },
        ],
      });
      const shared = await seedProject(bob._id as Types.ObjectId, 'bob-proj', {
        members: [
          { userId: bob._id, role: ProjectRoleEnum.OWNER, addedAt: new Date() },
          { userId: alice._id, role: ProjectRoleEnum.VIEWER, addedAt: new Date() },
        ],
      });
      const auth = await login('alice@example.com');

      const res = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });

      expect(res.status).toBe(204);
      expect(await ProjectModel.exists({ _id: owned._id })).toBeNull();
      const kept = await ProjectModel.findById(shared._id);
      expect(kept).toBeTruthy();
      expect(kept!.members.map((m) => m.userId.toString())).toEqual([bob._id.toString()]);
      // Bob's project keeps its content
      expect(await MockAPIModel.countDocuments({ projectId: shared._id })).toBe(1);
    });

    it('deleting twice: the second call is a 401 (the account is gone)', async () => {
      await createUser('alice@example.com');
      const auth = await login('alice@example.com');
      const first = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });
      expect(first.status).toBe(204);

      const second = await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });
      expect(second.status).toBe(401);
    });

    it('the deleted account can no longer log in', async () => {
      await createUser('alice@example.com');
      const auth = await login('alice@example.com');
      await request(app).delete('/api/users/me').set(auth).send({ password: PASSWORD });

      const res = await request(app).post('/api/auth/login').send({ email: 'alice@example.com', password: PASSWORD });
      expect(res.status).toBe(401);
    });
  });
});
