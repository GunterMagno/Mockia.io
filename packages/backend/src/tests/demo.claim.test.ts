import request from 'supertest';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { ErrorCode } from '@mockia/shared';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { ProjectModel } from '../models/Project.js';
import { AiGenerationModel } from '../models/AiGeneration.js';
import { AiRateWindowModel } from '../models/AiRateWindow.js';
import { DemoMockModel } from '../models/DemoMock.js';
import { DemoBudgetModel } from '../models/DemoBudget.js';
import { DemoSpentChallengeModel } from '../models/DemoSpentChallenge.js';
import { EndpointModel, MockAPIModel, ResponseModel } from '../models/MockAPI.js';
import { EndpointConfigModel } from '../models/EndpointConfig.js';
import { UsageModel } from '../models/Usage.js';
import { demoClock, resetDemoFlood } from '../modules/demo/mockRouter.js';
import { CLAIMS_PER_WINDOW, resetDemoApiLimits } from '../modules/demo/routes.js';
import { createDemoMock, type DemoEndpoint } from '../modules/demo/mockStore.js';
import { invalidatePlanCache } from '../modules/billing/plans.js';
import { mockCache } from '../modules/mock/mockCache.service.js';

/**
 * Task B6: POST /api/demo/:demoId/claim. A signed-in, verified user turns the ephemeral demo mock they built before
 * registering into a real project of their account. Real Mongo and the real Express app. The claim spends no AI quota
 * and no demo budget; the demo id is a 128-bit capability (nothing lists demos); the claim is atomic (at most one
 * project per demo), and a refusal or a failure puts the demo back so it can be claimed again.
 */

const PASSWORD = 'demo-claim-test-password-1';
const SECRET = 'demo-test-secret-with-more-than-32-chars!!';
const ENV_KEYS = ['DEMO_ENABLED', 'DEMO_HMAC_SECRET', 'REQUIRE_EMAIL_VERIFICATION', 'DEMO_MOCK_TTL_MINUTES'] as const;
const saved: Record<string, string | undefined> = {};

const ENDPOINTS: DemoEndpoint[] = [
  { method: 'GET', path: '/products', statusCode: 200, body: [{ id: 1, name: 'Mug' }], headers: { 'x-total-count': '1' } },
  { method: 'GET', path: '/products/:id', statusCode: 200, body: { id: 1, name: 'Mug' } },
  { method: 'POST', path: '/products', statusCode: 201, body: { id: 2, name: 'Cup' } },
  { method: 'DELETE', path: '/products/:id', statusCode: 204, body: null },
  { method: 'GET', path: '/empty', statusCode: 200, body: {} },
];

let counter = 0;
async function createUser(opts: { verified?: boolean } = {}) {
  const email = `claim${Date.now()}${counter++}@example.com`;
  const user = await UserModel.create({
    email,
    username: `claim${counter}`,
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    ...(opts.verified === false ? {} : { emailVerifiedAt: new Date() }),
  });
  const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return { id: user._id.toString(), auth: { Authorization: `Bearer ${login.body.data.tokens.accessToken as string}` } };
}

const newDemo = async (endpoints: DemoEndpoint[] = ENDPOINTS) => (await createDemoMock('pseudonym-of-a-visitor', endpoints, demoClock.now())).demoId;
const claim = (demoId: string, auth?: Record<string, string>) => {
  const req = request(app).post(`/api/demo/${demoId}/claim`);
  return auth ? req.set(auth) : req;
};
const demoExists = async (demoId: string) => (await DemoMockModel.countDocuments({ demoId })) === 1;

const collectionCounts = async (): Promise<Record<string, number>> => {
  const names = (await mongoose.connection.db!.listCollections().toArray()).map((c) => c.name);
  const out: Record<string, number> = {};
  for (const name of names) out[name] = await mongoose.connection.db!.collection(name).countDocuments({});
  return out;
};

