import request from 'supertest';
import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { MockAPIModel, EndpointModel, ResponseModel } from '../models/MockAPI.js';
import { AiRateWindowModel } from '../models/AiRateWindow.js';
import { AiGenerationModel } from '../models/AiGeneration.js';
import { AiFeedbackModel } from '../models/AiFeedback.js';
import * as providers from '../modules/ai/providers/index.js';
import { recordFeedback } from '../modules/ai/feedback.js';
import * as consentModule from '../modules/ai/consent.js';
import { persistGeneration } from '../modules/ai/generationStore.js';
import { AppError } from '../middlewares/errorHandler.js';

/**
 * Own data with consent: the generations (prompts as sent + model output) are stored ONLY for users who opted in, the
 * thumbs up/down is accepted from everyone but carries content only with consent, and withdrawing the consent erases
 * everything stored. Nothing here may ever reach the logs.
 */

const PASSWORD = 'ai-feedback-test-password-1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENTINEL = 'ZZ-SENTINEL-NEVER-IN-LOGS-ZZ';

const SPEC = {
  apiVersion: '1.0.0',
  title: 'Gym API',
  description: 'd',
  endpoints: [
    { path: '/members', method: 'GET', description: 'List members', examples: [{ request: {}, response: { id: 1 } }] },
  ],
  dataModels: [],
};
const SPEC_TEXT = JSON.stringify(SPEC);
const CORRECTED = {
  ...SPEC,
  endpoints: [
    { path: '/members', method: 'GET', description: 'List members', examples: [{ request: {}, response: { id: 1 } }] },
    { path: '/classes', method: 'GET', description: 'List classes', examples: [{ request: {}, response: { id: 2 } }] },
  ],
};

const ALL = [UserModel, ProjectModel, MockAPIModel, EndpointModel, ResponseModel, AiRateWindowModel, AiGenerationModel, AiFeedbackModel];
const wipe = () => Promise.all(ALL.map((m) => (m as any).deleteMany({})));

interface Actor {
  id: string;
  auth: { Authorization: string };
  projectId: string;
}

async function makeActor(name: string, extra: Record<string, unknown> = {}): Promise<Actor> {
  const user = await UserModel.create({
    email: `${name}@example.com`,
    username: name,
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    emailVerifiedAt: new Date(),
    ...extra,
  });
  const login = await request(app).post('/api/auth/login').send({ email: `${name}@example.com`, password: PASSWORD });
  expect(login.status).toBe(200);
  const project = await ProjectModel.create({
    title: `P ${name}`,
    slug: `p-${name}`,
    ownerId: user._id,
    members: [{ userId: user._id, role: 'owner' }],
  });
  return {
    id: user._id.toString(),
    auth: { Authorization: `Bearer ${login.body.data.tokens.accessToken as string}` },
    projectId: project._id.toString(),
  };
}

const consent = (a: Actor, granted: boolean) => request(app).put('/api/users/me/ai-consent').set(a.auth).send({ granted });
const generate = (a: Actor, path = 'generate-mock-api-spec') =>
  request(app).post(`/api/ai/${path}`).set(a.auth).send({ projectId: a.projectId, requirement: 'members CRUD' });
const feedback = (a: Actor, body: Record<string, unknown>) => request(app).post('/api/ai/feedback').set(a.auth).send(body);

