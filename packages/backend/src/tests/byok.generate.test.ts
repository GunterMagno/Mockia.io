/**
 * K4 - generating with the user's OWN AI key (BYOK): generate-mock-api-spec and generate-and-save with `credentialId`.
 *
 * What these tests pin (Review Focus 1 and 3 of the plan, decisions D8 and D9):
 *  - the credential is looked up for the AUTHENTICATED user only: another user's id, a missing one and a malformed one
 *    are the same 404 and NOTHING leaves the server; an editor of a shared project cannot use the owner's credential;
 *  - the key travels only in the Authorization header of the call to the user's provider; it is in no response, console
 *    output, AiCall document, stored error, notification or collection of the database (sentinel sweep);
 *  - the platform's monthly quota is not touched; the user's own monthly counter (`byokGenerations`) is, with the refund
 *    rules of ruling B3-R3 (given back only when the provider certainly generated nothing);
 *  - no fallback to the platform's AI, and the generation never reaches the training-data store, consent or not;
 *  - the provider is a local HTTPS server with a throw-away certificate reached through K2's test-only `testDialOverride`
 *    (see byokTlsFake.ts); no real provider and no real key is ever contacted.
 */
import { inspect } from 'node:util';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import bcrypt from 'bcrypt';
import mongoose, { Types } from 'mongoose';
import { ErrorCode } from '@mockia/shared';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { UsageModel } from '../models/Usage.js';
import { AiCallModel } from '../models/AiCall.js';
import { AiGenerationModel } from '../models/AiGeneration.js';
import { AiRateWindowModel } from '../models/AiRateWindow.js';
import { AiCredentialModel } from '../models/AiCredential.js';
import { NotificationModel } from '../models/Notification.js';
import { EndpointConfigModel } from '../models/EndpointConfig.js';
import * as providers from '../modules/ai/providers/index.js';
import { setAiTrainingConsent } from '../modules/ai/consent.js';
import { drainAiCalls } from '../modules/metrics/aiCalls.js';
import { invalidatePlanCache } from '../modules/billing/plans.js';
import { periodOf } from '../modules/billing/usage.js';
import { generateKeyEntry, seal } from '../modules/byok/crypto.js';
import { createSafeFetch } from '../modules/byok/safeHttp.js';
import { credentialAad, setProviderFetchForTests } from '../modules/byok/service.js';
import {
  closedPort,
  startTlsFake,
  type FakeHandler,
  type SeenRequest,
  type TlsFake,
} from './byokTlsFake.js';

const PASSWORD = 'byok-generate-password-1';
const PUBLIC = { address: '93.184.216.34', family: 4 };
const HOSTS = ['api.openai.com', 'openrouter.ai', 'llm.example.com'];

const SPEC = JSON.stringify({
  apiVersion: '1.0.0',
  title: 'Gym API',
  description: 'd',
  endpoints: [
    {
      path: '/members',
      method: 'GET',
      description: 'List members',
      examples: [{ request: {}, response: { id: 1 } }],
    },
  ],
  dataModels: [],
});

/** A throw-away key sentinel: never a real key, different on every call, long enough to be searched for. */
const newKey = () => `sk-test-${randomBytes(18).toString('hex')}`;

const completion = (content: string, over: Record<string, unknown> = {}) => ({
  id: 'cmpl-1',
  object: 'chat.completion',
  model: 'gpt-4o-mini',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  ...over,
});

