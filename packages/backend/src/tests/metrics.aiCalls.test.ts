import crypto from 'crypto';
import http from 'http';
import { inspect } from 'util';
import type { AddressInfo } from 'net';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { ErrorCode } from '@mockia/shared';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { UsageModel } from '../models/Usage.js';
import { AiRateWindowModel } from '../models/AiRateWindow.js';
import { AiGenerationModel } from '../models/AiGeneration.js';
import { DemoMockModel } from '../models/DemoMock.js';
import { DemoBudgetModel } from '../models/DemoBudget.js';
import { DemoSpentChallengeModel } from '../models/DemoSpentChallenge.js';
import { AiCallModel } from '../models/AiCall.js';
import { AppError } from '../middlewares/errorHandler.js';
import { openRouterConfig } from '../config/ai.js';
import { resetDemoFlood } from '../modules/demo/mockRouter.js';
import { resetDemoApiLimits } from '../modules/demo/routes.js';
import { resetLlm, type ProviderOutcome } from '../modules/ai/providers/index.js';
import { LlmResponseError } from '../modules/ai/providers/types.js';
import { invalidatePlanCache } from '../modules/billing/plans.js';
import {
  drainAiCalls,
  outcomeFromProviderResult,
  recordAiCall,
} from '../modules/metrics/aiCalls.js';

/**
 * Task O1: one content-free event per AI call (AiCall) for the owner's metrics and alerts. Real Mongo, the real Express
 * app and a fake HTTP server standing in for the language model, as in billing.aiQuota and demo.generate.
 */

const PASSWORD = 'ai-calls-test-password-1';
const DEMO_SECRET = 'demo-test-secret-with-more-than-32-chars!!';
const REQUIREMENT_SENTINEL = 'ZXQ-REQUIREMENT-SENTINEL-4410';
const REPLY_SENTINEL = 'ZXQ-REPLY-SENTINEL-8812';
const DAY_SECONDS = 24 * 60 * 60;

const specWith = (description: string) =>
  JSON.stringify({
    apiVersion: '1.0.0',
    title: 'Gym API',
    description,
    endpoints: [
      {
        path: '/members',
        method: 'GET',
        description: 'List members',
        examples: [{ request: {}, response: { id: 1 } }],
      },
      {
        path: '/members/{id}',
        method: 'GET',
        description: 'One member',
        examples: [{ request: {}, response: { id: 1 } }],
      },
      {
        path: '/members',
        method: 'POST',
        description: 'Create a member',
        examples: [{ request: {}, response: { id: 2 }, statusCode: 201 }],
      },
    ],
    dataModels: [],
  });
const SPEC = specWith(REPLY_SENTINEL);

const completion = (content: string, finish = 'stop') => ({
  id: 'cmpl-1',
  object: 'chat.completion',
  model: 'served-model',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish }],
  usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
});

type Handler = (res: http.ServerResponse) => void;
const answer =
  (content: string, finish = 'stop'): Handler =>
  (res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(completion(content, finish)));
  };

interface FakeServer {
  url: string;
  hits: number;
  setHandler(h: Handler): void;
  close(): Promise<void>;
}

