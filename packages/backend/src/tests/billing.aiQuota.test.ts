import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { ErrorCode, PLAN_LIMITS } from '@mockia/shared';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { UsageModel } from '../models/Usage.js';
import { AiRateWindowModel } from '../models/AiRateWindow.js';
import { openRouterConfig } from '../config/ai.js';
import { resetLlm } from '../modules/ai/providers/index.js';
import { invalidatePlanCache } from '../modules/billing/plans.js';
import { nextPeriodStart, periodOf } from '../modules/billing/usage.js';
import { reserveAiGeneration } from '../modules/billing/aiQuota.js';

/**
 * Monthly AI generation quota per plan (Task A2). Real Mongo, injectable clock, and a fake HTTP server standing in for
 * the local model so the whole route (middlewares, limiter, quota, LLM chain, validation, repair) is exercised.
 */

const PASSWORD = 'ai-quota-test-password-1';
const DAY = 24 * 60 * 60 * 1000;
const SPEC = JSON.stringify({
  apiVersion: '1.0.0',
  title: 'Gym API',
  description: 'd',
  endpoints: [{ path: '/members', method: 'GET', description: 'List members', examples: [{ request: {}, response: { id: 1 } }] }],
  dataModels: [],
});

interface FakeServer {
  url: string;
  hits: number;
  setHandler(h: (res: http.ServerResponse) => void): void;
  close(): Promise<void>;
}

const completion = (content: string) => ({
  id: 'cmpl-1',
  object: 'chat.completion',
  model: 'served-model',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
});

const answer = (content: string) => (res: http.ServerResponse) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(completion(content)));
};

