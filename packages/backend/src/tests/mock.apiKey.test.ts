import request from 'supertest';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { Types } from 'mongoose';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { ProjectModel, ProjectRoleEnum } from '../models/Project.js';
import { EndpointModel, MockAPIModel, ResponseModel } from '../models/MockAPI.js';
import { UsageModel } from '../models/Usage.js';
import { mockCache } from '../modules/mock/mockCache.service.js';
import { apiKeyMatches, hashApiKey } from '../modules/mock/mockAuth.js';
import { PLAN_LIMITS, invalidatePlanCache } from '../modules/billing/plans.js';
import { flushUsage, getMonthlyUsage, nextPeriodStart, periodOf, resetUsage } from '../modules/billing/usage.js';
import { mockClock } from '../middlewares/planGate.js';
import { migrateLegacyApiKeys } from '../modules/projects/apiKeyMigration.js';
import { exportUserData } from '../modules/users/gdpr.js';

// Task 11: claves de API del mock (solo el hash en BD), visibilidad 'public' | 'key' y cuota mensual por plan.
const PASSWORD = 'apikey-test-password-1';
const FREE_LIMIT = PLAN_LIMITS.free.maxMonthlyRequests;
const PRO_LIMIT = PLAN_LIMITS.pro.maxMonthlyRequests;