const json = (res: Parameters<FakeHandler>[1], status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

let emailCounter = 0;
async function createUser(extra: Record<string, unknown> = {}) {
  emailCounter += 1;
  const email = `gen${emailCounter}-${randomBytes(3).toString('hex')}@example.com`;
  const user = await UserModel.create({
    email,
    username: `gen${emailCounter}${randomBytes(2).toString('hex')}`,
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    locale: 'es',
    emailVerifiedAt: new Date(),
    ...extra,
  });
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return {
    id: user._id.toString(),
    auth: { Authorization: `Bearer ${res.body.data.tokens.accessToken as string}` },
  };
}
type Actor = Awaited<ReturnType<typeof createUser>>;

/** A project the actor owns (and optionally other members). */
async function makeProject(owner: Actor, members: Array<{ actor: Actor; role: string }> = []) {
  const slug = `p-${randomBytes(4).toString('hex')}`;
  const project = await ProjectModel.create({
    title: slug,
    slug,
    ownerId: owner.id,
    members: [
      { userId: owner.id, role: 'owner' },
      ...members.map((m) => ({ userId: m.actor.id, role: m.role })),
    ],
  });
  return project._id.toString();
}

/** Stores a credential the way K3 does (sealed under userId|credId|baseUrl), without going through the API. */
async function makeCredential(
  owner: Actor,
  over: { preset?: string; baseUrl?: string; model?: string; label?: string } = {}
) {
  const key = newKey();
  const preset = over.preset ?? 'openai';
  const baseUrl = over.baseUrl ?? 'https://api.openai.com/v1';
  const _id = new Types.ObjectId();
  await AiCredentialModel.create({
    _id,
    userId: owner.id,
    label: over.label ?? `cred-${randomBytes(3).toString('hex')}`,
    preset,
    baseUrl,
    model: over.model ?? 'gpt-4o-mini',
    sealed: seal(key, credentialAad(owner.id, _id.toString(), baseUrl)),
    last4: key.slice(-4),
  });
  return { id: _id.toString(), key };
}

const generate = (
  route: 'generate-mock-api-spec' | 'generate-and-save',
  actor: Actor,
  body: Record<string, unknown>
) => request(app).post(`/api/ai/${route}`).set(actor.auth).send(body);

const counters = async (userId: string) => {
  const doc = await UsageModel.findOne({ ownerId: userId, period: periodOf(new Date()) }).lean();
  return {
    platform: doc?.aiGenerations ?? 0,
    byok: (doc as { byokGenerations?: number } | null)?.byokGenerations ?? 0,
  };
};

/** Everything the process printed, as one string. */
function captureConsole() {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    jest.spyOn(console, m).mockImplementation(() => undefined)
  );
  return () =>
    spies
      .flatMap((s) => s.mock.calls)
      .map((args) =>
        args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' ')
      )
      .join('\n');
}

/** Every document of every collection, except the one place where the sealed key is allowed to live. */
async function dumpDatabase(): Promise<string> {
  const db = mongoose.connection.db!;
  const lines: string[] = [];
  for (const c of await db.listCollections().toArray()) {
    for (const doc of await db.collection(c.name).find({}).toArray()) {
      if (c.name === 'aicredentials') delete (doc as Record<string, unknown>).sealed;
      lines.push(`${c.name} ${JSON.stringify(doc)}`);
    }
  }
  return lines.join('\n');
}

