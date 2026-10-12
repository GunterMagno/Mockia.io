import crypto from 'crypto';
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
import { flushUsage } from '../modules/billing/usage.js';
import { mockCache } from '../modules/mock/mockCache.service.js';

/**
 * Task B6: POST /api/demo/:demoId/claim. A signed-in, verified user turns the ephemeral demo mock they built before
 * registering into a real project of their account. Real Mongo and the real Express app. The claim spends no AI quota
 * and no demo budget; the demo id is a 128-bit capability (nothing lists demos); the claim is atomic (at most one
 * project per demo), and a refusal or a failure puts the demo back so it can be claimed again.
 */

const PASSWORD = 'demo-claim-test-password-1';
const SECRET = 'demo-test-secret-with-more-than-32-chars!!';
const ENV_KEYS = [
  'DEMO_ENABLED',
  'DEMO_HMAC_SECRET',
  'REQUIRE_EMAIL_VERIFICATION',
  'DEMO_MOCK_TTL_MINUTES',
] as const;
const saved: Record<string, string | undefined> = {};

const ENDPOINTS: DemoEndpoint[] = [
  {
    method: 'GET',
    path: '/products',
    statusCode: 200,
    body: [{ id: 1, name: 'Mug' }],
    headers: { 'x-total-count': '1' },
  },
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
  return {
    id: user._id.toString(),
    auth: { Authorization: `Bearer ${login.body.data.tokens.accessToken as string}` },
  };
}

/** claimToken de cada demo creada en el test (el servidor solo lo entrega al crearla). */
const tokens = new Map<string, string>();
const newDemo = async (endpoints: DemoEndpoint[] = ENDPOINTS) => {
  const made = await createDemoMock('pseudonym-of-a-visitor', endpoints, demoClock.now());
  tokens.set(made.demoId, made.claimToken);
  return made.demoId;
};
/** Por defecto envia el token de ese demo; `null` no envia cuerpo; cualquier otro valor se envia tal cual. */
const claim = (demoId: string, auth?: Record<string, string>, token?: unknown) => {
  const req = request(app).post(`/api/demo/${demoId}/claim`);
  if (auth) req.set(auth);
  const value = token === undefined ? tokens.get(demoId) : token;
  return value === null ? req : req.send({ claimToken: value });
};
const demoExists = async (demoId: string) => (await DemoMockModel.countDocuments({ demoId })) === 1;

const collectionCounts = async (): Promise<Record<string, number>> => {
  const names = (await mongoose.connection.db!.listCollections().toArray()).map((c) => c.name);
  const out: Record<string, number> = {};
  for (const name of names)
    out[name] = await mongoose.connection.db!.collection(name).countDocuments({});
  return out;
};

