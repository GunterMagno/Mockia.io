import request from 'supertest';
import bcrypt from 'bcrypt';
import ts from 'typescript';
import SwaggerParser from '@apidevtools/swagger-parser';
import { Types } from 'mongoose';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { ProjectModel, ProjectRoleEnum } from '../models/Project.js';
import { EndpointModel, MockAPIModel, ResponseModel } from '../models/MockAPI.js';
import { EndpointConfigModel } from '../models/EndpointConfig.js';
import { exportOpenApi, exportPostman, exportMswHandlers } from '../modules/projects/export.js';

// Task 10: exportar los mocks de un proyecto a OpenAPI 3.1, coleccion Postman v2.1 y handlers MSW.
const PASSWORD = 'export-test-password-1';
const API_KEY = 'secret-export-api-key-abc123';

async function createUser(email: string) {
  return UserModel.create({ email, username: email.split('@')[0], passwordHash: await bcrypt.hash(PASSWORD, 10) });
}

async function login(email: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.data.tokens.accessToken as string}` };
}

interface SeedEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  description?: string;
  requestSchema?: Record<string, unknown>;
  responses: Array<{ statusCode: number; schema?: unknown; name?: string; description?: string }>;
  config?: Record<string, unknown>;
}

async function seedProject(
  ownerId: Types.ObjectId,
  slug: string,
  endpoints: SeedEndpoint[],
  extra: Record<string, unknown> = {}
) {
  const project = await ProjectModel.create({
    title: `Project ${slug}`,
    description: `Description of ${slug}`,
    slug,
    ownerId,
    members: [{ userId: ownerId, role: ProjectRoleEnum.OWNER, addedAt: new Date() }],
    apiKey: `${API_KEY}-${slug}`,
    ...extra,
  });
  const mockApi = await MockAPIModel.create({ projectId: project._id, title: `Api ${slug}`, apiVersion: '2.3.0' });
  const ids: Types.ObjectId[] = [];
  for (const ep of endpoints) {
    const responseIds: Types.ObjectId[] = [];
    for (const r of ep.responses) {
      const doc = await ResponseModel.create({
        statusCode: r.statusCode,
        name: r.name,
        description: r.description ?? `${ep.method} ${ep.path} ${r.statusCode}`,
        schema: r.schema === undefined ? null : r.schema,
        examples: [],
      });
      responseIds.push(doc._id as Types.ObjectId);
    }
    const endpoint = await EndpointModel.create({
      path: ep.path,
      method: ep.method,
      description: ep.description ?? `${ep.method} ${ep.path}`,
      requestSchema: ep.requestSchema ?? {},
      responses: responseIds,
      mockApiId: mockApi._id,
    });
    ids.push(endpoint._id as Types.ObjectId);
    if (ep.config) await EndpointConfigModel.create({ endpointId: endpoint._id, ...ep.config });
  }
  await MockAPIModel.updateOne({ _id: mockApi._id }, { endpoints: ids });
  return project;
}

const USER = { id: 1, name: 'Ana', email: 'ana@example.com' };
const ROUTES: SeedEndpoint[] = [
  {
    method: 'GET',
    path: '/users',
    description: 'List users',
    responses: [{ statusCode: 200, schema: [USER, { ...USER, id: 2 }] }],
    config: { delay_ms: 150 },
  },
  {
    method: 'GET',
    path: '/users/:id',
    description: 'Get a user',
    responses: [
      { statusCode: 200, schema: USER },
      { statusCode: 404, schema: { error: 'Not Found', message: 'No such user' } },
    ],
  },
  {
    method: 'POST',
    path: '/users',
    description: 'Create a user',
    requestSchema: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } } },
    responses: [{ statusCode: 201, schema: USER }],
  },
  {
    method: 'DELETE',
    path: '/users/:id',
    description: 'Delete a user',
    responses: [
      { statusCode: 204, schema: null },
      { statusCode: 404, schema: { error: 'Not Found' } },
    ],
  },
  {
    method: 'GET',
    path: '/users/:userId/posts/:postId',
    responses: [{ statusCode: 200, schema: { id: 7, title: 'Hello' } }],
    config: { headers: { 'X-Total-Count': '42' } },
  },
];

const ROUTE_KEYS = ['GET /users', 'GET /users/:id', 'POST /users', 'DELETE /users/:id', 'GET /users/:userId/posts/:postId'];

/** Transpila el TS generado a CommonJS y lo ejecuta contra un `msw` de pega que captura los handlers. */
async function loadMswHandlers(code: string) {
  const out = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const delays: number[] = [];
  const registered: Array<{ method: string; path: string; resolver: (info: unknown) => Promise<Response> | Response }> = [];
  class HttpResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  }
  const mk = (method: string) => (path: string, resolver: never) => {
    registered.push({ method, path, resolver });
    return { method, path };
  };
  const fakeMsw = {
    http: { get: mk('GET'), post: mk('POST'), put: mk('PUT'), delete: mk('DELETE'), patch: mk('PATCH') },
    HttpResponse,
    delay: async (ms?: number) => {
      delays.push(ms ?? -1);
    },
  };
  const module = { exports: {} as Record<string, unknown> };
  new Function('require', 'module', 'exports', out.outputText)((id: string) => {
    if (id !== 'msw') throw new Error(`unexpected import ${id}`);
    return fakeMsw;
  }, module, module.exports);
  expect(Array.isArray(module.exports.handlers)).toBe(true);
  return { registered, delays };
}

function syntaxErrors(code: string): string[] {
  const out = ts.transpileModule(code, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

describe('Projects - export (OpenAPI / Postman / MSW)', () => {
  let ownerAuth: { Authorization: string };
  let editorAuth: { Authorization: string };
  let viewerAuth: { Authorization: string };
  let outsiderAuth: { Authorization: string };
  let project: Awaited<ReturnType<typeof seedProject>>;
  let emptyProject: Awaited<ReturnType<typeof seedProject>>;
  let weirdProject: Awaited<ReturnType<typeof seedProject>>;

  const WEIRD_TITLE = 'Q"uote `tick` ${evil} \\ 😀 </script>\nfetch("pwn")//*/ 日本語';
  const WEIRD_BODY = {
    msg: 'a "quote" \'single\' `tick` ${process.exit(1)} </script><img src=x onerror=1> \\ \u2028 \u2029 日本語 😀',
    nested: { 'key"with`weird${chars': ['`${x}`', 'line1\nline2', 'tab\t'] },
  };

  beforeAll(async () => {
    await connectDB();
    await UserModel.deleteMany({});
    await ProjectModel.deleteMany({});
    await MockAPIModel.deleteMany({});
    await EndpointModel.deleteMany({});
    await ResponseModel.deleteMany({});
    await EndpointConfigModel.deleteMany({});
    const owner = await createUser('owner-exp@example.com');
    const editor = await createUser('editor-exp@example.com');
    const viewer = await createUser('viewer-exp@example.com');
    await createUser('outsider-exp@example.com');
    project = await seedProject(owner._id as Types.ObjectId, 'shop-api', ROUTES, {
      members: [
        { userId: owner._id, role: ProjectRoleEnum.OWNER, addedAt: new Date() },
        { userId: editor._id, role: ProjectRoleEnum.EDITOR, addedAt: new Date() },
        { userId: viewer._id, role: ProjectRoleEnum.VIEWER, addedAt: new Date() },
      ],
    });
    emptyProject = await seedProject(owner._id as Types.ObjectId, 'empty-api', []);
    weirdProject = await seedProject(
      owner._id as Types.ObjectId,
      'weird-api',
      [
        {
          method: 'GET',
          path: '/it\'s/"q"/`t`/${x}/:id',
          description: 'Weird </script> `desc` ${x}\nline2',
          responses: [{ statusCode: 200, schema: WEIRD_BODY }],
        },
        {
          method: 'POST',
          path: '/weird',
          requestSchema: { $ref: '#/components/schemas/Missing', type: 'object', properties: { a: { $ref: '#/nope' } } },
          responses: [{ statusCode: 201, schema: { ok: true } }, { statusCode: 400, schema: WEIRD_BODY }],
        },
      ],
      { title: WEIRD_TITLE, description: 'desc `${x}` </script>' }
    );
    ownerAuth = await login('owner-exp@example.com');
    editorAuth = await login('editor-exp@example.com');
    viewerAuth = await login('viewer-exp@example.com');
    outsiderAuth = await login('outsider-exp@example.com');
  });

  afterAll(async () => {
    await disconnectDB();
  });

  describe('exportOpenApi', () => {
    it('produces a valid OpenAPI 3.1 document with every route, server and path parameters', async () => {
      const doc = (await exportOpenApi(project.id)) as any;
      await expect(SwaggerParser.validate(JSON.parse(JSON.stringify(doc)))).resolves.toBeDefined();

      expect(doc.openapi).toBe('3.1.0');
      expect(doc.info).toMatchObject({ title: 'Project shop-api', version: '2.3.0', description: 'Description of shop-api' });
      expect(doc.servers).toHaveLength(1);
      expect(doc.servers[0].url).toMatch(/^https?:\/\/[^/]+(:\d+)?\/api\/mock\/shop-api$/);

      expect(Object.keys(doc.paths).sort()).toEqual(['/users', '/users/{id}', '/users/{userId}/posts/{postId}']);
      expect(Object.keys(doc.paths['/users']).sort()).toEqual(['get', 'post']);
      expect(Object.keys(doc.paths['/users/{id}']).sort()).toEqual(['delete', 'get']);

      expect(doc.paths['/users/{id}'].get.parameters).toEqual([{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]);
      expect(doc.paths['/users/{userId}/posts/{postId}'].get.parameters.map((p: any) => p.name)).toEqual(['userId', 'postId']);
      expect(doc.paths['/users'].get.parameters).toBeUndefined();
    });

    it('lists every stored status with its example body, and omits content for 204', async () => {
      const doc = (await exportOpenApi(project.id)) as any;
      const get = doc.paths['/users/{id}'].get.responses;
      expect(Object.keys(get).sort()).toEqual(['200', '404']);
      expect(get['200'].content['application/json'].examples.example_1.value).toEqual(USER);
      expect(get['200'].content['application/json'].schema).toMatchObject({ type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } });
      expect(get['404'].content['application/json'].examples.example_1.value).toEqual({ error: 'Not Found', message: 'No such user' });

      const del = doc.paths['/users/{id}'].delete.responses;
      expect(Object.keys(del).sort()).toEqual(['204', '404']);
      expect(del['204'].content).toBeUndefined();
      expect(del['204'].description).toBeTruthy();

      expect(doc.paths['/users'].get.responses['200'].content['application/json'].schema).toMatchObject({ type: 'array' });
    });

    it('documents the request body of a POST and unique operationIds', async () => {
      const doc = (await exportOpenApi(project.id)) as any;
      const post = doc.paths['/users'].post;
      expect(post.requestBody.content['application/json'].schema).toMatchObject({ type: 'object', properties: { age: { type: 'integer' } } });
      expect(post.requestBody.content['application/json'].example).toEqual({ name: 'string', age: 0 });
      const ids = Object.values(doc.paths).flatMap((p: any) => Object.values(p).map((op: any) => op.operationId));
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(ROUTE_KEYS.length);
    });

    it('declares the API key header but never leaks its value', async () => {
      const doc = await exportOpenApi(project.id);
      const text = JSON.stringify(doc);
      expect(text).not.toContain(API_KEY);
      expect((doc as any).components.securitySchemes.MockiaApiKey).toEqual({ type: 'apiKey', in: 'header', name: 'X-Mockia-API-Key' });
    });

    it('exports a valid empty document for a project without endpoints', async () => {
      const doc = (await exportOpenApi(emptyProject.id)) as any;
      await expect(SwaggerParser.validate(JSON.parse(JSON.stringify(doc)))).resolves.toBeDefined();
      expect(doc.paths).toEqual({});
    });

    it('exports a project that has no MockAPI at all', async () => {
      const owner = await UserModel.findOne({ email: 'owner-exp@example.com' });
      const bare = await ProjectModel.create({
        title: 'Bare', slug: 'bare-api', ownerId: owner!._id,
        members: [{ userId: owner!._id, role: ProjectRoleEnum.OWNER, addedAt: new Date() }],
      });
      const doc = (await exportOpenApi(bare.id)) as any;
      await expect(SwaggerParser.validate(JSON.parse(JSON.stringify(doc)))).resolves.toBeDefined();
      expect(doc.paths).toEqual({});
      expect(doc.components).toBeUndefined();
    });

    it('rejects an unknown project', async () => {
      await expect(exportOpenApi(new Types.ObjectId().toString())).rejects.toMatchObject({ statusCode: 404 });
    });

    it('survives special characters in title, paths, bodies and a hostile requestSchema', async () => {
      const doc = (await exportOpenApi(weirdProject.id)) as any;
      await expect(SwaggerParser.validate(JSON.parse(JSON.stringify(doc)))).resolves.toBeDefined();
      expect(doc.info.title).toBe(WEIRD_TITLE);
      expect(Object.keys(doc.paths)).toContain('/it\'s/"q"/`t`/${x}/{id}');
      const body = doc.paths['/it\'s/"q"/`t`/${x}/{id}'].get.responses['200'].content['application/json'].examples.example_1.value;
      expect(body).toEqual(WEIRD_BODY);
      expect(JSON.stringify(doc.paths['/weird'].post.requestBody)).not.toContain('$ref');
    });
  });

  describe('exportPostman', () => {
    it('is a v2.1 collection with every request, the baseUrl variable and example responses', async () => {
      const col = (await exportPostman(project.id)) as any;
      expect(col.info.schema).toBe('https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
      expect(col.info.name).toBe('Project shop-api');
      expect(col.info._postman_id).toMatch(/^[0-9a-f-]{36}$/);

      const baseUrl = col.variable.find((v: any) => v.key === 'baseUrl');
      expect(baseUrl.value).toMatch(/\/api\/mock\/shop-api$/);
      expect(col.variable.find((v: any) => v.key === 'apiKey')).toMatchObject({ value: '' });

      const keys = col.item.map((i: any) => `${i.request.method} /${i.request.url.path.join('/')}`);
      expect(keys.sort()).toEqual([...ROUTE_KEYS].sort());

      const getUser = col.item.find((i: any) => i.request.method === 'GET' && i.request.url.path.join('/') === 'users/:id');
      expect(getUser.request.url.raw).toBe('{{baseUrl}}/users/:id');
      expect(getUser.request.url.host).toEqual(['{{baseUrl}}']);
      expect(getUser.request.url.variable).toEqual([expect.objectContaining({ key: 'id' })]);
      expect(getUser.request.header).toEqual(expect.arrayContaining([{ key: 'X-Mockia-API-Key', value: '{{apiKey}}' }]));
      expect(getUser.response.map((r: any) => r.code)).toEqual([200, 404]);
      expect(JSON.parse(getUser.response[0].body)).toEqual(USER);
      expect(getUser.response[1].status).toBe('Not Found');

      const post = col.item.find((i: any) => i.request.method === 'POST');
      expect(post.request.body.mode).toBe('raw');
      expect(JSON.parse(post.request.body.raw)).toEqual({ name: 'string', age: 0 });
      expect(post.request.body.options.raw.language).toBe('json');
    });

    it('never leaks the API key and exports an empty collection for an empty project', async () => {
      expect(JSON.stringify(await exportPostman(project.id))).not.toContain(API_KEY);
      const col = (await exportPostman(emptyProject.id)) as any;
      expect(col.item).toEqual([]);
      expect(col.info.schema).toContain('v2.1.0');
    });

    it('survives special characters', async () => {
      const col = (await exportPostman(weirdProject.id)) as any;
      expect(JSON.parse(JSON.stringify(col)).info.name).toBe(WEIRD_TITLE);
      const weird = col.item.find((i: any) => i.request.method === 'GET');
      expect(JSON.parse(weird.response[0].body)).toEqual(WEIRD_BODY);
    });
  });

  describe('exportMswHandlers', () => {
    it('compiles (syntax) and registers every route with MSW v2 syntax', async () => {
      const code = await exportMswHandlers(project.id);
      expect(syntaxErrors(code)).toEqual([]);
      expect(code).toContain("from 'msw'");
      expect(code).toMatch(/import \{[^}]*\bhttp\b[^}]*\bHttpResponse\b[^}]*\} from 'msw'/);

      const { registered } = await loadMswHandlers(code);
      expect(registered.map((r) => `${r.method} ${r.path}`).sort()).toEqual([...ROUTE_KEYS].sort());
      expect(code).not.toContain(API_KEY);
    });

    it('typechecks against the real msw types when msw is installed', async () => {
      let mswDir: string | null = null;
      try {
        mswDir = require.resolve('msw/package.json');
      } catch {
        // msw is not a dependency of this repo: the syntax check above is the guarantee in that case.
        return;
      }
      const code = await exportMswHandlers(project.id);
      const host = ts.createCompilerHost({});
      const file = 'handlers.ts';
      const original = host.getSourceFile.bind(host);
      host.getSourceFile = (name, lang, ...rest) =>
        name === file ? ts.createSourceFile(name, code, lang) : original(name, lang, ...rest);
      host.fileExists = ((orig) => (n: string) => n === file || orig(n))(host.fileExists.bind(host));
      host.readFile = ((orig) => (n: string) => (n === file ? code : orig(n)))(host.readFile.bind(host));
      const program = ts.createProgram([file], { noEmit: true, strict: true, skipLibCheck: true, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], baseUrl: mswDir.replace(/[\\/]msw[\\/]package\.json$/, '') }, host);
      const diags = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      expect(diags).toEqual([]);
    });

    it('answers like the mock: default response, null body for 204, delay, headers and ?_status variants', async () => {
      const { registered, delays } = await loadMswHandlers(await exportMswHandlers(project.id));
      const call = async (method: string, path: string, url: string, params: Record<string, string> = {}, headers: Record<string, string> = {}) => {
        const h = registered.find((r) => r.method === method && r.path === path)!;
        return h.resolver({ request: new Request(url, { headers }), params });
      };

      const list = await call('GET', '/users', 'http://localhost/users');
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual([USER, { ...USER, id: 2 }]);
      expect(delays).toEqual([150]);

      const one = await call('GET', '/users/:id', 'http://localhost/users/1', { id: '1' });
      expect(one.status).toBe(200);
      expect(await one.json()).toEqual(USER);

      const missing = await call('GET', '/users/:id', 'http://localhost/users/1?_status=404', { id: '1' });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: 'Not Found', message: 'No such user' });
      const byHeader = await call('GET', '/users/:id', 'http://localhost/users/1', { id: '1' }, { 'x-mockia-response-status': '404' });
      expect(byHeader.status).toBe(404);

      const del = await call('DELETE', '/users/:id', 'http://localhost/users/1', { id: '1' });
      expect(del.status).toBe(204);
      expect(await del.text()).toBe('');
      const delMissing = await call('DELETE', '/users/:id', 'http://localhost/users/1?_status=404', { id: '1' });
      expect(delMissing.status).toBe(404);

      const created = await call('POST', '/users', 'http://localhost/users');
      expect(created.status).toBe(201);

      const nested = await call('GET', '/users/:userId/posts/:postId', 'http://localhost/users/1/posts/7');
      expect(nested.headers.get('x-total-count')).toBe('42');
    });

    it('applies force_status_code, override_response and jitter of the endpoint config like the mock engine', async () => {
      const owner = await UserModel.findOne({ email: 'owner-exp@example.com' });
      const cfgProject = await seedProject(owner!._id as Types.ObjectId, 'cfg-api', [
        { method: 'GET', path: '/forced', responses: [{ statusCode: 200, schema: { ok: true } }], config: { force_status_code: 500 } },
        { method: 'GET', path: '/gone', responses: [{ statusCode: 200, schema: { ok: true } }], config: { force_status_code: 204 } },
        { method: 'GET', path: '/over', responses: [{ statusCode: 200, schema: { ok: true } }], config: { override_response: { custom: 1 } } },
        { method: 'GET', path: '/jit', responses: [{ statusCode: 200, schema: {} }], config: { delay_ms: 100, jitter_ms: 40 } },
      ]);
      const code = await exportMswHandlers(cfgProject.id);
      expect(syntaxErrors(code)).toEqual([]);
      const { registered, delays } = await loadMswHandlers(code);
      const call = (path: string) => registered.find((r) => r.path === path)!.resolver({ request: new Request(`http://localhost${path}`), params: {} });
      const forced = await call('/forced');
      expect(forced.status).toBe(500);
      expect(((await forced.json()) as { error: string }).error).toBe('Internal Server Error');
      const gone = await call('/gone');
      expect(gone.status).toBe(204);
      expect(await gone.text()).toBe('');
      expect(await (await call('/over')).json()).toEqual({ custom: 1 });
      await call('/jit');
      expect(delays).toHaveLength(1);
      expect(delays[0]).toBeGreaterThanOrEqual(60);
      expect(delays[0]).toBeLessThanOrEqual(140);
    });

    it('exports a compilable file with no handlers for an empty project', async () => {
      const code = await exportMswHandlers(emptyProject.id);
      expect(syntaxErrors(code)).toEqual([]);
      const { registered } = await loadMswHandlers(code);
      expect(registered).toEqual([]);
    });

    it('escapes hostile strings: no code injection from titles, descriptions, paths or bodies', async () => {
      const code = await exportMswHandlers(weirdProject.id);
      expect(syntaxErrors(code)).toEqual([]);
      // the newline in the title must not terminate the comment and leave `fetch("pwn")` as code
      expect(code.split('\n').some((l) => l.trimStart().startsWith('fetch('))).toBe(false);
      expect(code).not.toContain('</script>');

      const { registered } = await loadMswHandlers(code);
      expect(registered.map((r) => `${r.method} ${r.path}`).sort()).toEqual(['GET /it\'s/"q"/`t`/${x}/:id', 'POST /weird']);
      const weird = registered.find((r) => r.method === 'GET')!;
      const res = await weird.resolver({ request: new Request('http://localhost/x'), params: {} });
      expect(await res.json()).toEqual(WEIRD_BODY);
      const bad = await weird.resolver({ request: new Request('http://localhost/x?_status=200'), params: {} });
      expect(bad.status).toBe(200);
    });
  });

  describe('GET /api/projects/:id/export', () => {
    const get = (id: string, format: string | undefined, auth?: { Authorization: string }) => {
      const req = request(app).get(`/api/projects/${id}/export`).query(format === undefined ? {} : { format });
      return auth ? req.set(auth) : req;
    };

    it('requires authentication', async () => {
      expect((await get(project.id, 'openapi')).status).toBe(401);
    });

    it('rejects a non-member and an unknown project the way other project routes do', async () => {
      expect((await get(project.id, 'openapi', outsiderAuth)).status).toBe(403);
      expect((await get(new Types.ObjectId().toString(), 'openapi', ownerAuth)).status).toBe(404);
    });

    it('rejects a missing or unknown format with 400', async () => {
      expect((await get(project.id, 'swagger', ownerAuth)).status).toBe(400);
      expect((await get(project.id, undefined, ownerAuth)).status).toBe(400);
      expect((await get(project.id, '', ownerAuth)).status).toBe(400);
    });

    it('lets owner, editor and viewer export OpenAPI as a JSON attachment', async () => {
      for (const auth of [ownerAuth, editorAuth, viewerAuth]) {
        const res = await get(project.id, 'openapi', auth);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/^application\/json/);
        expect(res.headers['content-disposition']).toBe('attachment; filename="shop-api-openapi.json"');
        expect(res.headers['cache-control']).toBe('no-store');
        const doc = JSON.parse(res.text);
        expect(doc.openapi).toBe('3.1.0');
        await SwaggerParser.validate(doc);
      }
    });

    it('serves Postman and MSW with the right content type and filename', async () => {
      const postman = await get(project.id, 'postman', viewerAuth);
      expect(postman.status).toBe(200);
      expect(postman.headers['content-type']).toMatch(/^application\/json/);
      expect(postman.headers['content-disposition']).toBe('attachment; filename="shop-api.postman_collection.json"');
      expect(JSON.parse(postman.text).info.schema).toContain('v2.1.0');

      const msw = await get(project.id, 'msw', viewerAuth);
      expect(msw.status).toBe(200);
      expect(msw.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(msw.headers['content-disposition']).toBe('attachment; filename="shop-api-handlers.ts"');
      expect(msw.text).toContain('http.get');
    });

    it('accepts the project slug like the other project routes', async () => {
      const res = await get('shop-api', 'openapi', ownerAuth);
      expect(res.status).toBe(200);
    });

    it('is not gated by email verification and is rate limited per user', async () => {
      const user = await createUser('limited-exp@example.com');
      await ProjectModel.updateOne({ _id: project._id }, { $push: { members: { userId: user._id, role: ProjectRoleEnum.VIEWER, addedAt: new Date() } } });
      const auth = await login('limited-exp@example.com');
      let last = 0;
      for (let i = 0; i < 31; i++) last = (await get(project.id, 'msw', auth)).status;
      expect(last).toBe(429);
      // another user keeps working
      expect((await get(project.id, 'msw', ownerAuth)).status).toBe(200);
    });
  });
});