describe('AI training consent, generation storage and feedback', () => {
  const complete = jest.fn();
  let getLlmSpy: jest.SpyInstance;
  let logs: jest.SpyInstance[];
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    await connectDB();
    await Promise.all([AiGenerationModel.init(), AiFeedbackModel.init()]);
  });

  beforeEach(async () => {
    await wipe();
    logs = ['log', 'warn', 'error', 'info'].map((k) => jest.spyOn(console, k as 'log').mockImplementation(() => undefined));
    complete.mockReset();
    complete.mockResolvedValue({ text: SPEC_TEXT, provider: 'fake-provider', model: 'fake-model', usage: { inputTokens: 5, outputTokens: 7 } });
    getLlmSpy = jest.spyOn(providers, 'getLlm').mockReturnValue({ name: 'fake', complete });
    delete process.env.AI_GENERATION_RETENTION_DAYS;
    delete process.env.REQUIRE_EMAIL_VERIFICATION;
  });

  afterEach(() => {
    getLlmSpy.mockRestore();
    logs.forEach((l) => l.mockRestore());
    process.env = { ...savedEnv };
  });

  afterAll(async () => {
    await wipe();
    await disconnectDB();
  });

  const loggedText = () => logs.flatMap((l) => l.mock.calls.map((c) => c.map((x: unknown) => (typeof x === "string" ? x : JSON.stringify(x))).join(' '))).join('\n');

  /* ----------------------------------------------------------------------------------------------- consent */
  describe('consent', () => {
    it('is absent by default: no field in the database and none in the profile', async () => {
      const a = await makeActor('alice');
      const doc = await UserModel.findById(a.id).lean();
      expect(doc?.aiTrainingConsent).toBeUndefined();
      const profile = await request(app).get('/api/users/profile').set(a.auth);
      expect(profile.status).toBe(200);
      expect(profile.body.aiTrainingConsent).toBeUndefined();
    });

    it('needs a session and a boolean', async () => {
      const a = await makeActor('alice');
      expect((await request(app).put('/api/users/me/ai-consent').send({ granted: true })).status).toBe(401);
      for (const body of [{}, { granted: 'yes' }, { granted: 1 }, { granted: null }]) {
        const res = await request(app).put('/api/users/me/ai-consent').set(a.auth).send(body);
        expect(res.status).toBe(400);
      }
      expect((await UserModel.findById(a.id).lean())?.aiTrainingConsent).toBeUndefined();
    });

    it('granting records the moment and shows it in the profile (granted + at, nothing else)', async () => {
      const a = await makeActor('alice');
      const before = Date.now();
      const res = await consent(a, true);
      expect(res.status).toBe(200);
      expect(res.body.aiTrainingConsent.granted).toBe(true);
      const at = new Date(res.body.aiTrainingConsent.at).getTime();
      expect(at).toBeGreaterThanOrEqual(before - 1000);
      expect(at).toBeLessThanOrEqual(Date.now() + 1000);

      const profile = await request(app).get('/api/users/profile').set(a.auth);
      expect(Object.keys(profile.body.aiTrainingConsent).sort()).toEqual(['at', 'granted']);
      expect(profile.body.aiTrainingConsent.granted).toBe(true);
    });

    it('granting twice keeps the original moment', async () => {
      const a = await makeActor('alice');
      const first = await consent(a, true);
      await new Promise((r) => setTimeout(r, 15));
      const second = await consent(a, true);
      expect(second.status).toBe(200);
      expect(second.body.aiTrainingConsent.at).toBe(first.body.aiTrainingConsent.at);
    });

    it('withdrawing answers 204 and erases every stored generation and feedback of that user only', async () => {
      const a = await makeActor('alice');
      const b = await makeActor('bob');
      await consent(a, true);
      await consent(b, true);
      const ga = (await generate(a)).body.data.generationId as string;
      const gb = (await generate(b)).body.data.generationId as string;
      await feedback(a, { generationId: ga, verdict: 'good' });
      await feedback(b, { generationId: gb, verdict: 'good' });
      expect(await AiGenerationModel.countDocuments({})).toBe(2);
      expect(await AiFeedbackModel.countDocuments({})).toBe(2);

      const res = await consent(a, false);
      expect(res.status).toBe(204);
      expect(await AiGenerationModel.countDocuments({ userId: new Types.ObjectId(a.id) })).toBe(0);
      expect(await AiFeedbackModel.countDocuments({ userId: new Types.ObjectId(a.id) })).toBe(0);
      // the other user is untouched
      expect(await AiGenerationModel.countDocuments({ userId: new Types.ObjectId(b.id) })).toBe(1);
      expect(await AiFeedbackModel.countDocuments({ userId: new Types.ObjectId(b.id) })).toBe(1);

      const doc = await UserModel.findById(a.id).lean();
      expect(doc?.aiTrainingConsent?.granted).toBe(false);
    });

    it('withdrawing also erases verdict-only rows (consenting user, generation not stored), and works when nothing was ever stored or granted', async () => {
      const a = await makeActor('alice');
      expect((await consent(a, false)).status).toBe(204);
      const g = (await generate(a)).body.data.generationId as string; // generated before consenting: not stored
      await consent(a, true);
      await feedback(a, { generationId: g, verdict: 'bad' });
      expect(await AiFeedbackModel.countDocuments({})).toBe(1);
      expect((await consent(a, false)).status).toBe(204);
      expect(await AiFeedbackModel.countDocuments({})).toBe(0);
    });

    it('after withdrawing, new generations are not stored any more', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      await generate(a);
      expect(await AiGenerationModel.countDocuments({})).toBe(1);
      await consent(a, false);
      await generate(a);
      expect(await AiGenerationModel.countDocuments({})).toBe(0);
    });

    it('granting again after a withdrawal stamps a new moment', async () => {
      const a = await makeActor('alice');
      const first = await consent(a, true);
      await consent(a, false);
      await new Promise((r) => setTimeout(r, 15));
      const again = await consent(a, true);
      expect(new Date(again.body.aiTrainingConsent.at).getTime()).toBeGreaterThan(new Date(first.body.aiTrainingConsent.at).getTime());
    });
  });

  /* ----------------------------------------------------------------------------------------- persistence */
  describe('storing generations', () => {
    it.each(['generate-mock-api-spec', 'generate-and-save'])('%s returns a random generationId and keeps the old fields', async (path) => {
      const a = await makeActor('alice');
      const res = await generate(a, path);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.generationId).toMatch(UUID_RE);
      expect(res.body.data.specification.title).toBe('Gym API');
      expect(res.body.data.usage).toBeDefined();
      if (path === 'generate-and-save') expect(res.body.data.database.endpointsCreated).toBe(1);

      const again = await generate(a, path);
      expect(again.body.data.generationId).not.toBe(res.body.data.generationId);
    });

    it('without consent nothing about the content is persisted (but the id is still returned)', async () => {
      const a = await makeActor('alice');
      const create = jest.spyOn(AiGenerationModel, 'create');
      const res = await generate(a);
      const writes = create.mock.calls.length; // not even a write that is undone afterwards
      create.mockRestore();
      expect(writes).toBe(0);
      expect(res.body.data.generationId).toMatch(UUID_RE);
      expect(await AiGenerationModel.countDocuments({})).toBe(0);
      expect(await AiFeedbackModel.countDocuments({})).toBe(0);
    });

    it('with consent it stores the prompts as sent, the raw output, provider and model', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      const res = await generate(a);
      const doc = await AiGenerationModel.findOne({ generationId: res.body.data.generationId }).lean();
      expect(doc).toBeTruthy();
      expect(doc!.userId.toString()).toBe(a.id);
      expect(doc!.output).toBe(SPEC_TEXT);
      expect(doc!.parsedOk).toBe(true);
      expect(doc!.provider).toBe('fake-provider');
      expect(doc!.model).toBe('fake-model');
      expect(doc!.createdAt).toBeInstanceOf(Date);
      // the messages are exactly what the provider received
      const sent = complete.mock.calls[0][0].messages as Array<{ role: string; content: string }>;
      expect(doc!.messages.map((m) => ({ role: m.role, content: m.content }))).toEqual(sent);
      expect(doc!.messages.length).toBeGreaterThanOrEqual(2);
    });

    it('generate-and-save stores it too', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      const res = await generate(a, 'generate-and-save');
      expect(await AiGenerationModel.countDocuments({ generationId: res.body.data.generationId })).toBe(1);
    });

    it('expires after 180 days by default', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      const res = await generate(a);
      const doc = await AiGenerationModel.findOne({ generationId: res.body.data.generationId }).lean();
      const days = (doc!.expiresAt.getTime() - doc!.createdAt.getTime()) / 86_400_000;
      expect(days).toBeCloseTo(180, 1);
    });

    it('AI_GENERATION_RETENTION_DAYS changes the retention; nonsense falls back to 180', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      process.env.AI_GENERATION_RETENTION_DAYS = '30';
      const r1 = await generate(a);
      const d1 = await AiGenerationModel.findOne({ generationId: r1.body.data.generationId }).lean();
      expect((d1!.expiresAt.getTime() - d1!.createdAt.getTime()) / 86_400_000).toBeCloseTo(30, 1);

      for (const bad of ['0', '-5', 'abc', '', '1.5e3x']) {
        process.env.AI_GENERATION_RETENTION_DAYS = bad;
        const r = await generate(a);
        const d = await AiGenerationModel.findOne({ generationId: r.body.data.generationId }).lean();
        expect((d!.expiresAt.getTime() - d!.createdAt.getTime()) / 86_400_000).toBeCloseTo(180, 1);
      }
    });

    it('has a TTL index on expiresAt and a unique index on generationId', async () => {
      const indexes = await AiGenerationModel.collection.indexes();
      expect(indexes.some((i) => i.key.expiresAt === 1 && i.expireAfterSeconds === 0)).toBe(true);
      expect(indexes.some((i) => i.unique && i.key.generationId === 1)).toBe(true);
      expect(indexes.some((i) => i.key.userId === 1)).toBe(true);
      const fb = await AiFeedbackModel.collection.indexes();
      expect(fb.some((i) => i.key.expiresAt === 1 && i.expireAfterSeconds === 0)).toBe(true);
      expect(fb.some((i) => i.unique && i.key.userId === 1 && i.key.generationId === 1)).toBe(true);
    });

    it('a failed generation (unparseable answer) stores nothing and returns no id', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      complete.mockResolvedValue({ text: `this is not json ${SENTINEL}`, provider: 'fake', model: 'm' });
      const res = await generate(a);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.data?.generationId).toBeUndefined();
      expect(await AiGenerationModel.countDocuments({})).toBe(0);
    });

    it('the other AI routes neither return an id nor store anything', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      const d = await request(app).post('/api/ai/generate-description').set(a.auth).send({ prompt: 'p', userMessage: 'u' });
      expect(d.body.data.generationId).toBeUndefined();
      complete.mockResolvedValueOnce({ text: '{"a":1}', provider: 'fake', model: 'm' });
      const m = await request(app).post('/api/ai/generate-mock-data').set(a.auth).send({ schema: { a: 'number' } });
      expect(m.body.data.generationId).toBeUndefined();
      expect(await AiGenerationModel.countDocuments({})).toBe(0);
    });

    it('still answers when the database write fails (the user got their API) and never logs the content', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      complete.mockResolvedValue({ text: JSON.stringify({ ...SPEC, description: SENTINEL }), provider: 'fake', model: 'm' });
      const spy = jest.spyOn(AiGenerationModel, 'create').mockRejectedValueOnce(new Error(`boom ${SENTINEL}`));
      const res = await generate(a);
      spy.mockRestore();
      expect(res.status).toBe(200);
      expect(res.body.data.generationId).toMatch(UUID_RE);
      expect(loggedText()).not.toContain(SENTINEL);
    });

    it('logs never carry the prompts or the output of a stored generation', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      complete.mockResolvedValue({ text: JSON.stringify({ ...SPEC, description: SENTINEL }), provider: 'fake', model: 'm' });
      await request(app).post('/api/ai/generate-mock-api-spec').set(a.auth).send({ projectId: a.projectId, requirement: `members ${SENTINEL}` });
      await feedback(a, { generationId: (await AiGenerationModel.findOne({}).lean())!.generationId, verdict: 'good', correctedOutput: { ...CORRECTED, description: SENTINEL } });
      expect(loggedText()).not.toContain(SENTINEL);
    });
  });

  /* -------------------------------------------------------------------------------------------- feedback */
  describe('POST /ai/feedback', () => {
    it('needs a session', async () => {
      const res = await request(app).post('/api/ai/feedback').send({ generationId: '8d1c9f0e-5b5a-4a3e-9e63-0f0f6f4f9c11', verdict: 'good' });
      expect(res.status).toBe(401);
    });

    it('requires a verified email when verification is on (like the other AI routes)', async () => {
      const a = await makeActor('alice', { emailVerifiedAt: null });
      process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
      const res = await feedback(a, { generationId: '8d1c9f0e-5b5a-4a3e-9e63-0f0f6f4f9c11', verdict: 'good' });
      expect(res.status).toBe(403);
      expect(await AiFeedbackModel.countDocuments({})).toBe(0);
    });

    it('validates the body', async () => {
      const a = await makeActor('alice');
      const good = '8d1c9f0e-5b5a-4a3e-9e63-0f0f6f4f9c11';
      const bad: Array<Record<string, unknown>> = [
        {},
        { verdict: 'good' },
        { generationId: good },
        { generationId: good, verdict: 'meh' },
        { generationId: good, verdict: 'GOOD' },
        { generationId: 'not-a-uuid', verdict: 'good' },
        { generationId: { $ne: null }, verdict: 'good' },
        { generationId: good, verdict: 'good', correctedOutput: 'a string' },
        { generationId: good, verdict: 'good', correctedOutput: [1, 2] },
        { generationId: good, verdict: 'good', correctedOutput: 42 },
      ];
      for (const body of bad) {
        const res = await feedback(a, body);
        expect([400]).toContain(res.status);
      }
      expect(await AiFeedbackModel.countDocuments({})).toBe(0);
    });

    it('rejects a correctedOutput over ~200 KB', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      const id = (await generate(a)).body.data.generationId as string;
      const huge = { ...SPEC, description: 'x'.repeat(210_000) };
      const res = await feedback(a, { generationId: id, verdict: 'good', correctedOutput: huge });
      expect(res.status).toBe(400);
      expect(await AiFeedbackModel.countDocuments({})).toBe(0);
      const ok = await feedback(a, { generationId: id, verdict: 'good', correctedOutput: { ...SPEC, description: 'x'.repeat(100_000) } });
      expect(ok.status).toBe(204);
    });

    it('RULING R14: without consent nothing at all is stored (no verdict row either); the answer is the same 204 and the request is still validated', async () => {
      const a = await makeActor('alice');
      const id = (await generate(a)).body.data.generationId as string;
      const res = await feedback(a, {
        generationId: id,
        verdict: 'bad',
        correctedOutput: CORRECTED,
        provider: 'evil-provider',
        model: 'evil-model',
        output: 'x',
        messages: [{ role: 'user', content: 'x' }],
      });
      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      expect(await AiFeedbackModel.countDocuments({})).toBe(0);
      expect(await AiGenerationModel.countDocuments({})).toBe(0);
      // still validated like any other request
      expect((await feedback(a, { generationId: id, verdict: 'meh' })).status).toBe(400);
      expect(await AiFeedbackModel.countDocuments({})).toBe(0);
    });

    it('with consent and a generation that was never stored the vote is kept without content: no provider or model, the client is not trusted', async () => {
      const a = await makeActor('alice');
      const id = (await generate(a)).body.data.generationId as string; // not stored: generated before consenting
      await consent(a, true);
      const res = await feedback(a, {
        generationId: id,
        verdict: 'bad',
        correctedOutput: CORRECTED,
        provider: 'evil-provider',
        model: 'evil-model',
        output: 'x',
        messages: [{ role: 'user', content: 'x' }],
      });
      expect(res.status).toBe(204);
      const rows = await AiFeedbackModel.find({}).lean();
      expect(rows).toHaveLength(1);
      const row = rows[0] as Record<string, unknown>;
      expect(row.userId?.toString()).toBe(a.id);
      expect(row.generationId).toBe(id);
      expect(row.verdict).toBe('bad');
      expect(row.provider ?? null).toBeNull();
      expect(row.model ?? null).toBeNull();
      expect(row.createdAt).toBeInstanceOf(Date);
      const allowed = ['_id', '__v', 'userId', 'generationId', 'verdict', 'provider', 'model', 'createdAt', 'updatedAt', 'expiresAt'];
      expect(Object.keys(row).filter((k) => !allowed.includes(k))).toEqual([]);
      expect(JSON.stringify(row)).not.toContain('evil');
      expect(JSON.stringify(row)).not.toContain('classes');
    });

    it('with consent and a stored generation of the same user it links it, copies provider/model and keeps the verdict', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      const id = (await generate(a)).body.data.generationId as string;
      const res = await feedback(a, { generationId: id, verdict: 'good' });
      expect(res.status).toBe(204);
      const row = (await AiFeedbackModel.findOne({}).lean())!;
      expect(row.generationId).toBe(id);
      expect(row.verdict).toBe('good');
      expect(row.provider).toBe('fake-provider');
      expect(row.model).toBe('fake-model');
      expect(row.correctedOutput).toBeUndefined();
    });

    it('with consent it stores a valid correctedOutput', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      const id = (await generate(a)).body.data.generationId as string;
      const res = await feedback(a, { generationId: id, verdict: 'bad', correctedOutput: CORRECTED });
      expect(res.status).toBe(204);
      const row = (await AiFeedbackModel.findOne({}).lean())!;
      expect(row.verdict).toBe('bad');
      expect((row.correctedOutput as { endpoints: unknown[] }).endpoints).toHaveLength(2);
    });

    it('an invalid correctedOutput is a 400 and stores nothing', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      const id = (await generate(a)).body.data.generationId as string;
      for (const invalid of [{}, { title: 'x' }, { ...SPEC, endpoints: [] }, { ...SPEC, endpoints: [{ path: '/x', method: 'FETCH', description: 'd' }] }]) {
        const res = await feedback(a, { generationId: id, verdict: 'bad', correctedOutput: invalid });
        expect(res.status).toBe(400);
      }
      expect(await AiFeedbackModel.countDocuments({})).toBe(0);
    });

    it('a rejected correction leaves the earlier feedback untouched', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      const id = (await generate(a)).body.data.generationId as string;
      await feedback(a, { generationId: id, verdict: 'good' });
      const res = await feedback(a, { generationId: id, verdict: 'bad', correctedOutput: { nope: true } });
      expect(res.status).toBe(400);
      const rows = await AiFeedbackModel.find({}).lean();
      expect(rows).toHaveLength(1);
      expect(rows[0].verdict).toBe('good');
    });

    it("another user's generation: 404 and nothing is stored, with or without consent, with or without a correction", async () => {
      const a = await makeActor('alice');
      const b = await makeActor('bob');
      await consent(a, true);
      const id = (await generate(a)).body.data.generationId as string;

      for (const bobConsent of [false, true]) {
        await consent(b, bobConsent);
        for (const body of [{ generationId: id, verdict: 'good' }, { generationId: id, verdict: 'bad', correctedOutput: CORRECTED }]) {
          const res = await feedback(b, body);
          expect(res.status).toBe(404);
        }
      }
      expect(await AiFeedbackModel.countDocuments({})).toBe(0);
      // and alice's generation is intact
      expect(await AiGenerationModel.countDocuments({ generationId: id })).toBe(1);
    });

    it('with consent but a generation that was never stored: verdict only, correction dropped', async () => {
      const a = await makeActor('alice');
      const id = (await generate(a)).body.data.generationId as string; // generated BEFORE consenting: not stored
      await consent(a, true);
      const res = await feedback(a, { generationId: id, verdict: 'bad', correctedOutput: CORRECTED });
      expect(res.status).toBe(204);
      const row = (await AiFeedbackModel.findOne({}).lean())!;
      expect(row.verdict).toBe('bad');
      expect(row.provider ?? null).toBeNull();
      expect(row.correctedOutput).toBeUndefined();
    });

    it('is idempotent per (user, generation): the later feedback replaces the earlier one', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      const id = (await generate(a)).body.data.generationId as string;

      await feedback(a, { generationId: id, verdict: 'bad', correctedOutput: CORRECTED });
      await feedback(a, { generationId: id, verdict: 'good' });
      let rows = await AiFeedbackModel.find({}).lean();
      expect(rows).toHaveLength(1);
      expect(rows[0].verdict).toBe('good');
      expect(rows[0].correctedOutput).toBeUndefined(); // the earlier correction is gone

      await feedback(a, { generationId: id, verdict: 'good', correctedOutput: CORRECTED });
      await feedback(a, { generationId: id, verdict: 'good', correctedOutput: CORRECTED });
      rows = await AiFeedbackModel.find({}).lean();
      expect(rows).toHaveLength(1);
      expect(rows[0].correctedOutput).toBeDefined();
    });

    it('is idempotent for a consenting user whose generations were not stored, and different generations make different rows', async () => {
      const a = await makeActor('alice');
      const id1 = (await generate(a)).body.data.generationId as string;
      const id2 = (await generate(a)).body.data.generationId as string;
      await consent(a, true);
      await feedback(a, { generationId: id1, verdict: 'good' });
      await feedback(a, { generationId: id1, verdict: 'bad' });
      await feedback(a, { generationId: id2, verdict: 'good' });
      const rows = await AiFeedbackModel.find({}).sort({ generationId: 1 }).lean();
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.generationId === id1)?.verdict).toBe('bad');
    });

    it('two consenting users may rate the same (random) id without clobbering each other when neither generation is stored', async () => {
      const a = await makeActor('alice');
      const b = await makeActor('bob');
      await consent(a, true);
      await consent(b, true);
      const id = '8d1c9f0e-5b5a-4a3e-9e63-0f0f6f4f9c11';
      expect((await feedback(a, { generationId: id, verdict: 'good' })).status).toBe(204);
      expect((await feedback(b, { generationId: id, verdict: 'bad' })).status).toBe(204);
      expect(await AiFeedbackModel.countDocuments({})).toBe(2);
    });

    it('is rate limited per user (429 with Retry-After) and another user is unaffected', async () => {
      const a = await makeActor('alice');
      const b = await makeActor('bob');
      const id = '8d1c9f0e-5b5a-4a3e-9e63-0f0f6f4f9c11';
      let last = 204;
      let limited: request.Response | undefined;
      for (let i = 0; i < 80 && !limited; i++) {
        const res = await feedback(a, { generationId: id, verdict: i % 2 ? 'good' : 'bad' });
        last = res.status;
        if (res.status === 429) limited = res;
      }
      expect(last).toBe(429);
      expect(limited!.headers['retry-after']).toBeDefined();
      expect((await feedback(b, { generationId: id, verdict: 'good' })).status).toBe(204);
    });

    it('recordFeedback can be called directly and throws a 404 AppError for a foreign generation', async () => {
      const a = await makeActor('alice');
      const b = await makeActor('bob');
      await consent(a, true);
      const id = (await generate(a)).body.data.generationId as string;
      await expect(recordFeedback(b.id, id, 'good')).rejects.toMatchObject({ statusCode: 404 });
      await expect(recordFeedback(b.id, id, 'good')).rejects.toBeInstanceOf(AppError);
      await expect(recordFeedback(a.id, id, 'good', CORRECTED)).resolves.toBeUndefined();
      expect(await AiFeedbackModel.countDocuments({})).toBe(1);
    });

    it('feedback has the same retention as generations (TTL field set)', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      await feedback(a, { generationId: '8d1c9f0e-5b5a-4a3e-9e63-0f0f6f4f9c11', verdict: 'good' });
      const row = (await AiFeedbackModel.findOne({}).lean())!;
      const days = (row.expiresAt.getTime() - row.createdAt.getTime()) / 86_400_000;
      expect(days).toBeCloseTo(180, 1);
    });
  });

  /* ---------------------------------------------------------------------------- withdrawal in flight */
  describe('a withdrawal that happens while content is being written', () => {
    const generation = (userId: string) => ({
      generationId: '8d1c9f0e-5b5a-4a3e-9e63-0f0f6f4f9c11',
      userId,
      messages: [{ role: 'system' as const, content: 's' }, { role: 'user' as const, content: 'u' }],
      output: SPEC_TEXT,
      parsedOk: true,
      provider: 'p',
      model: 'm',
    });

    it('persistGeneration removes what it just wrote when the consent is gone after the write', async () => {
      const a = await makeActor('alice');
      const spy = jest.spyOn(consentModule, 'hasAiTrainingConsent').mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      const stored = await persistGeneration(generation(a.id));
      spy.mockRestore();
      expect(stored).toBe(false);
      expect(await AiGenerationModel.countDocuments({})).toBe(0);
    });

    it('recordFeedback removes a correction it just wrote when the consent is gone after the write', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      const id = (await generate(a)).body.data.generationId as string;
      // generation lookup + consent check pass, the post-write check says withdrawn
      const spy = jest.spyOn(consentModule, 'hasAiTrainingConsent').mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      await recordFeedback(a.id, id, 'bad', CORRECTED);
      spy.mockRestore();
      expect(await AiFeedbackModel.countDocuments({})).toBe(0);
    });

    it('persistGeneration without consent returns false and writes nothing', async () => {
      const a = await makeActor('alice');
      expect(await persistGeneration(generation(a.id))).toBe(false);
      expect(await AiGenerationModel.countDocuments({})).toBe(0);
    });
  });

  /* ------------------------------------------------------------------------------------------- GDPR */
  describe('GDPR integration', () => {
    it('the data export carries the consent, the stored generations and the feedback of that user only', async () => {
      const a = await makeActor('alice');
      const b = await makeActor('bob');
      await consent(a, true);
      await consent(b, true);
      const ga = (await generate(a)).body.data.generationId as string;
      const gb = (await generate(b)).body.data.generationId as string;
      await feedback(a, { generationId: ga, verdict: 'bad', correctedOutput: CORRECTED });
      await feedback(b, { generationId: gb, verdict: 'good' });

      const res = await request(app).get('/api/users/me/export').set(a.auth);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.text);
      expect(data.account.aiTrainingConsent.granted).toBe(true);
      expect(data.aiGenerations).toHaveLength(1);
      expect(data.aiGenerations[0].generationId).toBe(ga);
      expect(data.aiGenerations[0].output).toBe(SPEC_TEXT);
      expect(data.aiGenerations[0].messages.length).toBeGreaterThanOrEqual(2);
      expect(data.aiFeedback).toHaveLength(1);
      expect(data.aiFeedback[0].verdict).toBe('bad');
      expect(data.aiFeedback[0].correctedOutput.endpoints).toHaveLength(2);
      expect(res.text).not.toContain(gb);
    });

    it('without any of it the export has empty lists and no consent', async () => {
      const a = await makeActor('alice');
      const data = JSON.parse((await request(app).get('/api/users/me/export').set(a.auth)).text);
      expect(data.aiGenerations).toEqual([]);
      expect(data.aiFeedback).toEqual([]);
      expect(data.account.aiTrainingConsent).toBeNull();
    });

    it('deleting the account erases generations and feedback (and only that user\'s)', async () => {
      const a = await makeActor('alice');
      const b = await makeActor('bob');
      await consent(a, true);
      await consent(b, true);
      const ga = (await generate(a)).body.data.generationId as string;
      const gb = (await generate(b)).body.data.generationId as string;
      await feedback(a, { generationId: ga, verdict: 'good' });
      await feedback(b, { generationId: gb, verdict: 'good' });

      const del = await request(app).delete('/api/users/me').set(a.auth).send({ password: PASSWORD });
      expect(del.status).toBe(204);
      expect(await AiGenerationModel.countDocuments({ userId: new Types.ObjectId(a.id) })).toBe(0);
      expect(await AiFeedbackModel.countDocuments({ userId: new Types.ObjectId(a.id) })).toBe(0);
      expect(await AiGenerationModel.countDocuments({})).toBe(1);
      expect(await AiFeedbackModel.countDocuments({})).toBe(1);
    });

    it('a generation that persists WHILE the account is being deleted leaves no AI rows behind (consent is withdrawn before the erase)', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      const realDeleteMany = AiGenerationModel.deleteMany.bind(AiGenerationModel);
      let injected = false;
      const deleteSpy = jest.spyOn(AiGenerationModel, 'deleteMany').mockImplementation((async (filter: never) => {
        const result = await realDeleteMany(filter);
        if (!injected) {
          injected = true;
          // a stale access token finishing a generation right after the erase: it already passed its first consent check
          jest.spyOn(consentModule, 'hasAiTrainingConsent').mockResolvedValueOnce(true);
          await persistGeneration({
            generationId: '8d1c9f0e-5b5a-4a3e-9e63-0f0f6f4f9c11',
            userId: a.id,
            messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }],
            output: SPEC_TEXT,
            parsedOk: true,
            provider: 'p',
            model: 'm',
          });
        }
        return result;
      }) as never);
      const del = await request(app).delete('/api/users/me').set(a.auth).send({ password: PASSWORD });
      deleteSpy.mockRestore();
      expect(injected).toBe(true);
      expect(del.status).toBe(204);
      expect(await AiGenerationModel.countDocuments({ userId: new Types.ObjectId(a.id) })).toBe(0);
      expect(await AiFeedbackModel.countDocuments({ userId: new Types.ObjectId(a.id) })).toBe(0);
    });

    it('a stale token that generates after the account is gone stores nothing', async () => {
      const a = await makeActor('alice');
      await consent(a, true);
      await request(app).delete('/api/users/me').set(a.auth).send({ password: PASSWORD });
      expect(
        await persistGeneration({
          generationId: '9d1c9f0e-5b5a-4a3e-9e63-0f0f6f4f9c11',
          userId: a.id,
          messages: [{ role: 'user', content: 'u' }],
          output: SPEC_TEXT,
          parsedOk: true,
          provider: 'p',
          model: 'm',
        })
      ).toBe(false);
      expect(await AiGenerationModel.countDocuments({})).toBe(0);
    });
  });
});