describe('demo publica: reclamar la demo como proyecto (POST /api/demo/:demoId/claim)', () => {
  let clockOffset = 0;

  beforeAll(async () => {
    await connectDB();
    await Promise.all([
      DemoMockModel.init(),
      DemoBudgetModel.init(),
      DemoSpentChallengeModel.init(),
      AiRateWindowModel.init(),
    ]);
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
    tokens.clear();
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
      const endpoints = await EndpointModel.find({ mockApiId: mockApi!._id })
        .populate('responses')
        .lean();
      expect(endpoints).toHaveLength(ENDPOINTS.length);
      const key = (m: string, p: string) =>
        endpoints.find((e) => e.method === m && e.path === p) as any;
      expect(key('GET', '/products').responses[0].statusCode).toBe(200);
      expect(key('GET', '/products').responses[0].examples[0]).toEqual([{ id: 1, name: 'Mug' }]);
      expect(key('POST', '/products').responses[0].statusCode).toBe(201);
      expect(key('GET', '/products/:id').responses[0].examples[0]).toEqual({ id: 1, name: 'Mug' });
      expect(key('DELETE', '/products/:id').responses[0].statusCode).toBe(204);
      // las cabeceras permitidas pasan a la configuracion del endpoint (se vuelven a filtrar al servirlas)
      const cfg = await EndpointConfigModel.findOne({
        endpointId: key('GET', '/products')._id,
      }).lean();
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
      // el motor cuenta las peticiones servidas en memoria y las escribe cada 5 s: que no caiga en un test posterior
      await flushUsage();
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
      expect(grown.sort()).toEqual(
        ['demomocks', 'endpointconfigs', 'endpoints', 'mockapis', 'projects', 'responses'].sort()
      );
      expect(after.aigenerations ?? 0).toBe(0);
      expect(after.demobudgets ?? 0).toBe(before.demobudgets ?? 0);
      expect(await UsageModel.find({}).lean()).toEqual(usageBefore);
    });

    it('el titulo es razonable (<= 60 caracteres, derivado del primer recurso) y no lleva nada del visitante', async () => {
      const user = await createUser();
      const long = '/' + 'a'.repeat(150);
      const demoId = await newDemo([
        { method: 'GET', path: long, statusCode: 200, body: { note: '<script>alert(1)</script>' } },
      ]);
      const dto = (await claim(demoId, user.auth)).body.data;
      expect(dto.title.length).toBeLessThanOrEqual(60);
      expect(dto.title).toMatch(/^Demo/);
      expect(dto.title).not.toMatch(/[<>]/);

      const demoId2 = await newDemo([
        { method: 'GET', path: '/users/:id', statusCode: 200, body: {} },
      ]);
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
      await DemoMockModel.updateOne(
        { demoId: expired },
        { $set: { expiresAt: new Date(Date.now() - 1000) } }
      );
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
      for (const p of [
        '/api/demo',
        '/api/demo/list',
        '/api/demo/mine',
        '/api/demo/claims',
        '/api/demo/all',
      ]) {
        const res = await request(app).get(p).set(user.auth);
        expect(res.status).toBe(404);
      }
      // el documento no guarda ningun dato de usuario que pudiera relacionarse con una cuenta
      const raw = await mongoose.connection.db!.collection('demomocks').findOne({});
      expect(Object.keys(raw!).sort()).toEqual(
        [
          '__v',
          '_id',
          'claimTokenHash',
          'createdAt',
          'demoId',
          'endpoints',
          'expiresAt',
          'ipHash',
          'requestCount',
        ].sort()
      );
    });
  });

  /* ----------------------------------------------------------------------------------------------- auth */

  describe('L1 (a) el id publico de la demo ya no basta: hace falta el claimToken', () => {
    it('un token ausente o erroneo da el mismo 404 que "no existe" y NO consume ni borra la demo', async () => {
      const user = await createUser();
      const demoId = await newDemo();
      const real = tokens.get(demoId)!;
      const gone = await claim('f'.repeat(32), user.auth, 'f'.repeat(32));
      expect(gone.status).toBe(404);

      const wrong: Array<[string, unknown]> = [
        ['ausente (sin cuerpo)', null],
        ['ausente (objeto vacio)', {}],
        ['otro token bien formado', 'a'.repeat(32)],
        ['un caracter distinto', real.slice(0, 31) + (real.endsWith('0') ? '1' : '0')],
        ['el propio demoId (lo que ve cualquiera con el enlace)', demoId],
        ['vacio', ''],
        ['no hexadecimal', 'z'.repeat(32)],
        ['mayusculas', real.toUpperCase()],
        ['largo (cabe en el cuerpo)', 'a'.repeat(600)],
        ['un numero', 12345],
        ['un array', ['x']],
        ['un objeto con operadores de Mongo', { $ne: 'x' }],
      ];
      for (const [i, [label, value]] of wrong.entries()) {
        if (i % 4 === 0) resetDemoApiLimits(); // 12 intentos > el limite por cuenta: aqui solo se prueba el token
        const res = await claim(demoId, user.auth, value);
        expect([label, res.status]).toEqual([label, 404]);
        expect(res.body.error.code).toBe(gone.body.error.code);
        expect(res.body.error.message).toBe(gone.body.error.message);
        expect(await demoExists(demoId)).toBe(true);
        expect(await ProjectModel.countDocuments({})).toBe(0);
      }
      // la demo sigue sirviendose y se reclama con el token correcto
      expect((await request(app).get(`/api/demo-mock/${demoId}/products`)).status).toBe(200);
      resetDemoApiLimits();
      expect((await claim(demoId, user.auth)).status).toBe(201);
    });

    it('un cuerpo que no es JSON no reclama ni consume; el token en la URL o en una cabecera no cuenta', async () => {
      const user = await createUser();
      const demoId = await newDemo();
      const token = tokens.get(demoId)!;
      const asText = await request(app)
        .post(`/api/demo/${demoId}/claim`)
        .set(user.auth)
        .set('Content-Type', 'text/plain')
        .send(token);
      expect(asText.status).toBe(404);
      const broken = await request(app)
        .post(`/api/demo/${demoId}/claim`)
        .set(user.auth)
        .set('Content-Type', 'application/json')
        .send('{"claimToken":');
      expect(broken.status).toBe(400);
      const elsewhere = await request(app)
        .post(`/api/demo/${demoId}/claim?claimToken=${token}`)
        .set(user.auth)
        .set('X-Claim-Token', token);
      expect(elsewhere.status).toBe(404);
      const huge = await claim(demoId, user.auth, 'a'.repeat(5000));
      expect(huge.status).toBe(413); // el cuerpo admite 1 KB: un secreto son 32 caracteres
      expect(await demoExists(demoId)).toBe(true);
      expect(await ProjectModel.countDocuments({})).toBe(0);
    });

    it('con el token correcto crea el proyecto como hasta ahora, y no se puede reutilizar', async () => {
      const user = await createUser();
      const demoId = await newDemo();
      const res = await claim(demoId, user.auth);
      expect(res.status).toBe(201);
      expect(res.body.data.ownerId).toBe(user.id);
      expect(await ProjectModel.countDocuments({})).toBe(1);
      expect(await demoExists(demoId)).toBe(false);
      expect((await claim(demoId, user.auth)).status).toBe(404);
    });

    it('el token de una demo no sirve para otra', async () => {
      const user = await createUser();
      const a = await newDemo();
      const b = await newDemo();
      expect((await claim(a, user.auth, tokens.get(b))).status).toBe(404);
      expect(await demoExists(a)).toBe(true);
      expect(await demoExists(b)).toBe(true);
    });

    it('quien solo tiene el enlace compartido (el demoId) no puede quedarse la demo de otra persona', async () => {
      const owner = await createUser();
      const stranger = await createUser();
      const demoId = await newDemo();
      for (const guess of [demoId, {}, null]) {
        expect((await claim(demoId, stranger.auth, guess)).status).toBe(404);
      }
      expect(await ProjectModel.countDocuments({ ownerId: stranger.id })).toBe(0);
      expect((await claim(demoId, owner.auth)).status).toBe(201);
    });

    it('un token erroneo cuenta para el limitador por cuenta (no se puede adivinar gratis)', async () => {
      const user = await createUser();
      const demoId = await newDemo();
      for (let i = 0; i < CLAIMS_PER_WINDOW; i++) {
        expect((await claim(demoId, user.auth, 'b'.repeat(32))).status).toBe(404);
      }
      expect((await claim(demoId, user.auth)).status).toBe(429);
      expect(await demoExists(demoId)).toBe(true);
    });

    it('compara el hash en tiempo constante (crypto.timingSafeEqual)', async () => {
      const user = await createUser();
      const demoId = await newDemo();
      const spy = jest.spyOn(crypto, 'timingSafeEqual');
      expect((await claim(demoId, user.auth, 'c'.repeat(32))).status).toBe(404);
      expect(spy).toHaveBeenCalled();
      spy.mockClear();
      expect((await claim(demoId, user.auth)).status).toBe(201);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('L1 (c) el token no se guarda en claro', () => {
    it('DemoMock guarda solo el hash SHA-256 (64 hex): ni el token ni nada que lo contenga', async () => {
      const made = await createDemoMock('pseudonym-of-a-visitor', ENDPOINTS, demoClock.now());
      expect(made.claimToken).toMatch(/^[0-9a-f]{32}$/);
      expect(made.claimToken).not.toBe(made.demoId);
      const doc = await DemoMockModel.findOne({ demoId: made.demoId }).lean();
      const raw = await mongoose.connection.db!.collection('demomocks').findOne({});
      for (const view of [JSON.stringify(doc), JSON.stringify(raw)]) {
        expect(view).not.toContain(made.claimToken);
      }
      expect(doc!.claimTokenHash).toBe(
        crypto.createHash('sha256').update(made.claimToken).digest('hex')
      );
    });

    it('cada demo tiene su propio token (128 bits aleatorios)', async () => {
      const seen = new Set<string>();
      for (let i = 0; i < 20; i++) {
        seen.add(
          (await createDemoMock('pseudonym-of-a-visitor', ENDPOINTS, demoClock.now())).claimToken
        );
      }
      expect(seen.size).toBe(20);
    });

    it('el router publico del mock nunca devuelve el token ni su hash', async () => {
      const made = await createDemoMock('pseudonym-of-a-visitor', ENDPOINTS, demoClock.now());
      const doc = await DemoMockModel.findOne({ demoId: made.demoId }).lean();
      const res = await request(app).get(`/api/demo-mock/${made.demoId}/products`);
      const dump = JSON.stringify([res.body, res.headers]);
      expect(dump).not.toContain(made.claimToken);
      expect(dump).not.toContain(doc!.claimTokenHash);
    });
  });

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
        await ProjectModel.create({
          title: `p${i}`,
          slug: `fill-${ownerId}-${i}`,
          ownerId,
          members: [{ userId: ownerId, role: 'owner' }],
        });
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

  describe('L1 (d) reclamos simultaneos con la cuenta a limite-1 no sobrepasan el limite', () => {
    const fill = async (ownerId: string, n: number) => {
      for (let i = 0; i < n; i++) {
        await ProjectModel.create({
          title: `p${i}`,
          slug: `race-${ownerId}-${i}`,
          ownerId,
          members: [{ userId: ownerId, role: 'owner' }],
        });
      }
    };
    const active = (ownerId: string) =>
      ProjectModel.countDocuments({ ownerId, isArchived: { $ne: true } });

    /** Hace que, justo despues de guardar el proyecto del reclamo, "otra instancia" cree otro de la misma cuenta. */
    const injectForeignProject = (ownerId: string) => {
      const realSave = ProjectModel.prototype.save;
      let injected = false;
      jest.spyOn(ProjectModel.prototype, 'save').mockImplementation(async function (
        this: InstanceType<typeof ProjectModel>,
        ...args: Parameters<typeof realSave>
      ) {
        const saved = await realSave.apply(this, args);
        if (!injected) {
          injected = true;
          await ProjectModel.collection.insertOne({
            title: 'foreign',
            slug: `foreign-${Date.now()}`,
            ownerId: new mongoose.Types.ObjectId(ownerId),
            members: [],
            isArchived: false,
          });
        }
        return saved;
      } as never);
      return () => injected;
    };

    it('dos demos distintas de la misma cuenta a la vez (Free: 4 de 5): exactamente UN proyecto nuevo y el otro recibe 402', async () => {
      const user = await createUser();
      await fill(user.id, 4);
      const a = await newDemo();
      const b = await newDemo();
      const results = await Promise.all([claim(a, user.auth), claim(b, user.auth)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 402]);
      const loser = results.find((r) => r.status === 402)!;
      expect(loser.body.error.code).toBe('PLAN_LIMIT_REACHED');
      expect(loser.body.error.details).toMatchObject({ plan: 'free', limit: 5 });
      expect(await active(user.id)).toBe(5);
      // la demo del perdedor sigue disponible (tambien para el router) y se reclama al liberar un hueco
      const lostId = results[0].status === 402 ? a : b;
      expect(await demoExists(lostId)).toBe(true);
      expect((await request(app).get(`/api/demo-mock/${lostId}/products`)).status).toBe(200);
      await ProjectModel.updateOne({ ownerId: user.id }, { $set: { isArchived: true } });
      invalidatePlanCache();
      expect((await claim(lostId, user.auth)).status).toBe(201);
    });

    it('seis reclamos a la vez con cuatro huecos libres: nunca se supera el limite', async () => {
      const user = await createUser();
      await fill(user.id, 1);
      const ids: string[] = [];
      for (let i = 0; i < 6; i++) ids.push(await newDemo());
      const results = await Promise.all(ids.map((id) => claim(id, user.auth)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(4);
      expect(results.filter((r) => r.status === 402)).toHaveLength(2);
      expect(await active(user.id)).toBe(5);
      expect(await DemoMockModel.countDocuments({})).toBe(2);
    });

    it('COMPENSACION: si otra instancia crea un proyecto entre medias, el reclamo recuenta, borra el suyo, restaura la demo con su caducidad original y responde 402', async () => {
      const user = await createUser();
      await fill(user.id, 4);
      const demoId = await newDemo();
      await DemoMockModel.updateOne({ demoId }, { $set: { requestCount: 3 } });
      const before = await DemoMockModel.findOne({ demoId }).lean();
      const injected = injectForeignProject(user.id);

      const res = await claim(demoId, user.auth);
      jest.restoreAllMocks();
      expect(injected()).toBe(true);
      expect(res.status).toBe(402);
      expect(res.body.error.code).toBe('PLAN_LIMIT_REACHED');
      expect(res.body.error.details).toMatchObject({ plan: 'free', limit: 5 });
      // 4 propios + 1 de la otra instancia: el recien creado se borro con todo lo que colgaba de el
      expect(await active(user.id)).toBe(5);
      expect(await MockAPIModel.countDocuments({})).toBe(0);
      expect(await EndpointModel.countDocuments({})).toBe(0);
      expect(await ResponseModel.countDocuments({})).toBe(0);
      const after = await DemoMockModel.findOne({ demoId }).lean();
      expect(after).not.toBeNull();
      expect(after!.expiresAt).toEqual(before!.expiresAt);
      expect(after!.requestCount).toBe(3);
      expect(after!.claimTokenHash).toBe(before!.claimTokenHash);
      expect(after!.endpoints).toHaveLength(ENDPOINTS.length);
      // con el mismo token se reclama en cuanto hay hueco
      await ProjectModel.updateOne(
        { ownerId: user.id, title: 'foreign' },
        { $set: { isArchived: true } }
      );
      invalidatePlanCache();
      expect((await claim(demoId, user.auth)).status).toBe(201);
    });

    it('si falla el borrado del proyecto sobrante se archiva, la demo vuelve igualmente y se responde 402', async () => {
      const user = await createUser();
      await fill(user.id, 4);
      const demoId = await newDemo();
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      injectForeignProject(user.id);
      jest.spyOn(ProjectModel, 'deleteMany').mockRejectedValueOnce(new Error('boom'));
      const res = await claim(demoId, user.auth);
      jest.restoreAllMocks();
      expect(res.status).toBe(402);
      expect(await demoExists(demoId)).toBe(true);
      expect(await active(user.id)).toBe(5); // el sobrante quedo archivado: no cuenta
    });
  });

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
      const results = await Promise.all([
        claim(demoId, a.auth),
        claim(demoId, b.auth),
        claim(demoId, a.auth),
        claim(demoId, b.auth),
      ]);
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
      const save = jest
        .spyOn(ProjectModel.prototype, 'save')
        .mockRejectedValueOnce(new Error('boom'));
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
      const claimToken = made.body.data.claimToken as string;
      expect(demoId).toMatch(/^[0-9a-f]{32}$/);
      expect(claimToken).toMatch(/^[0-9a-f]{32}$/);
      expect((await claim(demoId, user.auth, null)).status).toBe(404);
      expect((await claim(demoId, user.auth, claimToken)).status).toBe(201);
      expect(await ProjectModel.countDocuments({})).toBe(1);
    });
  });
});