describe('demo publica: reclamar la demo como proyecto (POST /api/demo/:demoId/claim)', () => {
  let clockOffset = 0;

  beforeAll(async () => {
    await connectDB();
    await Promise.all([DemoMockModel.init(), DemoBudgetModel.init(), DemoSpentChallengeModel.init(), AiRateWindowModel.init()]);
  });
  afterAll(async () => {
    await disconnectDB();
  });

  beforeEach(async () => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.DEMO_HMAC_SECRET = SECRET;
    process.env.DEMO_ENABLED = 'true';
    clockOffset = 0;
    demoClock.now = () => new Date(Date.now() + clockOffset);
    resetDemoFlood();
    resetDemoApiLimits();
    invalidatePlanCache();
    await Promise.all([
      DemoMockModel.deleteMany({}),
      DemoBudgetModel.deleteMany({}),
      DemoSpentChallengeModel.deleteMany({}),
      UserModel.deleteMany({}),
      ProjectModel.deleteMany({}),
      MockAPIModel.deleteMany({}),
      EndpointModel.deleteMany({}),
      ResponseModel.deleteMany({}),
      EndpointConfigModel.deleteMany({}),
      UsageModel.deleteMany({}),
      AiGenerationModel.deleteMany({}),
      AiRateWindowModel.deleteMany({}),
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    demoClock.now = () => new Date();
    resetDemoApiLimits();
  });

  /* --------------------------------------------------------------------------------------------- happy path */

  describe('(a) camino feliz', () => {
    it('crea UN proyecto real con los endpoints del mock y elimina el DemoMock', async () => {
      const user = await createUser();
      const demoId = await newDemo();

      const res = await claim(demoId, user.auth);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const dto = res.body.data;
      expect(dto.ownerId).toBe(user.id);
      expect(typeof dto.slug).toBe('string');
      expect(dto.title.length).toBeGreaterThan(0);
      expect(dto.title.length).toBeLessThanOrEqual(60);
      expect(dto.visibility).toBe('public');
      expect(dto.hasApiKey).toBe(false);

      expect(await ProjectModel.countDocuments({})).toBe(1);
      expect(await demoExists(demoId)).toBe(false);

      // El mock queda guardado como en cualquier proyecto: MockAPI -> Endpoint -> Response
      const mockApi = await MockAPIModel.findOne({ projectId: dto.id }).lean();
      expect(mockApi).not.toBeNull();
      const endpoints = await EndpointModel.find({ mockApiId: mockApi!._id }).populate('responses').lean();
      expect(endpoints).toHaveLength(ENDPOINTS.length);
      const key = (m: string, p: string) => endpoints.find((e) => e.method === m && e.path === p) as any;
      expect(key('GET', '/products').responses[0].statusCode).toBe(200);
      expect(key('GET', '/products').responses[0].examples[0]).toEqual([{ id: 1, name: 'Mug' }]);
      expect(key('POST', '/products').responses[0].statusCode).toBe(201);
      expect(key('GET', '/products/:id').responses[0].examples[0]).toEqual({ id: 1, name: 'Mug' });
      expect(key('DELETE', '/products/:id').responses[0].statusCode).toBe(204);
      // las cabeceras permitidas pasan a la configuracion del endpoint (se vuelven a filtrar al servirlas)
      const cfg = await EndpointConfigModel.findOne({ endpointId: key('GET', '/products')._id }).lean();
      expect(cfg?.headers).toEqual({ 'x-total-count': '1' });
      // la lista de proyectos del usuario ya lo incluye
      const list = await request(app).get('/api/projects').set(user.auth);
      expect(list.body.data.map((p: { id: string }) => p.id)).toEqual([dto.id]);
    });

    it('el proyecto reclamado responde por el motor de mocks REAL igual que la demo (estado y cuerpo)', async () => {
      const user = await createUser();
      const demoId = await newDemo();
      const dto = (await claim(demoId, user.auth)).body.data;
      mockCache.clearAll();

      const list = await request(app).get(`/api/mock/${dto.slug}/products`);
      expect(list.status).toBe(200);
      expect(list.body).toEqual([{ id: 1, name: 'Mug' }]);
      const one = await request(app).get(`/api/mock/${dto.slug}/products/7`);
      expect(one.status).toBe(200);
      expect(one.body).toEqual({ id: 1, name: 'Mug' });
      const created = await request(app).post(`/api/mock/${dto.slug}/products`).send({});
      expect(created.status).toBe(201);
      expect(created.body).toEqual({ id: 2, name: 'Cup' });
      const empty = await request(app).get(`/api/mock/${dto.slug}/empty`);
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual({});
    });

    it('no consume cuota de IA del usuario ni presupuesto de la demo (ni crea ninguna otra cosa)', async () => {
      const user = await createUser();
      const demoId = await newDemo();
      const before = await collectionCounts();
      const usageBefore = await UsageModel.find({}).lean();

      const res = await claim(demoId, user.auth);
      expect(res.status).toBe(201);

      const after = await collectionCounts();
      const grown = Object.keys(after).filter((c) => after[c] !== (before[c] ?? 0));
      expect(grown.sort()).toEqual(['demomocks', 'endpointconfigs', 'endpoints', 'mockapis', 'projects', 'responses'].sort());
      expect(after.aigenerations ?? 0).toBe(0);
      expect(after.demobudgets ?? 0).toBe(before.demobudgets ?? 0);
      expect(await UsageModel.find({}).lean()).toEqual(usageBefore);
    });

    it('el titulo es razonable (<= 60 caracteres, derivado del primer recurso) y no lleva nada del visitante', async () => {
      const user = await createUser();
      const long = '/' + 'a'.repeat(150);
      const demoId = await newDemo([{ method: 'GET', path: long, statusCode: 200, body: { note: '<script>alert(1)</script>' } }]);
      const dto = (await claim(demoId, user.auth)).body.data;
      expect(dto.title.length).toBeLessThanOrEqual(60);
      expect(dto.title).toMatch(/^Demo/);
      expect(dto.title).not.toMatch(/[<>]/);

      const demoId2 = await newDemo([{ method: 'GET', path: '/users/:id', statusCode: 200, body: {} }]);
      const dto2 = (await claim(demoId2, user.auth)).body.data;
      expect(dto2.title).toBe('Demo - users');
    });

    it('sigue funcionando con la demo apagada (reclamar no usa IA ni presupuesto: es solo conservar lo ya creado)', async () => {
      const user = await createUser();
      const demoId = await newDemo();
      process.env.DEMO_ENABLED = 'false';
      expect((await claim(demoId, user.auth)).status).toBe(201);
    });
  });

  /* ------------------------------------------------------------------------------------- not found / spent */

  describe('(b) 404 identico si no existe, venció o ya fue reclamado', () => {
    it('un segundo reclamo (de cualquiera) responde 404 y no crea un segundo proyecto', async () => {
      const first = await createUser();
      const second = await createUser();
      const demoId = await newDemo();
      expect((await claim(demoId, first.auth)).status).toBe(201);

      const again = await claim(demoId, first.auth);
      expect(again.status).toBe(404);
      const other = await claim(demoId, second.auth);
      expect(other.status).toBe(404);
      expect(await ProjectModel.countDocuments({})).toBe(1);
    });

    it('desconocido, mal formado, en mayusculas y vencido dan el mismo estado, codigo y mensaje', async () => {
      const user = await createUser();
      const real = await newDemo();
      clockOffset = 0;
      const expired = await newDemo();
      await DemoMockModel.updateOne({ demoId: expired }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const attempts = [
        'f'.repeat(32), // bien formado, no existe
        real.slice(0, 31) + (real.endsWith('0') ? '1' : '0'), // un caracter distinto
        'not-a-demo-id',
        real.toUpperCase(), // el id es minusculas: no vale
        expired,
        '0'.repeat(31),
      ];
      const bodies = [];
      for (const id of attempts) {
        const res = await claim(id, user.auth);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
        bodies.push(res.body.error.message);
      }
      expect(new Set(bodies).size).toBe(1);
      expect(await ProjectModel.countDocuments({})).toBe(0);
      expect(await demoExists(real)).toBe(true); // ningun intento ajeno lo toco
    });

    it('no hay listado de demos y un id adivinado no da nada', async () => {
      const user = await createUser();
      await newDemo();
      for (const p of ['/api/demo', '/api/demo/list', '/api/demo/mine', '/api/demo/claims', '/api/demo/all']) {
        const res = await request(app).get(p).set(user.auth);
        expect(res.status).toBe(404);
      }
      // el documento no guarda ningun dato de usuario que pudiera relacionarse con una cuenta
      const raw = await mongoose.connection.db!.collection('demomocks').findOne({});
      expect(Object.keys(raw!).sort()).toEqual(['__v', '_id', 'createdAt', 'demoId', 'endpoints', 'expiresAt', 'ipHash', 'requestCount'].sort());
    });
  });

  /* ----------------------------------------------------------------------------------------------- auth */

  describe('(c) sesion y correo verificado', () => {
    it('sin sesion: 401 y el demo sigue disponible', async () => {
      const demoId = await newDemo();
      const res = await claim(demoId);
      expect(res.status).toBe(401);
      expect(await demoExists(demoId)).toBe(true);
      expect(await ProjectModel.countDocuments({})).toBe(0);
    });

    it('con un token falso: 401 y el demo sigue disponible', async () => {
      const demoId = await newDemo();
      const res = await claim(demoId, { Authorization: 'Bearer not-a-real-token' });
      expect(res.status).toBe(401);
      expect(await demoExists(demoId)).toBe(true);
    });

    it('correo sin verificar (cuando se exige): 403 EMAIL_NOT_VERIFIED, no se crea nada y el demo sigue ahi', async () => {
      process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
      const user = await createUser({ verified: false });
      const demoId = await newDemo();
      const res = await claim(demoId, user.auth);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCode.EMAIL_NOT_VERIFIED);
      expect(await ProjectModel.countDocuments({})).toBe(0);
      expect(await demoExists(demoId)).toBe(true);

      // al verificar, el mismo id ya se puede reclamar
      await UserModel.updateOne({ _id: user.id }, { $set: { emailVerifiedAt: new Date() } });
      expect((await claim(demoId, user.auth)).status).toBe(201);
    });
  });

  /* ------------------------------------------------------------------------------------------ plan limit */

  describe('(d) limite de proyectos del plan', () => {
    const fillProjects = async (ownerId: string, n: number) => {
      for (let i = 0; i < n; i++) {
        await ProjectModel.create({ title: `p${i}`, slug: `fill-${ownerId}-${i}`, ownerId, members: [{ userId: ownerId, role: 'owner' }] });
      }
    };

    it('en su limite recibe 402 PLAN_LIMIT_REACHED, no se crea nada y la demo SIGUE disponible (tambien para el router)', async () => {
      const user = await createUser();
      await fillProjects(user.id, 5); // Free: 5 proyectos activos
      const demoId = await newDemo();

      const res = await claim(demoId, user.auth);
      expect(res.status).toBe(402);
      expect(res.body.error.code).toBe('PLAN_LIMIT_REACHED');
      expect(res.body.error.details).toMatchObject({ plan: 'free', limit: 5, active: 5 });
      expect(await ProjectModel.countDocuments({})).toBe(5);
      expect(await demoExists(demoId)).toBe(true);
      const served = await request(app).get(`/api/demo-mock/${demoId}/products`);
      expect(served.status).toBe(200);

      // libera un hueco y el MISMO id se reclama
      await ProjectModel.updateOne({ ownerId: user.id }, { $set: { isArchived: true } });
      invalidatePlanCache();
      expect((await claim(demoId, user.auth)).status).toBe(201);
      expect(await demoExists(demoId)).toBe(false);
    });

    it('no consume la cuota de IA aunque se rechace', async () => {
      const user = await createUser();
      await fillProjects(user.id, 5);
      const demoId = await newDemo();
      await claim(demoId, user.auth);
      expect(await UsageModel.countDocuments({})).toBe(0);
    });
  });

  /* --------------------------------------------------------------------------------------- atomicity */

  describe('(e) atomicidad', () => {
    it('8 reclamos simultaneos del mismo usuario producen exactamente UN proyecto', async () => {
      const user = await createUser();
      const demoId = await newDemo();
      const results = await Promise.all(Array.from({ length: 8 }, () => claim(demoId, user.auth)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 404)).toHaveLength(7);
      expect(await ProjectModel.countDocuments({})).toBe(1);
      expect(await MockAPIModel.countDocuments({})).toBe(1);
      expect(await EndpointModel.countDocuments({})).toBe(ENDPOINTS.length);
    });

    it('dos cuentas distintas con el mismo id a la vez: un solo proyecto en total', async () => {
      const a = await createUser();
      const b = await createUser();
      const demoId = await newDemo();
      const results = await Promise.all([claim(demoId, a.auth), claim(demoId, b.auth), claim(demoId, a.auth), claim(demoId, b.auth)]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await ProjectModel.countDocuments({})).toBe(1);
    });
  });

  /* ---------------------------------------------------------------------------------------- failures */

  describe('(f) si la creacion falla, la demo se restaura', () => {
    const sameDemo = async (demoId: string) => DemoMockModel.findOne({ demoId }).lean();

    it('fallo al crear el proyecto: 500, nada queda a medias y el mismo id se puede reclamar despues', async () => {
      const user = await createUser();
      const demoId = await newDemo();
      await DemoMockModel.updateOne({ demoId }, { $set: { requestCount: 7 } });
      const before = await sameDemo(demoId);
      const save = jest.spyOn(ProjectModel.prototype, 'save').mockRejectedValueOnce(new Error('boom'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const res = await claim(demoId, user.auth);
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('boom');
      expect(save).toHaveBeenCalled();
      expect(await ProjectModel.countDocuments({})).toBe(0);
      const after = await sameDemo(demoId);
      expect(after).not.toBeNull();
      expect(after!.expiresAt).toEqual(before!.expiresAt); // la caducidad original, no una nueva
      expect(after!.requestCount).toBe(7);
      expect(after!.endpoints).toHaveLength(ENDPOINTS.length);
      expect((await request(app).get(`/api/demo-mock/${demoId}/products`)).status).toBe(200);

      jest.restoreAllMocks();
      expect((await claim(demoId, user.auth)).status).toBe(201);
    });

    it('fallo al guardar los endpoints: el proyecto a medias se borra, la demo vuelve y no queda huerfano', async () => {
      const user = await createUser();
      const demoId = await newDemo();
      jest.spyOn(EndpointModel.prototype, 'save').mockRejectedValueOnce(new Error('endpoint boom'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const res = await claim(demoId, user.auth);
      expect(res.status).toBe(500);
      expect(await ProjectModel.countDocuments({})).toBe(0);
      expect(await MockAPIModel.countDocuments({})).toBe(0);
      expect(await EndpointModel.countDocuments({})).toBe(0);
      expect(await ResponseModel.countDocuments({})).toBe(0);
      expect(await demoExists(demoId)).toBe(true);

      jest.restoreAllMocks();
      expect((await claim(demoId, user.auth)).status).toBe(201);
    });

    it('un reclamo que llega mientras otro falla no crea proyecto doble: el id queda libre solo tras restaurar', async () => {
      const user = await createUser();
      const demoId = await newDemo();
      jest.spyOn(ProjectModel.prototype, 'save').mockRejectedValueOnce(new Error('boom'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const results = await Promise.all([claim(demoId, user.auth), claim(demoId, user.auth)]);
      expect(results.filter((r) => r.status === 201).length).toBeLessThanOrEqual(1);
      expect(await ProjectModel.countDocuments({})).toBeLessThanOrEqual(1);
    });
  });

  /* ---------------------------------------------------------------------------------------- limiter */

  describe('(g) limitador', () => {
    it(`el reclamo ${CLAIMS_PER_WINDOW + 1} de una cuenta en la ventana responde 429 con Retry-After, sin tocar la base de datos`, async () => {
      const user = await createUser();
      const demoId = await newDemo();
      for (let i = 0; i < CLAIMS_PER_WINDOW; i++) {
        expect((await claim('e'.repeat(32), user.auth)).status).toBe(404);
      }
      const spy = jest.spyOn(DemoMockModel, 'findOneAndDelete');
      const blocked = await claim(demoId, user.auth);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe(ErrorCode.RATE_LIMIT_ERROR);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(spy).not.toHaveBeenCalled();
      expect(await demoExists(demoId)).toBe(true);

      // otra cuenta no queda afectada y, pasada la ventana, esta tambien
      const other = await createUser();
      expect((await claim(demoId, other.auth)).status).toBe(201);
    });

    it('la ventana se renueva con el tiempo', async () => {
      const user = await createUser();
      for (let i = 0; i < CLAIMS_PER_WINDOW; i++) await claim('e'.repeat(32), user.auth);
      expect((await claim('e'.repeat(32), user.auth)).status).toBe(429);
      clockOffset = 16 * 60 * 1000;
      expect((await claim('e'.repeat(32), user.auth)).status).toBe(404);
    });
  });

  /* ------------------------------------------------------------------------------------- e2e test support */

  describe('(h) apoyo para Cypress (solo con el buzon de pruebas montado)', () => {
    it('POST /api/__test__/demo-mock crea un demo reclamable sin pasar por la IA', async () => {
      const user = await createUser();
      const made = await request(app).post('/api/__test__/demo-mock').send({});
      expect(made.status).toBe(201);
      const demoId = made.body.data.demoId as string;
      expect(demoId).toMatch(/^[0-9a-f]{32}$/);
      expect((await claim(demoId, user.auth)).status).toBe(201);
      expect(await ProjectModel.countDocuments({})).toBe(1);
    });
  });
});