async function startFake(initial: Handler): Promise<FakeServer> {
  let handler = initial;
  const sockets = new Set<import('net').Socket>();
  const fake = { hits: 0 } as FakeServer;
  const server = http.createServer((req, res) => {
    req.on('data', () => undefined);
    req.on('end', () => {
      fake.hits += 1;
      handler(res);
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.setHandler = (h) => (handler = h);
  fake.close = () =>
    new Promise<void>((r) => {
      sockets.forEach((s) => s.destroy());
      server.close(() => r());
    });
  return fake;
}

async function createUser(email: string, extra: Record<string, unknown> = {}) {
  const user = await UserModel.create({
    email,
    username: email.split('@')[0],
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    emailVerifiedAt: new Date(),
    ...extra,
  });
  const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return {
    id: user._id as Types.ObjectId,
    idStr: String(user._id),
    auth: { Authorization: `Bearer ${login.body.data.tokens.accessToken as string}` },
  };
}

const projectOf = (ownerId: Types.ObjectId, slug: string) =>
  ProjectModel.create({
    title: slug,
    slug,
    ownerId,
    members: [{ userId: ownerId, role: 'owner' }],
  });

/* --------------------------------------------------------------------------------------------- demo proof of work */

const zerosOf = (challenge: string, nonce: string): number => {
  const digest = crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest();
  let zeros = 0;
  for (const byte of digest) {
    if (byte === 0) {
      zeros += 8;
      continue;
    }
    return zeros + Math.clz32(byte) - 24;
  }
  return zeros;
};

async function demoGenerate(ip: string) {
  const res = await request(app).post('/api/demo/challenge').set('X-Forwarded-For', ip).send({});
  const challenge = res.body.data.challenge as string;
  const bits = (
    JSON.parse(Buffer.from(challenge.split('.')[0], 'base64url').toString('utf8')) as {
      bits: number;
    }
  ).bits;
  let nonce = '';
  for (let i = 0; ; i++) {
    nonce = i.toString(36);
    if (zerosOf(challenge, nonce) >= bits) break;
  }
  return request(app)
    .post('/api/demo/generate')
    .set('X-Forwarded-For', ip)
    .send({ challenge, nonce, source: { type: 'template', id: 'shop' } });
}

/* ------------------------------------------------------------------------------------------------------- helpers */

/** The events written so far (after waiting for the writes that were fired without being awaited). */
async function calls() {
  await drainAiCalls();
  return AiCallModel.find({}).lean();
}

const ENV_KEYS = [
  'AI_PROVIDERS',
  'AI_DEMO_PROVIDERS',
  'AI_DEMO_TIMEOUT_MS',
  'AI_LOCAL_BASE_URL',
  'AI_LOCAL_MODEL',
  'AI_LOCAL_API_KEY',
  'AI_LOCAL_TIMEOUT_MS',
  'AI_TOTAL_TIMEOUT_MS',
  'DEMO_ENABLED',
  'DEMO_HMAC_SECRET',
  'DEMO_POW_BITS',
] as const;

describe('metrics: eventos AiCall de las llamadas a la IA', () => {
  const saved: Record<string, string | undefined> = {};
  const savedOr = { ...openRouterConfig };
  const trustProxyBefore = app.get('trust proxy');
  let fake: FakeServer;
  let consoleCalls: string[] = [];
  let spies: jest.SpyInstance[] = [];
  let ipCounter = 0;
  const newIp = (): string => `10.77.${Math.floor(++ipCounter / 250) % 250}.${ipCounter % 250}`;

  beforeAll(async () => {
    await connectDB();
    await Promise.all([UsageModel.init(), AiRateWindowModel.init(), AiCallModel.init()]);
    await Promise.all([
      DemoMockModel.init(),
      DemoBudgetModel.init(),
      DemoSpentChallengeModel.init(),
    ]);
    app.set('trust proxy', 1);
  });

  afterAll(async () => {
    app.set('trust proxy', trustProxyBefore);
    await drainAiCalls();
    await AiCallModel.deleteMany({});
    await disconnectDB();
  });

  beforeEach(async () => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    fake = await startFake(answer(SPEC));
    process.env.AI_PROVIDERS = 'local';
    process.env.AI_LOCAL_BASE_URL = fake.url;
    process.env.AI_LOCAL_MODEL = 'qwen-test';
    process.env.AI_LOCAL_TIMEOUT_MS = '3000';
    process.env.DEMO_ENABLED = 'true';
    process.env.DEMO_HMAC_SECRET = DEMO_SECRET;
    process.env.DEMO_POW_BITS = '6';
    resetLlm();
    resetDemoFlood();
    resetDemoApiLimits();
    invalidatePlanCache();
    await drainAiCalls();
    await Promise.all([
      UserModel.deleteMany({}),
      ProjectModel.deleteMany({}),
      UsageModel.deleteMany({}),
      AiRateWindowModel.deleteMany({}),
      AiGenerationModel.deleteMany({}),
      AiCallModel.deleteMany({}),
      DemoMockModel.deleteMany({}),
      DemoBudgetModel.deleteMany({}),
      DemoSpentChallengeModel.deleteMany({}),
    ]);
    consoleCalls = [];
    spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        consoleCalls.push(
          args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' ')
        );
      })
    );
  });

  afterEach(async () => {
    spies.forEach((s) => s.mockRestore());
    jest.restoreAllMocks();
    await fake.close();
    Object.assign(openRouterConfig, savedOr);
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetLlm();
  });

  const body = (projectId: string) => ({ projectId, requirement: REQUIREMENT_SENTINEL });

  /* ---------------------------------------------------------------- outcomeFromProviderResult (the mapping) */

  describe('outcomeFromProviderResult', () => {
    const rows: Array<[string, ProviderOutcome | undefined, unknown, string]> = [
      ['sin error: ok', 'answered', undefined, 'ok'],
      [
        'respuesta cortada por max_tokens',
        'answered',
        new LlmResponseError('truncated'),
        'truncated',
      ],
      [
        'texto invalido tras reparar',
        'answered',
        new LlmResponseError('invalid_output'),
        'invalid',
      ],
      ['contenido vacio', 'answered', new LlmResponseError('empty_content'), 'invalid'],
      [
        'el 502 de la cadena conserva el motivo (truncated)',
        'answered',
        Object.assign(new AppError('x', ErrorCode.EXTERNAL_SERVICE_ERROR, 502), {
          llmFailure: 'truncated',
        }),
        'truncated',
      ],
      [
        'el 502 de la cadena conserva el motivo (invalid_output)',
        'answered',
        Object.assign(new AppError('x', ErrorCode.EXTERNAL_SERVICE_ERROR, 502), {
          llmFailure: 'invalid_output',
        }),
        'invalid',
      ],
      ['timeout del proveedor', 'uncertain', new Error('x'), 'timeout'],
      [
        'plazo global de la cadena (504)',
        'refused',
        new AppError('x', ErrorCode.EXTERNAL_SERVICE_ERROR, 504),
        'timeout',
      ],
      ['error HTTP explicito', 'refused', new Error('x'), 'refused'],
      ['nuestro fallo tras una respuesta', 'answered', new Error('db'), 'error'],
      ['fallo sin llegar a llamar a ningun proveedor', undefined, new Error('x'), 'error'],
    ];
    it.each(rows)('%s', (_name, result, err, expected) => {
      expect(outcomeFromProviderResult(result, err)).toBe(expected);
    });
  });

  /* ------------------------------------------------------------------------------------ (a) usuario, camino ok */

  describe('(a) usuarios', () => {
    it.each(['generate-mock-api-spec', 'generate-and-save'])(
      '%s: una generacion correcta de un usuario Starter crea un AiCall ok con tokens y latencia',
      async (route) => {
        const u = await createUser('a@example.com', { plan: 'starter', billingStatus: 'active' });
        const p = await projectOf(u.id, 'a-p');
        const before = Date.now();
        const res = await request(app)
          .post(`/api/ai/${route}`)
          .set(u.auth)
          .send(body(p._id.toString()));
        expect(res.status).toBe(200);

        const docs = await calls();
        expect(docs).toHaveLength(1);
        expect(docs[0]).toMatchObject({
          scope: 'users',
          plan: 'starter',
          provider: 'local',
          model: 'served-model',
          outcome: 'ok',
          inputTokens: 11,
          outputTokens: 7,
        });
        expect(docs[0].latencyMs).toBeGreaterThanOrEqual(0);
        expect(docs[0].latencyMs).toBeLessThan(Date.now() - before + 1);
        expect(docs[0].at.getTime()).toBeGreaterThanOrEqual(before);
      }
    );

    it('un usuario Free se registra como plan free', async () => {
      const u = await createUser('a-free@example.com');
      const p = await projectOf(u.id, 'a-free-p');
      const res = await request(app)
        .post('/api/ai/generate-mock-api-spec')
        .set(u.auth)
        .send(body(p._id.toString()));
      expect(res.status).toBe(200);
      expect((await calls()).map((d) => d.plan)).toEqual(['free']);
    });
  });

  /* ----------------------------------------------------------------------------- (b) truncada / timeout / otros */

  describe('(b) desenlaces que no son ok', () => {
    it('salida truncada (finish_reason length) -> outcome truncated, sin tokens', async () => {
      const u = await createUser('b1@example.com');
      const p = await projectOf(u.id, 'b1-p');
      fake.setHandler(answer('{"apiVersion":"1.0.0","title":"cut off', 'length'));
      const res = await request(app)
        .post('/api/ai/generate-mock-api-spec')
        .set(u.auth)
        .send(body(p._id.toString()));
      expect(res.status).toBe(502);
      const docs = await calls();
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({ scope: 'users', plan: 'free', outcome: 'truncated' });
      expect(docs[0]).not.toHaveProperty('inputTokens');
      expect(docs[0]).not.toHaveProperty('outputTokens');
    });

    it('un servidor que no contesta a tiempo -> outcome timeout', async () => {
      const u = await createUser('b2@example.com');
      const p = await projectOf(u.id, 'b2-p');
      fake.setHandler(() => undefined); // never answers
      process.env.AI_LOCAL_TIMEOUT_MS = '300';
      resetLlm();
      const res = await request(app)
        .post('/api/ai/generate-and-save')
        .set(u.auth)
        .send(body(p._id.toString()));
      expect(res.status).toBeGreaterThanOrEqual(500);
      const docs = await calls();
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({ scope: 'users', outcome: 'timeout', provider: 'local' });
    });

    it('un 500 explicito del proveedor -> outcome refused; texto que no es JSON dos veces -> invalid', async () => {
      const u = await createUser('b3@example.com');
      const p = await projectOf(u.id, 'b3-p');
      fake.setHandler((res) => {
        res.statusCode = 500;
        res.end('{}');
      });
      const refused = await request(app)
        .post('/api/ai/generate-mock-api-spec')
        .set(u.auth)
        .send(body(p._id.toString()));
      expect(refused.status).toBeGreaterThanOrEqual(500);

      fake.setHandler(answer('this is not json at all'));
      const invalid = await request(app)
        .post('/api/ai/generate-mock-api-spec')
        .set(u.auth)
        .send(body(p._id.toString()));
      expect(invalid.status).toBe(502);

      const docs = (await calls()).sort((x, y) => x.at.getTime() - y.at.getTime());
      expect(docs.map((d) => d.outcome)).toEqual(['refused', 'invalid']);
    });

    it('una generacion rechazada por cuota agotada no llama a la IA y no genera evento', async () => {
      const u = await createUser('b4@example.com');
      const p = await projectOf(u.id, 'b4-p');
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/ai/generate-mock-api-spec')
          .set(u.auth)
          .send(body(p._id.toString()));
      }
      expect(await calls()).toHaveLength(5);
      const sixth = await request(app)
        .post('/api/ai/generate-mock-api-spec')
        .set(u.auth)
        .send(body(p._id.toString()));
      expect(sixth.status).toBe(429);
      expect(await calls()).toHaveLength(5);
    });
  });

  /* ------------------------------------------------------------------------------------------------ (c) demo */

  describe('(c) demo', () => {
    it('una generacion de la demo -> scope demo, plan anonymous', async () => {
      const res = await demoGenerate(newIp());
      expect(res.status).toBe(201);
      const docs = await calls();
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        scope: 'demo',
        plan: 'anonymous',
        provider: 'local',
        outcome: 'ok',
        inputTokens: 11,
        outputTokens: 7,
      });
    });

    it('una respuesta cortada en la demo tambien se anota (truncated) y la visita sigue viendo el error de siempre', async () => {
      fake.setHandler(answer('{"apiVersion":"1.0.0","title":"cut', 'length'));
      const res = await demoGenerate(newIp());
      expect(res.status).toBe(502);
      const docs = await calls();
      expect(docs.map((d) => [d.scope, d.plan, d.outcome])).toEqual([
        ['demo', 'anonymous', 'truncated'],
      ]);
    });
  });

  /* ----------------------------------------------------------------------- (d) nada personal ni de contenido */

  describe('(d) el documento no lleva datos personales', () => {
    it('claves exactas del documento y ningun rastro del usuario, la IP, el prompt ni la salida', async () => {
      const u = await createUser('d@example.com', { plan: 'pro', billingStatus: 'active' });
      const p = await projectOf(u.id, 'd-p');
      const ip = newIp();
      expect(
        (
          await request(app)
            .post('/api/ai/generate-mock-api-spec')
            .set(u.auth)
            .set('X-Forwarded-For', ip)
            .send(body(p._id.toString()))
        ).status
      ).toBe(200);
      expect((await demoGenerate(ip)).status).toBe(201);

      const docs = await calls();
      expect(docs).toHaveLength(2);
      for (const doc of docs) {
        expect(Object.keys(doc).sort()).toEqual(
          [
            '_id',
            'at',
            'inputTokens',
            'latencyMs',
            'model',
            'outcome',
            'outputTokens',
            'plan',
            'provider',
            'scope',
          ].sort()
        );
        const json = JSON.stringify(doc);
        expect(json).not.toContain(u.idStr);
        expect(json).not.toContain(ip);
        expect(json).not.toContain('d@example.com');
        expect(json).not.toContain(REQUIREMENT_SENTINEL);
        expect(json).not.toContain(REPLY_SENTINEL);
        expect(json).not.toContain(p._id.toString());
      }
    });

    it('el esquema rechaza campos que no conoce (no se cuela un userId ni una IP)', async () => {
      await recordAiCall({
        scope: 'users',
        plan: 'free',
        provider: 'local',
        model: 'm',
        outcome: 'ok',
        latencyMs: 5,
        ...({ userId: 'u1', ip: '1.2.3.4', prompt: 'secret' } as object),
      });
      const docs = await AiCallModel.find({}).lean();
      expect(docs).toHaveLength(1);
      expect(Object.keys(docs[0]).sort()).toEqual(
        ['_id', 'at', 'latencyMs', 'model', 'outcome', 'plan', 'provider', 'scope'].sort()
      );
    });
  });

  /* ----------------------------------------------------------------------- (e) Mongo falla: la respuesta no */

  describe('(e) un fallo al guardar el evento no afecta a la respuesta', () => {
    it('si Mongo falla al guardar, la generacion responde 200 y el error se registra sin contenido', async () => {
      const u = await createUser('e1@example.com');
      const p = await projectOf(u.id, 'e1-p');
      const boom = Object.assign(new Error(`mongo exploded ${REQUIREMENT_SENTINEL}`), {
        name: 'MongoNetworkError',
        code: 'ECONNRESET',
      });
      jest.spyOn(AiCallModel, 'create').mockRejectedValue(boom as never);
      const res = await request(app)
        .post('/api/ai/generate-mock-api-spec')
        .set(u.auth)
        .send(body(p._id.toString()));
      expect(res.status).toBe(200);
      await drainAiCalls();
      const logged = consoleCalls.filter((c) => c.includes('AiCall'));
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain('MongoNetworkError');
      expect(logged[0]).not.toContain(REQUIREMENT_SENTINEL); // describeError: the message is never logged
    });

    it('recordAiCall nunca lanza, ni siquiera si el modelo lanza de forma sincrona', async () => {
      jest.spyOn(AiCallModel, 'create').mockImplementation((() => {
        throw new Error('sync boom');
      }) as never);
      await expect(
        recordAiCall({
          scope: 'demo',
          plan: 'anonymous',
          provider: 'local',
          model: 'm',
          outcome: 'ok',
          latencyMs: 1,
        })
      ).resolves.toBeUndefined();
    });

    it('si guardar el evento tarda una eternidad, la respuesta no espera', async () => {
      const u = await createUser('e2@example.com');
      const p = await projectOf(u.id, 'e2-p');
      let finishWrite: () => void = () => undefined;
      jest
        .spyOn(AiCallModel, 'create')
        .mockReturnValue(new Promise<void>((resolve) => (finishWrite = resolve)) as never);
      const res = await request(app)
        .post('/api/ai/generate-mock-api-spec')
        .set(u.auth)
        .send(body(p._id.toString()));
      expect(res.status).toBe(200);
      finishWrite(); // let the write end so the suite does not leave it hanging
    });

    it('la demo tambien responde igual cuando el evento no se puede guardar', async () => {
      jest.spyOn(AiCallModel, 'create').mockRejectedValue(new Error('down') as never);
      const res = await demoGenerate(newIp());
      expect(res.status).toBe(201);
    });
  });

  /* ------------------------------------------------------------------------------------------ (f) TTL de 90 dias */

  describe('(f) retencion', () => {
    it('hay un indice TTL sobre `at` de 90 dias', async () => {
      await AiCallModel.init();
      const indexes = await AiCallModel.collection.indexes();
      const ttl = indexes.find((i) => i.key && Object.keys(i.key).join() === 'at');
      expect(ttl).toBeDefined();
      expect(ttl?.expireAfterSeconds).toBe(90 * DAY_SECONDS);
    });

    it('`at` lo pone el servidor (el evento no puede traer una fecha propia) y admite un reloj inyectado', async () => {
      const now = new Date('2026-10-12T10:00:00Z');
      await recordAiCall(
        {
          scope: 'users',
          plan: 'team',
          provider: 'local',
          model: 'm',
          outcome: 'ok',
          latencyMs: 1,
        },
        now
      );
      const [doc] = await AiCallModel.find({}).lean();
      expect(doc.at.toISOString()).toBe(now.toISOString());
    });
  });
});