/** A reply cut by max_tokens: a complete HTTP answer, but an unusable (and billed) document. */
const truncated = () => (res: http.ServerResponse) => {
  const body = completion('{"apiVersion":"1.0.0","title":"cut off');
  body.choices[0].finish_reason = 'length';
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

async function startFake(initial: (res: http.ServerResponse) => void): Promise<FakeServer> {
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

const projectOf = (ownerId: Types.ObjectId, slug: string, extra: Record<string, unknown> = {}) =>
  ProjectModel.create({ title: slug, slug, ownerId, members: [{ userId: ownerId, role: 'owner' }], ...extra });

/** AI generations counted this month for the user, straight from Mongo. */
async function usedNow(userId: string, now = new Date()): Promise<number> {
  const doc = await UsageModel.findOne({ ownerId: userId, period: periodOf(now) }).lean();
  return doc?.aiGenerations ?? 0;
}

describe('cuota mensual de generaciones de IA', () => {
  const savedEnv = { ...process.env };
  const savedOr = { ...openRouterConfig };
  let fake: FakeServer;
  let log: jest.SpyInstance;
  let errorLog: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    await connectDB();
    await UsageModel.init();
    await AiRateWindowModel.init();
  });

  beforeEach(async () => {
    process.env = { ...savedEnv };
    delete process.env.AI_LOCAL_API_KEY;
    await Promise.all([UserModel.deleteMany({}), ProjectModel.deleteMany({}), UsageModel.deleteMany({}), AiRateWindowModel.deleteMany({})]);
    invalidatePlanCache();
    fake = await startFake(answer(SPEC));
    process.env.AI_PROVIDERS = 'local';
    process.env.AI_LOCAL_BASE_URL = fake.url;
    process.env.AI_LOCAL_MODEL = 'qwen-test';
    process.env.AI_LOCAL_TIMEOUT_MS = '2000';
    resetLlm();
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    log.mockRestore();
    errorLog.mockRestore();
    warn.mockRestore();
    await fake.close();
    Object.assign(openRouterConfig, savedOr);
    process.env = savedEnv;
    resetLlm();
  });

  afterAll(async () => {
    await Promise.all([UserModel.deleteMany({}), ProjectModel.deleteMany({}), UsageModel.deleteMany({}), AiRateWindowModel.deleteMany({})]);
    await disconnectDB();
  });

  describe('reserveAiGeneration (Mongo, reloj inyectable)', () => {
    const NOW = new Date('2026-10-09T10:00:00Z');

    it('(a) Free: tras 5 reservas la 6.a se rechaza con used/limit y resetsAt = 1 del mes siguiente 00:00 UTC', async () => {
      const u = await createUser('a@example.com');
      for (let i = 0; i < 5; i++) expect((await reserveAiGeneration(u.idStr, NOW)).ok).toBe(true);
      const sixth = await reserveAiGeneration(u.idStr, NOW);
      expect(sixth.ok).toBe(false);
      if (sixth.ok) throw new Error('unreachable');
      expect(sixth.used).toBe(5);
      expect(sixth.limit).toBe(5);
      expect(sixth.resetsAt.toISOString()).toBe('2026-11-01T00:00:00.000Z');
      expect(await usedNow(u.idStr, NOW)).toBe(5); // a rejection does not count
      expect((await reserveAiGeneration(u.idStr, NOW)).ok).toBe(false);
      expect(await usedNow(u.idStr, NOW)).toBe(5);
    });

    it('(a) el reinicio es el 1 de enero 00:00 UTC si estamos en diciembre', async () => {
      const u = await createUser('a2@example.com');
      const dec = new Date('2026-12-31T23:59:59Z');
      for (let i = 0; i < 5; i++) await reserveAiGeneration(u.idStr, dec);
      const r = await reserveAiGeneration(u.idStr, dec);
      if (r.ok) throw new Error('should be rejected');
      expect(r.resetsAt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    });

    it('(b) 20 reservas simultaneas con tope 5: exactamente 5 ok y el contador queda en 5', async () => {
      const u = await createUser('b@example.com');
      const results = await Promise.all(Array.from({ length: 20 }, () => reserveAiGeneration(u.idStr, NOW)));
      expect(results.filter((r) => r.ok)).toHaveLength(5);
      expect(results.filter((r) => !r.ok)).toHaveLength(15);
      expect(await usedNow(u.idStr, NOW)).toBe(5);
      for (const r of results) if (!r.ok) expect(r.used).toBe(5);
    });

    it('(b) la carrera tambien se gana en la primera reserva del mes (el documento aun no existe)', async () => {
      for (let round = 0; round < 5; round++) {
        const u = await createUser(`b-race-${round}@example.com`);
        const results = await Promise.all(Array.from({ length: 12 }, () => reserveAiGeneration(u.idStr, NOW)));
        expect(results.filter((r) => r.ok)).toHaveLength(5);
        expect(await usedNow(u.idStr, NOW)).toBe(5);
      }
    });

    it('(c) release() devuelve la reserva y permite una nueva; llamarlo dos veces no devuelve dos', async () => {
      const u = await createUser('c@example.com');
      const held = [] as Array<() => Promise<void>>;
      for (let i = 0; i < 5; i++) {
        const r = await reserveAiGeneration(u.idStr, NOW);
        if (!r.ok) throw new Error('should be ok');
        held.push(r.release);
      }
      expect((await reserveAiGeneration(u.idStr, NOW)).ok).toBe(false);
      await held[0]();
      await held[0](); // idempotent
      expect(await usedNow(u.idStr, NOW)).toBe(4);
      const again = await reserveAiGeneration(u.idStr, NOW);
      expect(again.ok).toBe(true);
      expect((await reserveAiGeneration(u.idStr, NOW)).ok).toBe(false);
      expect(await usedNow(u.idStr, NOW)).toBe(5);
    });

    it('(c) release() nunca baja de cero ni toca el mes siguiente', async () => {
      const u = await createUser('c2@example.com');
      const r = await reserveAiGeneration(u.idStr, NOW);
      if (!r.ok) throw new Error('should be ok');
      await UsageModel.updateOne({ ownerId: u.id, period: periodOf(NOW) }, { $set: { aiGenerations: 0 } });
      await r.release();
      expect(await usedNow(u.idStr, NOW)).toBe(0);
    });

    it('(d) cambio de mes UTC: el contador empieza de cero', async () => {
      const u = await createUser('d@example.com');
      const lastSecond = new Date('2026-10-31T23:59:59.999Z');
      for (let i = 0; i < 5; i++) await reserveAiGeneration(u.idStr, lastSecond);
      expect((await reserveAiGeneration(u.idStr, lastSecond)).ok).toBe(false);
      const firstSecond = new Date('2026-11-01T00:00:00.000Z');
      expect(nextPeriodStart(lastSecond).getTime()).toBe(firstSecond.getTime());
      for (let i = 0; i < 5; i++) expect((await reserveAiGeneration(u.idStr, firstSecond)).ok).toBe(true);
      expect((await reserveAiGeneration(u.idStr, firstSecond)).ok).toBe(false);
      expect(await usedNow(u.idStr, lastSecond)).toBe(5);
      expect(await usedNow(u.idStr, firstSecond)).toBe(5);
    });

    it('(e) el tope sale del plan: Free 5, Starter 40, Pro 300, Team 1500', async () => {
      const expected = { free: 5, starter: 40, pro: 300, team: 1500 } as const;
      expect(PLAN_LIMITS.starter.maxMonthlyAiGenerations).toBe(40);
      for (const [plan, limit] of Object.entries(expected)) {
        const u = await createUser(`e-${plan}@example.com`, { plan, billingStatus: 'active' });
        // Seed one below the cap so the test does not need 1500 round trips
        await UsageModel.create({ ownerId: u.id, period: periodOf(NOW), aiGenerations: limit - 1 });
        const last = await reserveAiGeneration(u.idStr, NOW);
        expect(last.ok).toBe(true);
        const over = await reserveAiGeneration(u.idStr, NOW);
        expect(over.ok).toBe(false);
        if (over.ok) throw new Error('unreachable');
        expect(over.limit).toBe(limit);
        expect(over.used).toBe(limit);
      }
    });

    it('(f) subir de Starter a Pro a mitad de mes: tras invalidatePlanCache el tope nuevo aplica de inmediato', async () => {
      const u = await createUser('f@example.com', { plan: 'starter', billingStatus: 'active' });
      await UsageModel.create({ ownerId: u.id, period: periodOf(NOW), aiGenerations: 40 });
      const blocked = await reserveAiGeneration(u.idStr, NOW);
      expect(blocked.ok).toBe(false);
      if (blocked.ok) throw new Error('unreachable');
      expect(blocked.limit).toBe(40);

      await UserModel.updateOne({ _id: u.id }, { $set: { plan: 'pro' } }); // what the webhook does
      invalidatePlanCache(u.idStr);
      const upgraded = await reserveAiGeneration(u.idStr, NOW);
      expect(upgraded.ok).toBe(true);
      expect(await usedNow(u.idStr, NOW)).toBe(41); // the 40 already spent are kept: they count against the new cap
    });

    it('(f) sin invalidar la cache el tope nuevo aplica en <= 30 s', async () => {
      const u = await createUser('f2@example.com', { plan: 'starter', billingStatus: 'active' });
      await UsageModel.create({ ownerId: u.id, period: periodOf(NOW), aiGenerations: 40 });
      const realNow = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(realNow);
      expect((await reserveAiGeneration(u.idStr, NOW)).ok).toBe(false); // fills the 30 s plan cache with 'starter'

      await UserModel.updateOne({ _id: u.id }, { $set: { plan: 'pro' } });
      clock.mockReturnValue(realNow + 29_000);
      expect((await reserveAiGeneration(u.idStr, NOW)).ok).toBe(false); // still cached
      clock.mockReturnValue(realNow + 30_001);
      expect((await reserveAiGeneration(u.idStr, NOW)).ok).toBe(true);
    });

    it('(h) past_due dentro de la gracia conserva el tope del plan de pago; pasada la gracia, el de Free', async () => {
      const inGrace = await createUser('h1@example.com', {
        plan: 'pro',
        billingStatus: 'past_due',
        pastDueSince: new Date(Date.now() - 2 * DAY),
      });
      const afterGrace = await createUser('h2@example.com', {
        plan: 'pro',
        billingStatus: 'past_due',
        pastDueSince: new Date(Date.now() - 8 * DAY),
      });
      await UsageModel.create({ ownerId: inGrace.id, period: periodOf(NOW), aiGenerations: 5 });
      await UsageModel.create({ ownerId: afterGrace.id, period: periodOf(NOW), aiGenerations: 5 });

      const kept = await reserveAiGeneration(inGrace.idStr, NOW);
      expect(kept.ok).toBe(true); // 6th generation: the pro cap (300) still applies

      const dropped = await reserveAiGeneration(afterGrace.idStr, NOW);
      expect(dropped.ok).toBe(false);
      if (dropped.ok) throw new Error('unreachable');
      expect(dropped.limit).toBe(5);
    });

    it('(h) cancelar tambien baja a Free de inmediato', async () => {
      const u = await createUser('h3@example.com', { plan: 'pro', billingStatus: 'canceled' });
      await UsageModel.create({ ownerId: u.id, period: periodOf(NOW), aiGenerations: 5 });
      expect((await reserveAiGeneration(u.idStr, NOW)).ok).toBe(false);
    });

    it('una fila de uso anterior sin el campo aiGenerations (solo peticiones) cuenta como 0 y se puede reservar', async () => {
      const u = await createUser('legacy@example.com');
      await UsageModel.collection.insertOne({ ownerId: u.id, period: periodOf(NOW), requests: 12, createdAt: new Date(), updatedAt: new Date() });
      for (let i = 0; i < 5; i++) expect((await reserveAiGeneration(u.idStr, NOW)).ok).toBe(true);
      expect((await reserveAiGeneration(u.idStr, NOW)).ok).toBe(false);
      const doc = await UsageModel.findOne({ ownerId: u.id, period: periodOf(NOW) }).lean();
      expect(doc?.requests).toBe(12); // the request meter is untouched
      expect(doc?.aiGenerations).toBe(5);
    });

    it('un plan sin tope finito no escribe en la base de datos', async () => {
      const u = await createUser('unl@example.com', { plan: 'team', billingStatus: 'active' });
      const saved = PLAN_LIMITS.team.maxMonthlyAiGenerations;
      (PLAN_LIMITS.team as { maxMonthlyAiGenerations: number }).maxMonthlyAiGenerations = Infinity;
      try {
        const r = await reserveAiGeneration(u.idStr, NOW);
        expect(r.ok).toBe(true);
        if (r.ok) await r.release();
        expect(await UsageModel.countDocuments({ ownerId: u.id })).toBe(0);
      } finally {
        (PLAN_LIMITS.team as { maxMonthlyAiGenerations: number }).maxMonthlyAiGenerations = saved;
      }
    });
  });

  describe('(g) por HTTP con un LLM falso', () => {
    const body = (projectId: string) => ({ projectId, requirement: 'members CRUD' });

    it('una generacion correcta consume 1, con generate-mock-api-spec y con generate-and-save (mismo contador)', async () => {
      const u = await createUser('g1@example.com');
      const p = await projectOf(u.id, 'g1-p');
      const spec = await request(app).post('/api/ai/generate-mock-api-spec').set(u.auth).send(body(p._id.toString()));
      expect(spec.status).toBe(200);
      expect(await usedNow(u.idStr)).toBe(1);
      const save = await request(app).post('/api/ai/generate-and-save').set(u.auth).send(body(p._id.toString()));
      expect(save.status).toBe(200);
      expect(await usedNow(u.idStr)).toBe(2);
    });

    it('un LLM que falla con un 500 explicito no consume cuota: no hubo completion que facturar', async () => {
      const u = await createUser('g2@example.com');
      const p = await projectOf(u.id, 'g2-p');
      fake.setHandler((res) => {
        res.statusCode = 500;
        res.end('boom');
      });
      for (const route of ['generate-mock-api-spec', 'generate-and-save']) {
        const res = await request(app).post(`/api/ai/${route}`).set(u.auth).send(body(p._id.toString()));
        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(await usedNow(u.idStr)).toBe(0);
      }
      expect(fake.hits).toBeGreaterThan(0);
    });

    // B3-R3 (cambio deliberado respecto al texto de A2, que devolvia la unidad en cualquier fallo): si el proveedor llego a
    // devolver una completion, aunque su salida no sirva, pudo facturarla; devolver la unidad permitia provocar fallos
    // (salida truncada de 5000 tokens) para gastar IA de pago sin limite mensual.
    it('un JSON invalido tras reparar (la cadena agota el reintento) SI consume cuota: el proveedor contesto dos veces', async () => {
      const u = await createUser('g3@example.com');
      const p = await projectOf(u.id, 'g3-p');
      fake.setHandler(answer('this is not json at all'));
      let expected = 0;
      for (const route of ['generate-mock-api-spec', 'generate-and-save']) {
        const res = await request(app).post(`/api/ai/${route}`).set(u.auth).send(body(p._id.toString()));
        expect(res.status).toBe(502);
        expected += 1;
        expect(await usedNow(u.idStr)).toBe(expected);
      }
    });

    it('una salida cortada por longitud (finish_reason length) es un 502 y la cuota queda gastada', async () => {
      const u = await createUser('g3b@example.com');
      const p = await projectOf(u.id, 'g3b-p');
      fake.setHandler(truncated());
      for (const [i, route] of ['generate-mock-api-spec', 'generate-and-save'].entries()) {
        const res = await request(app).post(`/api/ai/${route}`).set(u.auth).send(body(p._id.toString()));
        expect(res.status).toBe(502);
        expect(await usedNow(u.idStr)).toBe(i + 1);
      }
    });

    it('5 intentos de un usuario Free con salida truncada agotan su cupo y el 6.o da 429 sin llamar al modelo', async () => {
      const u = await createUser('g3c@example.com');
      const p = await projectOf(u.id, 'g3c-p');
      // With OpenRouter (no circuit breaker): the local model's breaker would open after 3 failures and stop calling it
      process.env.AI_PROVIDERS = 'openrouter';
      openRouterConfig.baseUrl = fake.url;
      openRouterConfig.apiKey = 'sk-or-test-key';
      resetLlm();
      fake.setHandler(truncated());
      for (let i = 0; i < 5; i++) {
        const res = await request(app).post('/api/ai/generate-mock-api-spec').set(u.auth).send(body(p._id.toString()));
        expect(res.status).toBe(502);
      }
      const hitsBefore = fake.hits;
      expect(hitsBefore).toBeGreaterThanOrEqual(5);
      const sixth = await request(app).post('/api/ai/generate-mock-api-spec').set(u.auth).send(body(p._id.toString()));
      expect(sixth.status).toBe(429);
      expect(sixth.body.error.code).toBe(ErrorCode.AI_QUOTA_EXCEEDED);
      expect(fake.hits).toBe(hitsBefore);
      expect(await usedNow(u.idStr)).toBe(5);
    });

    it('un servidor que no contesta a tiempo (timeout del proveedor) no devuelve la unidad: pudo facturarse', async () => {
      const u = await createUser('g3d@example.com');
      const p = await projectOf(u.id, 'g3d-p');
      fake.setHandler(() => undefined); // never answers
      process.env.AI_LOCAL_TIMEOUT_MS = '300';
      resetLlm();
      const res = await request(app).post('/api/ai/generate-mock-api-spec').set(u.auth).send(body(p._id.toString()));
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(fake.hits).toBe(1);
      expect(await usedNow(u.idStr)).toBe(1);
    });

    it('una conexion rechazada (nada escucha) devuelve la unidad: no hubo proveedor que facturara', async () => {
      const u = await createUser('g3e@example.com');
      const p = await projectOf(u.id, 'g3e-p');
      await fake.close();
      for (const route of ['generate-mock-api-spec', 'generate-and-save']) {
        const res = await request(app).post(`/api/ai/${route}`).set(u.auth).send(body(p._id.toString()));
        expect(res.status).toBe(503);
        expect(await usedNow(u.idStr)).toBe(0);
      }
      fake = await startFake(answer(SPEC)); // afterEach closes it
    });

    it('un fallo anterior a la llamada al modelo (proyecto inexistente) devuelve la unidad', async () => {
      const u = await createUser('g3f@example.com');
      const res = await request(app).post('/api/ai/generate-mock-api-spec').set(u.auth).send(body(new Types.ObjectId().toString()));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(fake.hits).toBe(0);
      expect(await usedNow(u.idStr)).toBe(0);
    });

    it('un reintento de reparacion dentro de la cadena NO es una segunda generacion', async () => {
      const u = await createUser('g4@example.com');
      const p = await projectOf(u.id, 'g4-p');
      let n = 0;
      fake.setHandler((res) => answer(n++ === 0 ? 'not json' : SPEC)(res));
      const res = await request(app).post('/api/ai/generate-mock-api-spec').set(u.auth).send(body(p._id.toString()));
      expect(res.status).toBe(200);
      expect(fake.hits).toBe(2); // first answer + repair
      expect(await usedNow(u.idStr)).toBe(1);
    });

    it('el deadline global (504) SI consume cuota: la peticion salio y el proveedor pudo facturarla (cambio deliberado, B3-R3)', async () => {
      const u = await createUser('g5@example.com');
      const p = await projectOf(u.id, 'g5-p');
      fake.setHandler(() => undefined); // never answers
      process.env.AI_LOCAL_TIMEOUT_MS = '5000';
      process.env.AI_TOTAL_TIMEOUT_MS = '250';
      resetLlm();
      const res = await request(app).post('/api/ai/generate-mock-api-spec').set(u.auth).send(body(p._id.toString()));
      expect(res.status).toBe(504);
      expect(await usedNow(u.idStr)).toBe(1);
    });

    it('sin cuota: 429 AI_QUOTA_EXCEEDED con used/limit/resetsAt y Retry-After, y el LLM falso NO se llama', async () => {
      const u = await createUser('g6@example.com');
      const p = await projectOf(u.id, 'g6-p');
      await UsageModel.create({ ownerId: u.id, period: periodOf(new Date()), aiGenerations: 5 });
      for (const route of ['generate-mock-api-spec', 'generate-and-save']) {
        const before = Date.now();
        const res = await request(app).post(`/api/ai/${route}`).set(u.auth).send(body(p._id.toString()));
        expect(res.status).toBe(429);
        expect(ErrorCode.AI_QUOTA_EXCEEDED).toBe('AI_QUOTA_EXCEEDED');
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatchObject({ code: 'AI_QUOTA_EXCEEDED', used: 5, limit: 5 });
        const resetsAt = nextPeriodStart(new Date());
        expect(res.body.error.resetsAt).toBe(resetsAt.toISOString());
        const retryAfter = Number(res.headers['retry-after']);
        expect(retryAfter).toBeGreaterThan(0);
        expect(Math.abs(retryAfter - Math.ceil((resetsAt.getTime() - before) / 1000))).toBeLessThanOrEqual(5);
      }
      expect(fake.hits).toBe(0);
      expect(await usedNow(u.idStr)).toBe(5);
    });

    it('el orden es auth -> email verificado -> rol -> limitador por minuto -> cuota: lo rechazado antes no gasta cuota', async () => {
      const owner = await createUser('g7-owner@example.com');
      const stranger = await createUser('g7-stranger@example.com');
      const p = await projectOf(owner.id, 'g7-p');
      // not a member -> 403 and nothing reserved
      const forbidden = await request(app).post('/api/ai/generate-and-save').set(stranger.auth).send(body(p._id.toString()));
      expect(forbidden.status).toBe(403);
      expect(await usedNow(stranger.idStr)).toBe(0);
      // a viewer cannot save -> 403 and nothing reserved
      const viewer = await createUser('g7-viewer@example.com');
      await ProjectModel.updateOne({ _id: p._id }, { $push: { members: { userId: viewer.id, role: 'viewer' } } });
      const viewerSave = await request(app).post('/api/ai/generate-and-save').set(viewer.auth).send(body(p._id.toString()));
      expect(viewerSave.status).toBe(403);
      expect(await usedNow(viewer.idStr)).toBe(0);
      // unauthenticated -> 401
      expect((await request(app).post('/api/ai/generate-and-save').send(body(p._id.toString()))).status).toBe(401);
      // per-minute limiter answers 429 RATE_LIMIT_ERROR before the monthly quota is touched
      process.env.AI_RATE_PER_MINUTE = '1';
      await UsageModel.create({ ownerId: owner.id, period: periodOf(new Date()), aiGenerations: 2 });
      expect((await request(app).post('/api/ai/generate-and-save').set(owner.auth).send(body(p._id.toString()))).status).toBe(200);
      const limited = await request(app).post('/api/ai/generate-and-save').set(owner.auth).send(body(p._id.toString()));
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe(ErrorCode.RATE_LIMIT_ERROR);
      expect(await usedNow(owner.idStr)).toBe(3);
    });

    it('5 peticiones simultaneas con 3 generaciones restantes: 3 generan y 2 reciben 429 sin llamar al LLM', async () => {
      const u = await createUser('g8@example.com');
      const p = await projectOf(u.id, 'g8-p');
      await UsageModel.create({ ownerId: u.id, period: periodOf(new Date()), aiGenerations: 2 });
      const results = await Promise.all(
        Array.from({ length: 5 }, () => request(app).post('/api/ai/generate-mock-api-spec').set(u.auth).send(body(p._id.toString())))
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(3);
      expect(results.filter((r) => r.status === 429)).toHaveLength(2);
      expect(fake.hits).toBe(3);
      expect(await usedNow(u.idStr)).toBe(5);
    });
  });

  describe('(i) bajar de plan conserva los proyectos y solo bloquea crear', () => {
    it('un Starter con 20 proyectos (venia de Pro) conserva los 20 y POST /projects devuelve el error de limite existente', async () => {
      const u = await createUser('i@example.com', { plan: 'pro', billingStatus: 'active' });
      for (let i = 0; i < 20; i++) await projectOf(u.id, `i-p${i}`);
      await UserModel.updateOne({ _id: u.id }, { $set: { plan: 'starter' } }); // downgrade Pro -> Starter
      invalidatePlanCache(u.idStr);

      const created = await request(app).post('/api/projects').set(u.auth).send({ title: 'Nuevo proyecto' });
      expect(created.status).toBe(402);
      expect(created.body.error.code).toBe('PLAN_LIMIT_REACHED');
      expect(created.body.error.details).toMatchObject({ plan: 'starter', limit: 15, active: 20 });
      expect(await ProjectModel.countDocuments({ ownerId: u.id })).toBe(20);
    });

    it('un Starter que cancela con 15 proyectos conserva los 15 y no puede crear hasta bajar de 5', async () => {
      const u = await createUser('i2@example.com', { plan: 'starter', billingStatus: 'active' });
      const created: Types.ObjectId[] = [];
      for (let i = 0; i < 15; i++) created.push((await projectOf(u.id, `i2-p${i}`))._id as Types.ObjectId);
      await UserModel.updateOne({ _id: u.id }, { $set: { billingStatus: 'canceled', plan: 'free' } });
      invalidatePlanCache(u.idStr);

      const blocked = await request(app).post('/api/projects').set(u.auth).send({ title: 'Otro' });
      expect(blocked.status).toBe(402);
      expect(blocked.body.error.details).toMatchObject({ plan: 'free', limit: 5, active: 15 });
      expect(await ProjectModel.countDocuments({ ownerId: u.id })).toBe(15);

      // archive down to 4 active: creating works again (the archived ones are kept)
      await ProjectModel.updateMany({ _id: { $in: created.slice(4) } }, { $set: { isArchived: true } });
      const ok = await request(app).post('/api/projects').set(u.auth).send({ title: 'Otro' });
      expect(ok.status).toBe(201);
      expect(await ProjectModel.countDocuments({ ownerId: u.id })).toBe(16);
    });
  });

  describe('GET /billing/me y RGPD', () => {
    it('GET /billing/me devuelve usage.aiGenerations y limits.maxMonthlyAiGenerations', async () => {
      const u = await createUser('me@example.com', { plan: 'starter', billingStatus: 'active' });
      const empty = await request(app).get('/api/billing/me').set(u.auth);
      expect(empty.status).toBe(200);
      expect(empty.body.data.usage.aiGenerations).toBe(0);
      expect(empty.body.data.limits.maxMonthlyAiGenerations).toBe(40);
      await reserveAiGeneration(u.idStr);
      await reserveAiGeneration(u.idStr);
      const res = await request(app).get('/api/billing/me').set(u.auth);
      expect(res.body.data.usage.aiGenerations).toBe(2);
      expect(res.body.data.usage.periodResetAt).toBe(nextPeriodStart(new Date()).toISOString());
    });

    it('el export RGPD incluye el contador de IA de cada mes', async () => {
      const u = await createUser('gdpr@example.com');
      await UsageModel.create({ ownerId: u.id, period: '2026-09', requests: 4, aiGenerations: 3 });
      await reserveAiGeneration(u.idStr);
      const res = await request(app).get('/api/users/me/export').set(u.auth);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.text).usage).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ period: '2026-09', requests: 4, aiGenerations: 3 }),
          expect.objectContaining({ period: periodOf(new Date()), aiGenerations: 1 }),
        ])
      );
    });

    it('borrar la cuenta elimina tambien el contador de IA', async () => {
      const u = await createUser('del@example.com');
      await reserveAiGeneration(u.idStr);
      expect(await UsageModel.countDocuments({ ownerId: u.id })).toBe(1);
      const res = await request(app).delete('/api/users/me').set(u.auth).send({ password: PASSWORD });
      expect(res.status).toBe(204);
      expect(await UsageModel.countDocuments({ ownerId: u.id })).toBe(0);
    });
  });
});