describe('generating with the user’s own AI key (BYOK) - /api/ai/*', () => {
  let fake: TlsFake;
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'BYOK_ENABLED',
    'BYOK_KEYS',
    'BYOK_ALLOW_CUSTOM_URLS',
    'BYOK_MAX_MONTHLY_GENERATIONS',
    'AI_TOTAL_TIMEOUT_MS',
    'AI_PROVIDERS',
    'REQUIRE_EMAIL_VERIFICATION',
  ];
  let getLlmSpy: jest.SpyInstance;
  let printed: () => string;

  /** The user's provider: checks the Authorization header it receives and answers with a valid spec. */
  let expectedKey = '';
  const goodProvider =
    (content: string = SPEC): FakeHandler =>
    (req, res) => {
      if (req.headers.authorization !== `Bearer ${expectedKey}`) {
        return json(res, 401, {
          error: { message: `Incorrect API key: ${req.headers.authorization}` },
        });
      }
      json(res, 200, completion(content));
    };

  const useFake = () =>
    setProviderFetchForTests(
      createSafeFetch({
        lookup: async () => [PUBLIC],
        testDialOverride: { port: fake.port, ca: fake.ca },
      })
    );

  /** Provider that answers with the same status and body every time (the key it is given is quoted back, as real ones do). */
  const failing =
    (status: number): FakeHandler =>
    (req, res) =>
      json(res, status, {
        error: {
          message: `Request failed. Authorization: ${req.headers.authorization}; key=${expectedKey}`,
        },
      });

  const chatRequests = (): SeenRequest[] =>
    fake.seen.filter((r) => r.url?.endsWith('/chat/completions'));

  beforeAll(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.BYOK_KEYS = generateKeyEntry('k1');
    await connectDB();
    await Promise.all([AiCredentialModel.init(), UsageModel.init(), AiRateWindowModel.init()]);
    fake = await startTlsFake(HOSTS, goodProvider());
  });

  afterAll(async () => {
    setProviderFetchForTests(undefined);
    await fake.close();
    await Promise.all([
      UserModel.deleteMany({ email: /^gen\d+-/ }),
      ProjectModel.deleteMany({}),
      UsageModel.deleteMany({}),
      AiCredentialModel.deleteMany({}),
      AiCallModel.deleteMany({}),
      AiGenerationModel.deleteMany({}),
      AiRateWindowModel.deleteMany({}),
      NotificationModel.deleteMany({}),
      EndpointConfigModel.deleteMany({}),
    ]);
    await disconnectDB();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  beforeEach(async () => {
    process.env.BYOK_ENABLED = 'true';
    delete process.env.BYOK_ALLOW_CUSTOM_URLS;
    delete process.env.BYOK_MAX_MONTHLY_GENERATIONS;
    delete process.env.REQUIRE_EMAIL_VERIFICATION;
    process.env.AI_TOTAL_TIMEOUT_MS = '20000';
    process.env.AI_PROVIDERS = 'local';
    await drainAiCalls();
    await Promise.all([
      ProjectModel.deleteMany({}),
      UsageModel.deleteMany({}),
      AiCredentialModel.deleteMany({}),
      AiCallModel.deleteMany({}),
      AiGenerationModel.deleteMany({}),
      AiRateWindowModel.deleteMany({}),
      NotificationModel.deleteMany({}),
      EndpointConfigModel.deleteMany({}),
    ]);
    invalidatePlanCache();
    expectedKey = '';
    fake.setHandler(goodProvider());
    fake.seen.length = 0;
    useFake();
    // The platform's AI must never be reached from a BYOK request: any call to the chain is a test failure
    getLlmSpy = jest.spyOn(providers, 'getLlm').mockImplementation(() => {
      throw new Error('the platform AI chain must not be used');
    });
    printed = captureConsole();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(a) a correct generation', () => {
    it.each(['generate-mock-api-spec', 'generate-and-save'] as const)(
      '%s: uses the user’s key, leaves the platform quota alone and raises the BYOK counter by 1',
      async (route) => {
        const alice = await createUser();
        const cred = await makeCredential(alice, { model: 'my-model' });
        expectedKey = cred.key;
        const projectId = await makeProject(alice);

        const res = await generate(route, alice, {
          projectId,
          requirement: 'a gym',
          credentialId: cred.id,
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.specification.title).toBe('Gym API');
        // the platform stores nothing about a generation made with the user's own AI: no id to rate it with
        expect(res.body.data.generationId).toBeUndefined();
        if (route === 'generate-and-save') {
          expect(res.body.data.database.endpointsCreated).toBe(1);
        }

        // the provider got the key in the header (and checked it), the chosen model, and the key nowhere else
        const seen = chatRequests();
        expect(seen).toHaveLength(1);
        expect(seen[0].method).toBe('POST');
        expect(seen[0].url).toBe('/v1/chat/completions');
        expect(seen[0].headers.authorization).toBe(`Bearer ${cred.key}`);
        expect(seen[0].headers.host).toBe('api.openai.com');
        expect(seen[0].body).not.toContain(cred.key);
        expect(JSON.parse(seen[0].body).model).toBe('my-model');

        expect(await counters(alice.id)).toEqual({ platform: 0, byok: 1 });

        // the credential remembers the use
        const stored = await AiCredentialModel.findById(cred.id).lean();
        expect(stored?.lastUsedAt).toBeInstanceOf(Date);
        expect(stored?.lastError).toBeUndefined();

        // one anonymous AiCall: scope byok, the preset as provider, the user's plan
        await drainAiCalls();
        const calls = await AiCallModel.find({}).lean();
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
          scope: 'byok',
          plan: 'free',
          provider: 'openai',
          model: 'gpt-4o-mini',
          outcome: 'ok',
          inputTokens: 11,
          outputTokens: 7,
        });
        expect(getLlmSpy).not.toHaveBeenCalled();
      }
    );

    it('works when the platform quota is already spent (the monthly platform cap does not apply)', async () => {
      const alice = await createUser();
      const cred = await makeCredential(alice);
      expectedKey = cred.key;
      const projectId = await makeProject(alice);
      await UsageModel.create({
        ownerId: alice.id,
        period: periodOf(new Date()),
        aiGenerations: 5, // the whole Free allowance
      });

      const res = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'a gym',
        credentialId: cred.id,
      });

      expect(res.status).toBe(200);
      expect(await counters(alice.id)).toEqual({ platform: 5, byok: 1 });
    });

    it('clears a previous lastError after a success', async () => {
      const alice = await createUser();
      const cred = await makeCredential(alice);
      await AiCredentialModel.updateOne({ _id: cred.id }, { $set: { lastError: 'rejected' } });
      expectedKey = cred.key;
      const projectId = await makeProject(alice);

      const res = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });
      expect(res.status).toBe(200);
      const stored = await AiCredentialModel.findById(cred.id).lean();
      expect(stored?.lastError).toBeUndefined();
    });

    it('records the plan of the user and the preset (never the URL) of a custom credential', async () => {
      process.env.BYOK_ALLOW_CUSTOM_URLS = 'true';
      const bob = await createUser({ plan: 'pro', billingStatus: 'active' });
      const cred = await makeCredential(bob, {
        preset: 'custom',
        baseUrl: 'https://llm.example.com/internal-path',
      });
      expectedKey = cred.key;
      const projectId = await makeProject(bob);

      const res = await generate('generate-mock-api-spec', bob, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });
      expect(res.status).toBe(200);
      expect(chatRequests()[0].headers.host).toBe('llm.example.com');
      expect(chatRequests()[0].url).toBe('/internal-path/v1/chat/completions');

      await drainAiCalls();
      const calls = await AiCallModel.find({}).lean();
      expect(calls[0]).toMatchObject({ scope: 'byok', plan: 'pro', provider: 'custom' });
      expect(JSON.stringify(calls)).not.toContain('llm.example.com');
      expect(printed()).not.toContain('llm.example.com');
    });

    it('a stored custom credential stops working once custom URLs are switched off', async () => {
      process.env.BYOK_ALLOW_CUSTOM_URLS = 'true';
      const alice = await createUser();
      const cred = await makeCredential(alice, {
        preset: 'custom',
        baseUrl: 'https://llm.example.com/v1',
      });
      expectedKey = cred.key;
      const projectId = await makeProject(alice);
      process.env.BYOK_ALLOW_CUSTOM_URLS = 'false';

      const res = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(ErrorCode.AI_PROVIDER_URL_INVALID);
      expect(fake.seen).toHaveLength(0);
      expect(await counters(alice.id)).toEqual({ platform: 0, byok: 0 });
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(b) Review Focus 1: only the owner of a credential can use it', () => {
    it('another user’s id, a missing id and a malformed id are the SAME 404 and nothing leaves the server', async () => {
      const alice = await createUser();
      const mallory = await createUser();
      const cred = await makeCredential(alice);
      expectedKey = cred.key;
      const projectId = await makeProject(mallory);

      const attempts = [cred.id, new Types.ObjectId().toString(), 'not-an-object-id', '../../etc'];
      const bodies: unknown[] = [];
      for (const route of ['generate-mock-api-spec', 'generate-and-save'] as const) {
        for (const credentialId of attempts) {
          const res = await generate(route, mallory, { projectId, requirement: 'x', credentialId });
          expect(res.status).toBe(404);
          expect(res.body.error.code).toBe(ErrorCode.AI_CREDENTIAL_NOT_FOUND);
          bodies.push(res.body.error);
        }
      }
      // indistinguishable: not even the message differs
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);

      expect(fake.seen).toHaveLength(0); // no outbound request at all
      expect(getLlmSpy).not.toHaveBeenCalled();
      expect(await counters(mallory.id)).toEqual({ platform: 0, byok: 0 });
      expect(await counters(alice.id)).toEqual({ platform: 0, byok: 0 });
      // and the owner's record is untouched
      const stored = await AiCredentialModel.findById(cred.id).lean();
      expect(stored?.lastUsedAt).toBeUndefined();
    });

    it('a credentialId that is not a string is a validation error, never a query', async () => {
      const alice = await createUser();
      const projectId = await makeProject(alice);
      for (const credentialId of [{ $ne: null }, 12345, ['a'], true]) {
        const res = await generate('generate-mock-api-spec', alice, {
          projectId,
          requirement: 'x',
          credentialId,
        });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      }
      expect(fake.seen).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(c) the provider rejects or refuses: no fallback, clear codes, no unit lost', () => {
    it.each([401, 403])(
      '%i from the provider: AI_PROVIDER_REJECTED, lastError rejected, platform AI never called, unit given back',
      async (status) => {
        const alice = await createUser();
        const cred = await makeCredential(alice);
        expectedKey = cred.key;
        fake.setHandler(failing(status));
        const projectId = await makeProject(alice);

        const res = await generate('generate-mock-api-spec', alice, {
          projectId,
          requirement: 'x',
          credentialId: cred.id,
        });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe(ErrorCode.AI_PROVIDER_REJECTED);
        expect(res.text).not.toContain(cred.key);
        expect(getLlmSpy).not.toHaveBeenCalled();
        expect(chatRequests()).toHaveLength(1); // no retry of a refusal
        const stored = await AiCredentialModel.findById(cred.id).lean();
        expect(stored?.lastError).toBe('rejected');
        expect(await counters(alice.id)).toEqual({ platform: 0, byok: 0 });
        await drainAiCalls();
        expect(await AiCallModel.find({}).lean()).toEqual([
          expect.objectContaining({ scope: 'byok', provider: 'openai', outcome: 'refused' }),
        ]);
      }
    );

    it('402 and 429 from the provider have their own codes (and give the unit back)', async () => {
      const alice = await createUser();
      const cred = await makeCredential(alice);
      expectedKey = cred.key;
      const projectId = await makeProject(alice);

      fake.setHandler(failing(402));
      const noCredit = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });
      expect(noCredit.status).toBe(402);
      expect(noCredit.body.error.code).toBe(ErrorCode.AI_PROVIDER_NO_CREDIT);

      fake.setHandler(failing(429));
      const limited = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe(ErrorCode.AI_PROVIDER_RATE_LIMITED);

      for (const res of [noCredit, limited]) expect(res.text).not.toContain(cred.key);
      // neither marks the key as bad: the key works, the account does not have credit / is throttled
      const stored = await AiCredentialModel.findById(cred.id).lean();
      expect(stored?.lastError).toBeUndefined();
      expect(await counters(alice.id)).toEqual({ platform: 0, byok: 0 });
      expect(getLlmSpy).not.toHaveBeenCalled();
    });

    it.each([404, 500, 503])(
      '%i from the provider: 502 with a fixed message, no fallback, unit given back',
      async (status) => {
        const alice = await createUser();
        const cred = await makeCredential(alice);
        expectedKey = cred.key;
        fake.setHandler(failing(status));
        const projectId = await makeProject(alice);

        const res = await generate('generate-and-save', alice, {
          projectId,
          requirement: 'x',
          credentialId: cred.id,
        });

        expect(res.status).toBe(502);
        expect(res.body.error.code).toBe(ErrorCode.EXTERNAL_SERVICE_ERROR);
        expect(res.text).not.toMatch(/Request failed/);
        expect(getLlmSpy).not.toHaveBeenCalled();
        expect(await counters(alice.id)).toEqual({ platform: 0, byok: 0 });
      }
    );

    it('an unreachable provider (nothing listens): 502 and the unit is given back', async () => {
      const alice = await createUser();
      const cred = await makeCredential(alice);
      expectedKey = cred.key;
      setProviderFetchForTests(
        createSafeFetch({
          lookup: async () => [PUBLIC],
          testDialOverride: { port: await closedPort(), ca: fake.ca },
        })
      );
      const projectId = await makeProject(alice);

      const res = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });
      expect(res.status).toBe(502);
      expect(await counters(alice.id)).toEqual({ platform: 0, byok: 0 });
      expect(getLlmSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(d) Review Focus 3: the key is nowhere, whatever the provider says', () => {
    const SWEEPS = async (key: string, response: { text: string }) => {
      expect(response.text).not.toContain(key);
      expect(printed()).not.toContain(key);
      await drainAiCalls();
      expect(JSON.stringify(await AiCallModel.find({}).lean())).not.toContain(key);
      expect(
        JSON.stringify(await AiCredentialModel.find({}).select('-sealed').lean())
      ).not.toContain(key);
      expect(JSON.stringify(await NotificationModel.find({}).lean())).not.toContain(key);
      expect(await dumpDatabase()).not.toContain(key);
    };

    it('a 500 whose body repeats the key and the Authorization header', async () => {
      const alice = await createUser();
      const cred = await makeCredential(alice);
      expectedKey = cred.key;
      fake.setHandler(failing(500));
      const projectId = await makeProject(alice);

      const res = await generate('generate-and-save', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });
      expect(res.status).toBe(502);
      await SWEEPS(cred.key, res);
    });

    it.each([401, 402, 429])('a %i whose body repeats the key', async (status) => {
      const alice = await createUser();
      const cred = await makeCredential(alice);
      expectedKey = cred.key;
      fake.setHandler(failing(status));
      const projectId = await makeProject(alice);
      const res = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });
      await SWEEPS(cred.key, res);
    });

    it('an error thrown by the HTTP layer that quotes the key and the header is redacted before it is logged', async () => {
      const alice = await createUser();
      const cred = await makeCredential(alice);
      expectedKey = cred.key;
      setProviderFetchForTests(async () => {
        throw new Error(
          `socket exploded; sent Authorization: Bearer ${cred.key} and key=${cred.key}`
        );
      });
      const projectId = await makeProject(alice);

      const res = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });
      expect(res.status).toBe(502);
      await SWEEPS(cred.key, res);
      // it is still diagnosable: the rest of the message survives, the secret does not
      expect(printed()).toContain('socket exploded');
      expect(printed()).toContain('[REDACTED_KEY]');
    });

    it('a success whose reported model name is the key (a hostile provider) is not stored or logged', async () => {
      const alice = await createUser();
      const cred = await makeCredential(alice);
      expectedKey = cred.key;
      fake.setHandler((req, res) => json(res, 200, completion(SPEC, { model: `${cred.key}` })));
      const projectId = await makeProject(alice);

      const res = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });
      expect(res.status).toBe(200);
      await SWEEPS(cred.key, res);
      const calls = await AiCallModel.find({}).lean();
      expect(calls[0].model).toBe('gpt-4o-mini'); // the model the user configured
    });

    it('a normal success leaves the key out of every output too', async () => {
      const alice = await createUser();
      const cred = await makeCredential(alice);
      expectedKey = cred.key;
      const projectId = await makeProject(alice);
      const res = await generate('generate-and-save', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });
      expect(res.status).toBe(200);
      await SWEEPS(cred.key, res);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(e) a provider that is too slow', () => {
    it('answers 504, does NOT give the unit back (the provider may have been generating) and says nothing about the key', async () => {
      process.env.AI_TOTAL_TIMEOUT_MS = '700';
      const alice = await createUser();
      const cred = await makeCredential(alice);
      expectedKey = cred.key;
      fake.setHandler(() => undefined); // never answers
      const projectId = await makeProject(alice);

      const res = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });

      expect(res.status).toBe(504);
      expect(res.text).not.toContain(cred.key);
      expect(await counters(alice.id)).toEqual({ platform: 0, byok: 1 });
      expect(getLlmSpy).not.toHaveBeenCalled();
      await drainAiCalls();
      expect(await AiCallModel.find({}).lean()).toEqual([
        expect.objectContaining({ scope: 'byok', outcome: 'timeout' }),
      ]);
      expect(printed()).not.toContain(cred.key);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(f) the monthly cap of the user’s own generations', () => {
    it('BYOK_MAX_MONTHLY_GENERATIONS reached: 429 with its own code, nothing is sent, nothing else is touched', async () => {
      process.env.BYOK_MAX_MONTHLY_GENERATIONS = '2';
      const alice = await createUser();
      const other = await createUser();
      const cred = await makeCredential(alice);
      const otherCred = await makeCredential(other);
      expectedKey = cred.key;
      const projectId = await makeProject(alice);

      for (let i = 0; i < 2; i++) {
        const ok = await generate('generate-mock-api-spec', alice, {
          projectId,
          requirement: 'x',
          credentialId: cred.id,
        });
        expect(ok.status).toBe(200);
      }
      fake.seen.length = 0;
      const third = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });

      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe(ErrorCode.AI_BYOK_QUOTA_EXCEEDED);
      expect(third.body.error).toMatchObject({ used: 2, limit: 2 });
      expect(typeof third.body.error.resetsAt).toBe('string');
      expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
      expect(fake.seen).toHaveLength(0);
      expect(await counters(alice.id)).toEqual({ platform: 0, byok: 2 });

      // the platform quota is a different thing: spending BYOK does not eat it, and the cap is per user
      expectedKey = otherCred.key;
      const otherProject = await makeProject(other);
      const fine = await generate('generate-mock-api-spec', other, {
        projectId: otherProject,
        requirement: 'x',
        credentialId: otherCred.id,
      });
      expect(fine.status).toBe(200);
    });

    it('defaults to 3000 and ignores values that are not a positive integer', async () => {
      const alice = await createUser();
      const cred = await makeCredential(alice);
      expectedKey = cred.key;
      const projectId = await makeProject(alice);
      await UsageModel.create({
        ownerId: alice.id,
        period: periodOf(new Date()),
        byokGenerations: 2999,
      });
      for (const value of [undefined, '', 'abc', '0', '-5', '1.5']) {
        if (value === undefined) delete process.env.BYOK_MAX_MONTHLY_GENERATIONS;
        else process.env.BYOK_MAX_MONTHLY_GENERATIONS = value;
        await UsageModel.updateOne({ ownerId: alice.id }, { $set: { byokGenerations: 2999 } });
        const res = await generate('generate-mock-api-spec', alice, {
          projectId,
          requirement: 'x',
          credentialId: cred.id,
        });
        expect(res.status).toBe(200); // the 3000th is fine ...
        const next = await generate('generate-mock-api-spec', alice, {
          projectId,
          requirement: 'x',
          credentialId: cred.id,
        });
        expect(next.status).toBe(429); // ... the 3001st is not
        expect(next.body.error.limit).toBe(3000);
      }
    });

    it('parallel requests never go past the cap', async () => {
      process.env.BYOK_MAX_MONTHLY_GENERATIONS = '3';
      const alice = await createUser();
      const cred = await makeCredential(alice);
      expectedKey = cred.key;
      const projectId = await makeProject(alice);
      // the per-minute limiter (20) is not what is under test
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          generate('generate-mock-api-spec', alice, {
            projectId,
            requirement: 'x',
            credentialId: cred.id,
          })
        )
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(3);
      expect(results.filter((r) => r.status === 429)).toHaveLength(5);
      expect(chatRequests()).toHaveLength(3);
      expect((await counters(alice.id)).byok).toBe(3);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('refund rules (B3-R3) with the user’s own provider', () => {
    it('an answer that is cut by max_tokens is billed by the provider: the unit stays spent', async () => {
      const alice = await createUser();
      const cred = await makeCredential(alice);
      expectedKey = cred.key;
      fake.setHandler((req, res) => {
        const body = completion('{"apiVersion":"1.0.0","title":"cut');
        body.choices[0].finish_reason = 'length';
        json(res, 200, body);
      });
      const projectId = await makeProject(alice);
      const res = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });
      expect(res.status).toBe(502);
      expect(await counters(alice.id)).toEqual({ platform: 0, byok: 1 });
    });

    it('an invalid answer gets ONE repair (same validation as the platform AI); a second invalid one is a 502 and stays spent', async () => {
      const alice = await createUser();
      const cred = await makeCredential(alice);
      expectedKey = cred.key;
      const projectId = await makeProject(alice);

      let calls = 0;
      fake.setHandler((req, res) => {
        calls += 1;
        json(res, 200, completion(calls === 1 ? 'this is not json' : SPEC));
      });
      const repaired = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });
      expect(repaired.status).toBe(200);
      expect(chatRequests()).toHaveLength(2);
      const repairMessages = JSON.parse(chatRequests()[1].body).messages as Array<{
        role: string;
        content: string;
      }>;
      expect(repairMessages[repairMessages.length - 1].content).toMatch(
        /previous output was invalid/
      );
      expect(repairMessages[repairMessages.length - 1].content).not.toContain('this is not json');
      expect(await counters(alice.id)).toEqual({ platform: 0, byok: 1 });

      fake.seen.length = 0;
      fake.setHandler((req, res) => json(res, 200, completion('still not json')));
      const failed = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });
      expect(failed.status).toBe(502);
      expect(chatRequests()).toHaveLength(2); // the first answer and exactly one repair
      expect(await counters(alice.id)).toEqual({ platform: 0, byok: 2 });
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(g) decision D9: never the training-data store', () => {
    it.each(['generate-mock-api-spec', 'generate-and-save'] as const)(
      '%s: a user who consented gets no stored generation from their own AI (and does from the platform AI: the control)',
      async (route) => {
        const alice = await createUser();
        await setAiTrainingConsent(alice.id, true);
        const cred = await makeCredential(alice);
        expectedKey = cred.key;
        const projectId = await makeProject(alice);

        const res = await generate(route, alice, {
          projectId,
          requirement: 'x',
          credentialId: cred.id,
        });
        expect(res.status).toBe(200);
        expect(await AiGenerationModel.countDocuments({})).toBe(0);

        // the control: without credentialId the same user, with the same consent, IS stored (so the check above is not vacuous)
        getLlmSpy.mockReturnValue({
          name: 'platform',
          complete: async () => ({ text: SPEC, provider: 'platform', model: 'm' }),
        });
        const platform = await generate(route, alice, { projectId, requirement: 'x' });
        expect(platform.status).toBe(200);
        expect(await AiGenerationModel.countDocuments({})).toBe(1);
        expect(await counters(alice.id)).toEqual({ platform: 1, byok: 1 });
      }
    );
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(h) response_format', () => {
    it('a provider that rejects json_schema with 400 gets exactly ONE more try with json_object', async () => {
      const alice = await createUser();
      const cred = await makeCredential(alice);
      expectedKey = cred.key;
      fake.setHandler((req, res) => {
        const format = JSON.parse(req.body).response_format as { type: string } | undefined;
        if (format?.type === 'json_schema') {
          return json(res, 400, {
            error: { message: `response_format not supported (${req.headers.authorization})` },
          });
        }
        json(res, 200, completion(SPEC));
      });
      const projectId = await makeProject(alice);

      const res = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });

      expect(res.status).toBe(200);
      const seen = chatRequests();
      expect(seen).toHaveLength(2);
      expect(JSON.parse(seen[0].body).response_format.type).toBe('json_schema');
      expect(JSON.parse(seen[1].body).response_format).toEqual({ type: 'json_object' });
      expect(await counters(alice.id)).toEqual({ platform: 0, byok: 1 });
      expect(printed()).not.toContain(cred.key);
    });

    it('a 400 that persists after the retry is a 502 (no third try) and the unit comes back', async () => {
      const alice = await createUser();
      const cred = await makeCredential(alice);
      expectedKey = cred.key;
      fake.setHandler(failing(400));
      const projectId = await makeProject(alice);

      const res = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });
      expect(res.status).toBe(502);
      expect(chatRequests()).toHaveLength(2);
      expect(await counters(alice.id)).toEqual({ platform: 0, byok: 0 });
      expect(res.text).not.toContain(cred.key);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(i) the feature is off', () => {
    it('BYOK_ENABLED=false: credentialId is a 404 BYOK_DISABLED, nothing is sent or counted; the platform AI still works without it', async () => {
      const alice = await createUser();
      const cred = await makeCredential(alice);
      expectedKey = cred.key;
      const projectId = await makeProject(alice);
      process.env.BYOK_ENABLED = 'false';

      for (const route of ['generate-mock-api-spec', 'generate-and-save'] as const) {
        const res = await generate(route, alice, {
          projectId,
          requirement: 'x',
          credentialId: cred.id,
        });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe(ErrorCode.BYOK_DISABLED);
      }
      expect(fake.seen).toHaveLength(0);
      expect(getLlmSpy).not.toHaveBeenCalled();
      expect(await counters(alice.id)).toEqual({ platform: 0, byok: 0 });

      getLlmSpy.mockReturnValue({
        name: 'platform',
        complete: async () => ({ text: SPEC, provider: 'platform', model: 'm' }),
      });
      const platform = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'x',
      });
      expect(platform.status).toBe(200);
    });

    it('unset BYOK_ENABLED is off too', async () => {
      const alice = await createUser();
      const cred = await makeCredential(alice);
      const projectId = await makeProject(alice);
      delete process.env.BYOK_ENABLED;
      const res = await generate('generate-mock-api-spec', alice, {
        projectId,
        requirement: 'x',
        credentialId: cred.id,
      });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCode.BYOK_DISABLED);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(j) shared projects (decision D8): your own credential only', () => {
    it('an editor generates with THEIR credential, and gets a 404 with the owner’s', async () => {
      const owner = await createUser();
      const editor = await createUser();
      const viewer = await createUser();
      const ownerCred = await makeCredential(owner);
      const editorCred = await makeCredential(editor);
      const viewerCred = await makeCredential(viewer);
      const projectId = await makeProject(owner, [
        { actor: editor, role: 'editor' },
        { actor: viewer, role: 'viewer' },
      ]);

      expectedKey = editorCred.key;
      const mine = await generate('generate-and-save', editor, {
        projectId,
        requirement: 'x',
        credentialId: editorCred.id,
      });
      expect(mine.status).toBe(200);
      expect(chatRequests()).toHaveLength(1);
      expect(chatRequests()[0].headers.authorization).toBe(`Bearer ${editorCred.key}`);
      expect(await counters(editor.id)).toEqual({ platform: 0, byok: 1 });
      expect(await counters(owner.id)).toEqual({ platform: 0, byok: 0 });

      fake.seen.length = 0;
      for (const route of ['generate-mock-api-spec', 'generate-and-save'] as const) {
        const theirs = await generate(route, editor, {
          projectId,
          requirement: 'x',
          credentialId: ownerCred.id,
        });
        expect(theirs.status).toBe(404);
        expect(theirs.body.error.code).toBe(ErrorCode.AI_CREDENTIAL_NOT_FOUND);
      }
      expect(fake.seen).toHaveLength(0);
      expect(await counters(owner.id)).toEqual({ platform: 0, byok: 0 });

      // the project roles still apply: a viewer may read-generate with their own key, but never save into the project
      expectedKey = viewerCred.key;
      const viewerSpec = await generate('generate-mock-api-spec', viewer, {
        projectId,
        requirement: 'x',
        credentialId: viewerCred.id,
      });
      expect(viewerSpec.status).toBe(200);
      fake.seen.length = 0;
      const viewerSave = await generate('generate-and-save', viewer, {
        projectId,
        requirement: 'x',
        credentialId: viewerCred.id,
      });
      expect(viewerSave.status).toBe(403);
      expect(fake.seen).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('the stored key cannot be opened', () => {
    it('a sealed key moved to another user’s credential (AAD mismatch) is a 409 and the provider is never called', async () => {
      const alice = await createUser();
      const bob = await createUser();
      const aliceCred = await makeCredential(alice);
      const bobCred = await makeCredential(bob);
      const aliceDoc = await AiCredentialModel.findById(aliceCred.id).lean();
      await AiCredentialModel.updateOne(
        { _id: bobCred.id },
        { $set: { sealed: aliceDoc!.sealed } }
      );
      const projectId = await makeProject(bob);

      const res = await generate('generate-mock-api-spec', bob, {
        projectId,
        requirement: 'x',
        credentialId: bobCred.id,
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCode.AI_CREDENTIAL_UNREADABLE);
      expect(fake.seen).toHaveLength(0);
      expect(await counters(bob.id)).toEqual({ platform: 0, byok: 0 });
      expect(res.text).not.toContain(aliceCred.key);
    });

    it('a server without a valid keyring answers 503 and sends nothing', async () => {
      const alice = await createUser();
      const cred = await makeCredential(alice);
      const projectId = await makeProject(alice);
      const saved = process.env.BYOK_KEYS;
      process.env.BYOK_KEYS = '';
      try {
        const res = await generate('generate-mock-api-spec', alice, {
          projectId,
          requirement: 'x',
          credentialId: cred.id,
        });
        expect(res.status).toBe(503);
        expect(fake.seen).toHaveLength(0);
        expect(await counters(alice.id)).toEqual({ platform: 0, byok: 0 });
      } finally {
        process.env.BYOK_KEYS = saved;
      }
    });
  });
});