let counter = 0;
const unique = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter += 1)}`;

async function createUser(over: Record<string, unknown> = {}) {
  const name = unique('u');
  const email = `${name}@example.com`;
  const user = await UserModel.create({ email, username: name, passwordHash: await bcrypt.hash(PASSWORD, 4), ...over });
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { user, email, auth: { Authorization: `Bearer ${res.body.data.tokens.accessToken as string}` } };
}

/** Project with one endpoint `GET /users`, created straight in the DB. */
async function seedProject(ownerId: Types.ObjectId, extra: Record<string, unknown> = {}, members: Array<{ userId: Types.ObjectId; role: ProjectRoleEnum }> = []) {
  const slug = unique('proj');
  const project = await ProjectModel.create({
    title: `Project ${slug}`,
    slug,
    ownerId,
    members: [{ userId: ownerId, role: ProjectRoleEnum.OWNER, addedAt: new Date() }, ...members.map((m) => ({ ...m, addedAt: new Date() }))],
    ...extra,
  });
  const mockApi = await MockAPIModel.create({ projectId: project._id, title: slug, apiVersion: '1.0.0' });
  const response = await ResponseModel.create({ statusCode: 200, description: 'ok', schema: { users: ['ana'] }, examples: [] });
  const endpoint = await EndpointModel.create({ path: '/users', method: 'GET', description: 'users', responses: [response._id], mockApiId: mockApi._id });
  await MockAPIModel.updateOne({ _id: mockApi._id }, { endpoints: [endpoint._id] });
  return project;
}

/** Project that requires `key` (its hash is stored, like the API does). */
const seedPrivate = (ownerId: Types.ObjectId, key: string) =>
  seedProject(ownerId, { visibility: 'key', apiKeyHash: hashApiKey(key), apiKeyPrefix: key.slice(0, 9) });

const mockUrl = (slug: string, path = '/users') => `/api/mock/${slug}${path}`;
const rawProject = (id: unknown) => ProjectModel.collection.findOne({ _id: new Types.ObjectId(String(id)) });

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  resetUsage();
  await disconnectDB();
});

beforeEach(async () => {
  mockClock.now = () => new Date();
  resetUsage();
  invalidatePlanCache();
  mockCache.clearAll();
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    MockAPIModel.deleteMany({}),
    EndpointModel.deleteMany({}),
    ResponseModel.deleteMany({}),
    UsageModel.deleteMany({}),
  ]);
});

describe('acceso a un mock con visibilidad "key"', () => {
  it('sin clave responde 401 con el formato de error del mock y sin WWW-Authenticate', async () => {
    const owner = await createUser();
    const project = await seedPrivate(owner.user._id as Types.ObjectId, 'mk_correct-key-0123456789');
    const res = await request(app).get(mockUrl(project.slug));
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBeUndefined();
    expect(res.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
    expect(typeof res.body.timestamp).toBe('string');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('con la clave correcta responde 200 en las dos rutas publicas', async () => {
    const owner = await createUser();
    const key = 'mk_correct-key-0123456789';
    const project = await seedPrivate(owner.user._id as Types.ObjectId, key);
    const api = await request(app).get(mockUrl(project.slug)).set('X-Mockia-API-Key', key);
    expect(api.status).toBe(200);
    expect(api.body).toEqual({ users: ['ana'] });
    const short = await request(app).get(`/mock/${project.slug}/users`).set('X-Mockia-API-Key', key);
    expect(short.status).toBe(200);
  });

  it('acepta X-Mockia-Key como alias', async () => {
    const owner = await createUser();
    const key = 'mk_alias-key-0123456789';
    const project = await seedPrivate(owner.user._id as Types.ObjectId, key);
    const res = await request(app).get(mockUrl(project.slug)).set('X-Mockia-Key', key);
    expect(res.status).toBe(200);
  });

  it.each([
    ['misma longitud', 'mk_wrong--key-0123456789'],
    ['distinta longitud (corta)', 'mk_x'],
    ['distinta longitud (larga)', `mk_${'a'.repeat(200)}`],
    ['prefijo de la clave', 'mk_correct-key'],
    ['vacia', ''],
  ])('clave incorrecta (%s) responde 401', async (_label, wrong) => {
    const owner = await createUser();
    const project = await seedPrivate(owner.user._id as Types.ObjectId, 'mk_correct-key-0123456789');
    const res = await request(app).get(mockUrl(project.slug)).set('X-Mockia-API-Key', wrong);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('la comparacion usa timingSafeEqual sobre digests de igual longitud (no revienta con longitudes distintas)', () => {
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    const stored = hashApiKey('mk_stored-key');
    expect(apiKeyMatches('mk_stored-key', stored)).toBe(true);
    expect(apiKeyMatches('x', stored)).toBe(false);
    expect(apiKeyMatches(`mk_${'z'.repeat(250)}`, stored)).toBe(false);
    expect(apiKeyMatches(undefined, stored)).toBe(false);
    expect(apiKeyMatches('mk_stored-key', null)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(3);
    for (const [a, b] of spy.mock.calls) expect((a as Buffer).length).toBe((b as Buffer).length);
    spy.mockRestore();
  });

  it('un proyecto "key" sin clave (revocada) no deja pasar a nadie', async () => {
    const owner = await createUser();
    const project = await seedProject(owner.user._id as Types.ObjectId, { visibility: 'key' });
    expect((await request(app).get(mockUrl(project.slug))).status).toBe(401);
    expect((await request(app).get(mockUrl(project.slug)).set('X-Mockia-API-Key', '')).status).toBe(401);
  });

  it('un proyecto publico (o antiguo, sin el campo) responde sin clave e ignora la cabecera', async () => {
    const owner = await createUser();
    const pub = await seedProject(owner.user._id as Types.ObjectId, { visibility: 'public' });
    const legacy = await seedProject(owner.user._id as Types.ObjectId);
    await ProjectModel.collection.updateOne({ _id: legacy._id }, { $unset: { visibility: '' } });
    mockCache.clearAll();
    expect((await request(app).get(mockUrl(pub.slug))).status).toBe(200);
    expect((await request(app).get(mockUrl(pub.slug)).set('X-Mockia-API-Key', 'whatever')).status).toBe(200);
    expect((await request(app).get(mockUrl(legacy.slug))).status).toBe(200);
  });

  it('el preflight CORS no exige la clave, permite la cabecera y no cuenta', async () => {
    const owner = await createUser();
    const project = await seedPrivate(owner.user._id as Types.ObjectId, 'mk_correct-key-0123456789');
    const res = await request(app)
      .options(mockUrl(project.slug))
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'x-mockia-api-key, x-mockia-key, content-type');
    expect(res.status).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-headers'].toLowerCase()).toEqual(expect.stringContaining('x-mockia-api-key'));
    expect(res.headers['access-control-allow-headers'].toLowerCase()).toEqual(expect.stringContaining('x-mockia-key'));
    expect(await getMonthlyUsage(owner.user._id.toString())).toBe(0);
  });

  it('las respuestas del mock exponen a los navegadores las cabeceras de limite', async () => {
    const owner = await createUser();
    const project = await seedProject(owner.user._id as Types.ObjectId);
    const res = await request(app).get(mockUrl(project.slug)).set('Origin', 'https://app.example.com');
    const exposed = String(res.headers['access-control-expose-headers']).toLowerCase();
    for (const h of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after']) expect(exposed).toContain(h);
  });
});

describe('cuota mensual de peticiones al mock', () => {
  const ownerIdOf = (o: { user: { _id: unknown } }) => String(o.user._id);

  it('las respuestas normales llevan X-RateLimit-Limit/Remaining/Reset y cada una descuenta una', async () => {
    const owner = await createUser();
    const project = await seedProject(owner.user._id as Types.ObjectId);
    const first = await request(app).get(mockUrl(project.slug));
    expect(first.status).toBe(200);
    expect(first.headers['x-ratelimit-limit']).toBe(String(FREE_LIMIT));
    expect(first.headers['x-ratelimit-remaining']).toBe(String(FREE_LIMIT - 1));
    const reset = Number(first.headers['x-ratelimit-reset']);
    expect(reset).toBe(Math.floor(nextPeriodStart(new Date()).getTime() / 1000));
    const second = await request(app).get(mockUrl(project.slug));
    expect(second.headers['x-ratelimit-remaining']).toBe(String(FREE_LIMIT - 2));
    expect(await getMonthlyUsage(ownerIdOf(owner))).toBe(2);
  });

  it('superado el tope del plan Free responde 429 con Retry-After y cabeceras, y no cuenta la rechazada', async () => {
    const owner = await createUser();
    const project = await seedProject(owner.user._id as Types.ObjectId);
    await UsageModel.create({ ownerId: owner.user._id, period: periodOf(new Date()), requests: FREE_LIMIT - 1 });

    const last = await request(app).get(mockUrl(project.slug));
    expect(last.status).toBe(200);
    expect(last.headers['x-ratelimit-remaining']).toBe('0');

    const over = await request(app).get(mockUrl(project.slug)).set('Origin', 'https://app.example.com');
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ success: false, error: { code: 'QUOTA_EXCEEDED' } });
    const now = Date.now();
    const retry = Number(over.headers['retry-after']);
    expect(retry).toBeGreaterThan(0);
    expect(Math.abs(retry - Math.ceil((nextPeriodStart(new Date()).getTime() - now) / 1000))).toBeLessThanOrEqual(5);
    expect(over.headers['x-ratelimit-limit']).toBe(String(FREE_LIMIT));
    expect(over.headers['x-ratelimit-remaining']).toBe('0');
    expect(over.headers['x-ratelimit-reset']).toBe(String(Math.floor(nextPeriodStart(new Date()).getTime() / 1000)));
    expect(over.headers['access-control-allow-origin']).toBe('*');
    expect(String(over.headers['access-control-expose-headers']).toLowerCase()).toContain('retry-after');

    await request(app).get(mockUrl(project.slug));
    expect(await getMonthlyUsage(ownerIdOf(owner))).toBe(FREE_LIMIT);
  });

  it('las peticiones rechazadas por cualquier motivo no cuentan (401, 404 de ruta, 404 de proyecto, OPTIONS)', async () => {
    const owner = await createUser();
    const key = 'mk_correct-key-0123456789';
    const priv = await seedPrivate(owner.user._id as Types.ObjectId, key);
    const pub = await seedProject(owner.user._id as Types.ObjectId);

    expect((await request(app).get(mockUrl(priv.slug))).status).toBe(401);
    expect((await request(app).get(mockUrl(priv.slug)).set('X-Mockia-API-Key', 'mk_wrong')).status).toBe(401);
    expect((await request(app).get(mockUrl(pub.slug, '/nope'))).status).toBe(404);
    expect((await request(app).post(mockUrl(pub.slug))).status).toBe(404);
    expect((await request(app).get(mockUrl('no-such-project'))).status).toBe(404);
    expect((await request(app).options(mockUrl(pub.slug)).set('Origin', 'https://x.test').set('Access-Control-Request-Method', 'GET')).status).toBeLessThan(300);
    expect(await getMonthlyUsage(ownerIdOf(owner))).toBe(0);

    expect((await request(app).get(mockUrl(priv.slug)).set('X-Mockia-API-Key', key)).status).toBe(200);
    expect(await getMonthlyUsage(ownerIdOf(owner))).toBe(1);
  });

  it('el contador se reinicia con un mes nuevo (reloj inyectado)', async () => {
    const owner = await createUser();
    const project = await seedProject(owner.user._id as Types.ObjectId);
    mockClock.now = () => new Date(Date.UTC(2031, 0, 20, 12));
    await UsageModel.create({ ownerId: owner.user._id, period: '2031-01', requests: FREE_LIMIT });
    const blocked = await request(app).get(mockUrl(project.slug));
    expect(blocked.status).toBe(429);
    expect(blocked.headers['x-ratelimit-reset']).toBe(String(Date.UTC(2031, 1, 1) / 1000));

    mockClock.now = () => new Date(Date.UTC(2031, 1, 1, 0, 0, 1));
    const fresh = await request(app).get(mockUrl(project.slug));
    expect(fresh.status).toBe(200);
    expect(fresh.headers['x-ratelimit-remaining']).toBe(String(FREE_LIMIT - 1));
    expect(fresh.headers['x-ratelimit-reset']).toBe(String(Date.UTC(2031, 2, 1) / 1000));
  });

  it('el propietario en Pro tiene el tope de Pro, no el de Free', async () => {
    const owner = await createUser({ plan: 'pro', billingStatus: 'active' });
    const project = await seedProject(owner.user._id as Types.ObjectId);
    await UsageModel.create({ ownerId: owner.user._id, period: periodOf(new Date()), requests: FREE_LIMIT + 5 });
    const res = await request(app).get(mockUrl(project.slug));
    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe(String(PRO_LIMIT));
    expect(res.headers['x-ratelimit-remaining']).toBe(String(PRO_LIMIT - FREE_LIMIT - 6));
  });

  it('se cuenta contra el propietario del proyecto, no contra quien llama', async () => {
    const owner = await createUser();
    const project = await seedProject(owner.user._id as Types.ObjectId);
    const stranger = await createUser();
    await request(app).get(mockUrl(project.slug)).set(stranger.auth);
    expect(await getMonthlyUsage(ownerIdOf(owner))).toBe(1);
    expect(await getMonthlyUsage(ownerIdOf(stranger))).toBe(0);
  });

  it('no escribe en Mongo en cada peticion: acumula y vuelca con un solo $inc', async () => {
    const owner = await createUser();
    const project = await seedProject(owner.user._id as Types.ObjectId);
    await request(app).get(mockUrl(project.slug)); // calienta caches
    const inc = jest.spyOn(UsageModel, 'findOneAndUpdate');
    const read = jest.spyOn(UsageModel, 'findOne');
    for (let i = 0; i < 5; i += 1) expect((await request(app).get(mockUrl(project.slug))).status).toBe(200);
    expect(inc).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    await flushUsage();
    expect(inc).toHaveBeenCalledTimes(1);
    expect(inc.mock.calls[0][1]).toEqual({ $inc: { requests: 6 } });
    inc.mockRestore();
    read.mockRestore();
  });
});

describe('gestion de la clave por la API', () => {
  async function createViaApi(auth: Record<string, string>) {
    const res = await request(app).post('/api/projects').set(auth).send({ title: unique('Mi API ') });
    expect(res.status).toBe(201);
    return res.body.data as { id: string; slug: string; [k: string]: unknown };
  }
  const seedEndpoint = async (projectId: string) => {
    const mockApi = await MockAPIModel.findOne({ projectId });
    const response = await ResponseModel.create({ statusCode: 200, description: 'ok', schema: { ok: true }, examples: [] });
    const endpoint = await EndpointModel.create({ path: '/users', method: 'GET', description: 'u', responses: [response._id], mockApiId: mockApi!._id });
    await MockAPIModel.updateOne({ _id: mockApi!._id }, { endpoints: [endpoint._id] });
  };

  it('un proyecto nuevo es publico, no trae clave y la API no devuelve ninguna', async () => {
    const owner = await createUser();
    const project = await createViaApi(owner.auth);
    expect(project).toMatchObject({ visibility: 'public', hasApiKey: false, apiKeyPrefix: null });
    expect(project).not.toHaveProperty('apiKey');
    expect(project).not.toHaveProperty('apiKeyHash');
    const raw = await rawProject(project.id);
    expect(raw?.apiKeyHash).toBeUndefined();
    expect(raw?.apiKey).toBeUndefined();
  });

  it('cambiar a "key" sin haber emitido clave responde 409 API_KEY_REQUIRED', async () => {
    const owner = await createUser();
    const project = await createViaApi(owner.auth);
    const res = await request(app).put(`/api/projects/${project.id}`).set(owner.auth).send({ visibility: 'key' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('API_KEY_REQUIRED');
    expect((await rawProject(project.id))?.visibility).not.toBe('key');
  });

  it('visibility solo acepta public o key', async () => {
    const owner = await createUser();
    const project = await createViaApi(owner.auth);
    const res = await request(app).put(`/api/projects/${project.id}`).set(owner.auth).send({ visibility: 'secret' });
    expect(res.status).toBe(400);
  });

  it('POST api-key devuelve la clave completa una vez y en la BD solo queda el hash', async () => {
    const owner = await createUser();
    const project = await createViaApi(owner.auth);
    const res = await request(app).post(`/api/projects/${project.id}/api-key`).set(owner.auth);
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    const { apiKey, prefix } = res.body.data as { apiKey: string; prefix: string };
    expect(apiKey).toMatch(/^mk_[0-9a-f]{48}$/);
    expect(apiKey.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThan(apiKey.length);

    const raw = await rawProject(project.id);
    expect(raw?.apiKeyHash).toBe(crypto.createHash('sha256').update(apiKey).digest('hex'));
    expect(raw?.apiKeyPrefix).toBe(prefix);
    expect(raw?.apiKey).toBeUndefined();
    expect(JSON.stringify(raw)).not.toContain(apiKey);
  });

  it('la clave completa no vuelve por GET proyecto, listado, exportacion ni exportacion RGPD', async () => {
    const owner = await createUser();
    const project = await createViaApi(owner.auth);
    const { apiKey, prefix } = (await request(app).post(`/api/projects/${project.id}/api-key`).set(owner.auth)).body.data;
    expect((await request(app).put(`/api/projects/${project.id}`).set(owner.auth).send({ visibility: 'key' })).status).toBe(200);

    const get = await request(app).get(`/api/projects/${project.id}`).set(owner.auth);
    expect(get.body.data).toMatchObject({ visibility: 'key', hasApiKey: true, apiKeyPrefix: prefix });
    const list = await request(app).get('/api/projects').set(owner.auth);
    const bodies = [JSON.stringify(get.body), JSON.stringify(list.body)];
    for (const format of ['openapi', 'postman', 'msw']) {
      const exp = await request(app).get(`/api/projects/${project.id}/export?format=${format}`).set(owner.auth);
      expect(exp.status).toBe(200);
      bodies.push(exp.text);
    }
    bodies.push(JSON.stringify(await exportUserData(String(owner.user._id))));
    for (const body of bodies) {
      expect(body).not.toContain(apiKey);
      expect(body).not.toContain(hashApiKey(apiKey));
    }
    // La exportacion sigue anunciando la cabecera de la clave
    const openapi = (await request(app).get(`/api/projects/${project.id}/export?format=openapi`).set(owner.auth)).body;
    expect(openapi.components.securitySchemes.MockiaApiKey.name).toBe('X-Mockia-API-Key');
  });

  it('flujo completo: clave + visibilidad key; sin clave 401, con clave 200; rotar invalida la anterior', async () => {
    const owner = await createUser();
    const project = await createViaApi(owner.auth);
    await seedEndpoint(project.id);
    const first = (await request(app).post(`/api/projects/${project.id}/api-key`).set(owner.auth)).body.data.apiKey as string;
    await request(app).put(`/api/projects/${project.id}`).set(owner.auth).send({ visibility: 'key' });

    expect((await request(app).get(mockUrl(project.slug))).status).toBe(401);
    expect((await request(app).get(mockUrl(project.slug)).set('X-Mockia-API-Key', first)).status).toBe(200);

    const second = (await request(app).post(`/api/projects/${project.id}/api-key`).set(owner.auth)).body.data.apiKey as string;
    expect(second).not.toBe(first);
    expect((await request(app).get(mockUrl(project.slug)).set('X-Mockia-API-Key', first)).status).toBe(401);
    expect((await request(app).get(mockUrl(project.slug)).set('X-Mockia-API-Key', second)).status).toBe(200);
  });

  it('volver a "public" abre el mock sin clave y conserva la clave emitida', async () => {
    const owner = await createUser();
    const project = await createViaApi(owner.auth);
    await seedEndpoint(project.id);
    await request(app).post(`/api/projects/${project.id}/api-key`).set(owner.auth);
    await request(app).put(`/api/projects/${project.id}`).set(owner.auth).send({ visibility: 'key' });
    expect((await request(app).get(mockUrl(project.slug))).status).toBe(401);
    const back = await request(app).patch(`/api/projects/${project.id}`).set(owner.auth).send({ visibility: 'public' });
    expect(back.status).toBe(200);
    expect(back.body.data).toMatchObject({ visibility: 'public', hasApiKey: true });
    expect((await request(app).get(mockUrl(project.slug))).status).toBe(200);
  });

  it('DELETE api-key revoca la clave: la anterior deja de valer y un mock "key" queda cerrado', async () => {
    const owner = await createUser();
    const project = await createViaApi(owner.auth);
    await seedEndpoint(project.id);
    const key = (await request(app).post(`/api/projects/${project.id}/api-key`).set(owner.auth)).body.data.apiKey as string;
    await request(app).put(`/api/projects/${project.id}`).set(owner.auth).send({ visibility: 'key' });

    const del = await request(app).delete(`/api/projects/${project.id}/api-key`).set(owner.auth);
    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ visibility: 'key', hasApiKey: false, apiKeyPrefix: null });
    const raw = await rawProject(project.id);
    expect(raw?.apiKeyHash ?? null).toBeNull();
    expect((await request(app).get(mockUrl(project.slug)).set('X-Mockia-API-Key', key)).status).toBe(401);
  });

  it('solo el propietario gestiona la clave: editor, lector y ajeno reciben 403; sin sesion 401', async () => {
    const owner = await createUser();
    const editor = await createUser();
    const viewer = await createUser();
    const stranger = await createUser();
    const project = await seedProject(owner.user._id as Types.ObjectId, {}, [
      { userId: editor.user._id as Types.ObjectId, role: ProjectRoleEnum.EDITOR },
      { userId: viewer.user._id as Types.ObjectId, role: ProjectRoleEnum.VIEWER },
    ]);
    const url = `/api/projects/${project._id}/api-key`;
    for (const who of [editor, viewer, stranger]) {
      expect((await request(app).post(url).set(who.auth)).status).toBe(403);
      expect((await request(app).delete(url).set(who.auth)).status).toBe(403);
    }
    expect((await request(app).post(url)).status).toBe(401);
    expect((await rawProject(project._id))?.apiKeyHash).toBeUndefined();
    expect((await request(app).post(url).set(owner.auth)).status).toBe(201);
  });

  it('un editor puede cambiar la visibilidad (como el resto de la edicion) si ya hay clave', async () => {
    const owner = await createUser();
    const editor = await createUser();
    const project = await seedProject(owner.user._id as Types.ObjectId, {}, [
      { userId: editor.user._id as Types.ObjectId, role: ProjectRoleEnum.EDITOR },
    ]);
    expect((await request(app).put(`/api/projects/${project._id}`).set(editor.auth).send({ visibility: 'key' })).status).toBe(409);
    await request(app).post(`/api/projects/${project._id}/api-key`).set(owner.auth);
    expect((await request(app).put(`/api/projects/${project._id}`).set(editor.auth).send({ visibility: 'key' })).status).toBe(200);
  });

  it('ya no existe la ruta antigua regenerate-api-key (devolvia la clave en claro)', async () => {
    const owner = await createUser();
    const project = await createViaApi(owner.auth);
    const res = await request(app).post(`/api/projects/${project.id}/regenerate-api-key`).set(owner.auth);
    expect(res.status).toBe(404);
  });
});

describe('migracion de claves antiguas en claro', () => {
  it('convierte apiKey en hash + prefijo, pasa el proyecto a "key" y la clave de siempre sigue valiendo', async () => {
    const owner = await createUser();
    const legacyKey = 'a'.repeat(24) + 'b'.repeat(24);
    const project = await seedProject(owner.user._id as Types.ObjectId);
    await ProjectModel.collection.updateOne({ _id: project._id }, { $set: { apiKey: legacyKey }, $unset: { visibility: '' } });
    const untouched = await seedProject(owner.user._id as Types.ObjectId);

    expect(await migrateLegacyApiKeys()).toBe(1);

    const raw = await rawProject(project._id);
    expect(raw?.apiKey).toBeUndefined();
    expect(raw?.apiKeyHash).toBe(hashApiKey(legacyKey));
    expect(raw?.apiKeyPrefix).toBe(legacyKey.slice(0, 8));
    expect(raw?.visibility).toBe('key');
    expect(JSON.stringify(raw)).not.toContain(legacyKey);
    expect((await rawProject(untouched._id))?.apiKeyHash).toBeUndefined();
    expect((await rawProject(untouched._id))?.visibility).toBe('public');

    mockCache.clearAll();
    expect((await request(app).get(mockUrl(project.slug))).status).toBe(401);
    expect((await request(app).get(mockUrl(project.slug)).set('X-Mockia-API-Key', legacyKey)).status).toBe(200);
  });

  it('es idempotente y no pisa una clave nueva ya emitida', async () => {
    const owner = await createUser();
    const project = await seedPrivate(owner.user._id as Types.ObjectId, 'mk_already-hashed-key-000');
    expect(await migrateLegacyApiKeys()).toBe(0);
    expect(await migrateLegacyApiKeys()).toBe(0);
    expect((await rawProject(project._id))?.apiKeyHash).toBe(hashApiKey('mk_already-hashed-key-000'));
  });

  it('ignora apiKey vacia o no textual sin romperse', async () => {
    const owner = await createUser();
    const empty = await seedProject(owner.user._id as Types.ObjectId);
    await ProjectModel.collection.updateOne({ _id: empty._id }, { $set: { apiKey: '' } });
    expect(await migrateLegacyApiKeys()).toBe(0);
    expect((await rawProject(empty._id))?.apiKey).toBeUndefined();
    expect((await rawProject(empty._id))?.visibility).toBe('public');
  });
});

describe('IDOR de swagger.json y pagina de docs', () => {
  it('swagger.json: sin sesion 401, no miembro 403, miembro 200, inexistente 404', async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const stranger = await createUser();
    const project = await seedProject(owner.user._id as Types.ObjectId, {}, [
      { userId: viewer.user._id as Types.ObjectId, role: ProjectRoleEnum.VIEWER },
    ]);
    const url = `/api/projects/${project._id}/swagger.json`;
    expect((await request(app).get(url)).status).toBe(401);
    const denied = await request(app).get(url).set(stranger.auth);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain('users');
    expect((await request(app).get(url).set(viewer.auth)).status).toBe(200);
    const ok = await request(app).get(url).set(owner.auth);
    expect(ok.status).toBe(200);
    expect(ok.body.paths).toBeDefined();
    expect((await request(app).get(`/api/projects/${new Types.ObjectId()}/swagger.json`).set(owner.auth)).status).toBe(404);
  });

  it('la pagina /mock/:slug/docs escapa o rechaza un slug hostil', async () => {
    const owner = await createUser();
    const hostile = `x</title><script>alert(1)</script>`;
    await seedProject(owner.user._id as Types.ObjectId).then((p) => ProjectModel.collection.updateOne({ _id: p._id }, { $set: { slug: hostile } }));
    const res = await request(app).get(`/mock/${encodeURIComponent(hostile)}/docs`);
    expect(res.text).not.toContain('<script>alert(1)');
    expect(res.text).not.toContain('</title><script>');
    expect([400, 404]).toContain(res.status);
  });

  it('la pagina /mock/:slug/docs de un proyecto normal sigue funcionando', async () => {
    const owner = await createUser();
    const project = await seedProject(owner.user._id as Types.ObjectId);
    const res = await request(app).get(`/mock/${project.slug}/docs`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`Swagger UI - ${project.slug}`);
    expect(res.text).toContain(`/api/projects/${project._id}/swagger.json`);
  });
});
