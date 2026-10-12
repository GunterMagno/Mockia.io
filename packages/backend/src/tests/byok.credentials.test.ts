/**
 * K3 - AI credentials of the user (BYOK): model, presets and the /api/ai-credentials management API.
 *
 * What these tests pin, beyond the happy path (Review Focus 1 and 3 of the plan):
 *  - the API key is NEVER returned, logged, stored in the clear, written in a notification or put in an email;
 *  - user B holding the id of user A's credential gets 404 on PATCH/DELETE and never sees it in a list;
 *  - with a preset the client's base URL is ignored; custom URLs are off unless BYOK_ALLOW_CUSTOM_URLS=true and then
 *    obey the SSRF policy of K2;
 *  - the key is checked against the provider before anything is saved (a refusal saves nothing).
 *
 * Providers are a local HTTPS server with a throw-away certificate reached through K2's test-only `testDialOverride`
 * (see byokTlsFake.ts): no real provider and no real key is ever contacted.
 */
import request from 'supertest';
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { AI_PROVIDER_PRESETS, NotificationType } from '@mockia/shared';
import app from '../index.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { NotificationModel } from '../models/Notification.js';
import { AiCredentialModel } from '../models/AiCredential.js';
import { generateKeyEntry, loadKeyring, open } from '../modules/byok/crypto.js';
import { createSafeFetch } from '../modules/byok/safeHttp.js';
import { setProviderFetchForTests } from '../modules/byok/service.js';
import { clearTestOutbox, getTestOutbox, renderMail } from '../services/mailer.js';
import { closedPort, startTlsFake, type FakeHandler, type TlsFake } from './byokTlsFake.js';

const PASSWORD = 'byok-test-password-1';
const CSRF = { 'X-Requested-With': 'mockia' };
const PUBLIC = { address: '93.184.216.34', family: 4 };
const HOSTS = [
  'api.openai.com',
  'openrouter.ai',
  'api.groq.com',
  'api.mistral.ai',
  'api.together.ai',
  'llm.example.com',
  'rebind.example.com',
];

/** A throw-away key sentinel: never a real key, different on every call, long enough to be searched for. */
const newKey = () => `sk-test-${randomBytes(18).toString('hex')}`;

let emailCounter = 0;
async function createUser(extra: Record<string, unknown> = {}) {
  emailCounter += 1;
  const email = `byok${emailCounter}-${randomBytes(3).toString('hex')}@example.com`;
  const user = await UserModel.create({
    email,
    username: `byok${emailCounter}${randomBytes(2).toString('hex')}`,
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    locale: 'es',
    emailVerifiedAt: new Date(),
    ...extra,
  });
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const auth = { Authorization: `Bearer ${res.body.data.tokens.accessToken as string}` };
  return { id: user._id.toString(), email, auth };
}

type Actor = Awaited<ReturnType<typeof createUser>>;

const goodBody = (apiKey: string, over: Record<string, unknown> = {}) => ({
  label: 'Mi clave',
  preset: 'openai',
  model: 'gpt-4o-mini',
  apiKey,
  ...over,
});

const create = (actor: Actor, body: Record<string, unknown>) =>
  request(app).post('/api/ai-credentials').set(actor.auth).set(CSRF).send(body);

describe('AI credentials (BYOK) - /api/ai-credentials', () => {
  let fake: TlsFake;
  let acceptedKeys: Set<string>;
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'BYOK_ENABLED',
    'BYOK_KEYS',
    'BYOK_ALLOW_CUSTOM_URLS',
    'REQUIRE_EMAIL_VERIFICATION',
  ];

  /** The well-behaved provider: accepts the keys in `acceptedKeys`, answers 401 (quoting the key, as real ones do) to the rest. */
  const defaultProvider: FakeHandler = (req, res) => {
    const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    res.setHeader('Content-Type', 'application/json');
    if (acceptedKeys.has(bearer)) {
      res.end(JSON.stringify({ data: [{ id: 'some-model' }] }));
    } else {
      // Real providers often quote the key they were given: it must never travel any further than this response
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${bearer}` } }));
    }
  };

  /** Routes the server's provider calls to the local TLS fake (the address policy still runs on the fake lookup). */
  const useFake = (port: number = fake.port) =>
    setProviderFetchForTests(
      createSafeFetch({
        lookup: async (host) =>
          host === 'rebind.example.com' ? [{ address: '127.0.0.1', family: 4 }] : [PUBLIC],
        testDialOverride: { port, ca: fake.ca },
      })
    );

  beforeAll(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.BYOK_ENABLED = 'true';
    process.env.BYOK_KEYS = generateKeyEntry('k1');
    delete process.env.BYOK_ALLOW_CUSTOM_URLS;
    delete process.env.REQUIRE_EMAIL_VERIFICATION;
    await connectDB();
    await AiCredentialModel.init();
    acceptedKeys = new Set();
    fake = await startTlsFake(HOSTS, defaultProvider);
  });

  afterAll(async () => {
    setProviderFetchForTests(undefined);
    await fake.close();
    await AiCredentialModel.deleteMany({});
    await UserModel.deleteMany({ email: /^byok\d+-/ });
    await NotificationModel.deleteMany({});
    await disconnectDB();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  beforeEach(async () => {
    process.env.BYOK_ENABLED = 'true';
    delete process.env.BYOK_ALLOW_CUSTOM_URLS;
    delete process.env.REQUIRE_EMAIL_VERIFICATION;
    acceptedKeys.clear();
    fake.setHandler(defaultProvider);
    fake.seen.length = 0;
    useFake();
    clearTestOutbox();
    await AiCredentialModel.deleteMany({});
    await NotificationModel.deleteMany({});
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(a) create with a preset', () => {
    it('201 with metadata only; the list shows last4; the key is nowhere (response, list, stored document)', async () => {
      const alice = await createUser();
      const key = newKey();
      acceptedKeys.add(key);

      const res = await create(alice, goodBody(key));

      expect(res.status).toBe(201);
      expect(res.headers['cache-control']).toMatch(/no-store/);
      expect(Object.keys(res.body.data).sort()).toEqual(
        ['createdAt', 'id', 'label', 'last4', 'model', 'preset'].sort()
      );
      expect(res.body.data).toMatchObject({
        label: 'Mi clave',
        preset: 'openai',
        model: 'gpt-4o-mini',
        last4: key.slice(-4),
      });
      expect(res.text).not.toContain(key);
      expect(res.text).not.toMatch(/sealed/i);

      // the key was checked against the provider with GET {baseUrl}/models, carrying the key as a bearer token
      expect(fake.seen).toHaveLength(1);
      expect(fake.seen[0].method).toBe('GET');
      expect(fake.seen[0].url).toBe('/v1/models');
      expect(fake.seen[0].headers.authorization).toBe(`Bearer ${key}`);
      expect(fake.seen[0].headers.host).toBe('api.openai.com');

      const list = await request(app).get('/api/ai-credentials').set(alice.auth);
      expect(list.status).toBe(200);
      expect(list.headers['cache-control']).toMatch(/no-store/);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({ id: res.body.data.id, last4: key.slice(-4) });
      expect(list.text).not.toContain(key);

      // at rest: only the sealed record, never the key (not even a fragment longer than last4)
      const stored = await AiCredentialModel.collection.findOne({});
      const raw = JSON.stringify(stored);
      expect(raw).not.toContain(key);
      expect(raw).not.toContain(key.slice(-8));
      expect(stored?.sealed).toEqual(
        expect.objectContaining({ v: 1, kid: 'k1', iv: expect.any(String), ct: expect.any(String) })
      );
      expect(stored?.userId.toString()).toBe(alice.id);
    });

    it('seals with AAD userId|credId|baseUrl (the id exists BEFORE sealing)', async () => {
      const alice = await createUser();
      const key = newKey();
      acceptedKeys.add(key);
      const res = await create(alice, goodBody(key, { preset: 'groq' }));
      expect(res.status).toBe(201);

      const stored = await AiCredentialModel.findById(res.body.data.id).lean();
      const baseUrl = AI_PROVIDER_PRESETS.groq.baseUrl;
      expect(stored?.baseUrl).toBe(baseUrl);
      const ring = loadKeyring();
      expect(open(stored!.sealed, `${alice.id}|${res.body.data.id}|${baseUrl}`, ring)).toBe(key);
      // moved to another user, credential or host it no longer opens
      expect(() =>
        open(stored!.sealed, `${new Types.ObjectId()}|${res.body.data.id}|${baseUrl}`, ring)
      ).toThrow();
      expect(() =>
        open(stored!.sealed, `${alice.id}|${new Types.ObjectId()}|${baseUrl}`, ring)
      ).toThrow();
      expect(() =>
        open(stored!.sealed, `${alice.id}|${res.body.data.id}|https://evil.example.com/v1`, ring)
      ).toThrow();
    });

    it.each([
      ['openai', '/v1/models', 'api.openai.com'],
      // OpenRouter lists /models WITHOUT a key (200 for anyone), so it cannot tell a good key from a bad one: /key can
      ['openrouter', '/api/v1/key', 'openrouter.ai'],
      ['groq', '/openai/v1/models', 'api.groq.com'],
      ['mistral', '/v1/models', 'api.mistral.ai'],
      ['together', '/v1/models', 'api.together.ai'],
    ])('preset %s: stored URL and verification request', async (preset, urlPath, host) => {
      const alice = await createUser();
      const key = newKey();
      acceptedKeys.add(key);
      const res = await create(alice, goodBody(key, { preset }));
      expect(res.status).toBe(201);
      expect(fake.seen[0].url).toBe(urlPath);
      expect(fake.seen[0].headers.host).toBe(host);
      const stored = await AiCredentialModel.findById(res.body.data.id).lean();
      expect(stored?.baseUrl).toBe(
        AI_PROVIDER_PRESETS[preset as keyof typeof AI_PROVIDER_PRESETS].baseUrl
      );
    });

    it('GET /config tells the client what is on offer', async () => {
      const alice = await createUser();
      const res = await request(app).get('/api/ai-credentials/config').set(alice.auth);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toMatch(/no-store/);
      expect(res.body.data).toEqual({
        enabled: true,
        allowCustom: false,
        presets: AI_PROVIDER_PRESETS,
      });
      process.env.BYOK_ALLOW_CUSTOM_URLS = 'true';
      const again = await request(app).get('/api/ai-credentials/config').set(alice.auth);
      expect(again.body.data.allowCustom).toBe(true);
    });

    it('the stored document has exactly the planned fields and a unique (userId, label) index', async () => {
      const alice = await createUser();
      const key = newKey();
      acceptedKeys.add(key);
      await create(alice, goodBody(key));
      const stored = await AiCredentialModel.collection.findOne({});
      expect(Object.keys(stored ?? {}).sort()).toEqual(
        [
          '__v',
          '_id',
          'baseUrl',
          'createdAt',
          'label',
          'last4',
          'model',
          'preset',
          'sealed',
          'updatedAt',
          'userId',
        ].sort()
      );
      const indexes = await AiCredentialModel.collection.indexes();
      expect(
        indexes.some(
          (i: { unique?: boolean; key: unknown }) =>
            i.unique && JSON.stringify(i.key) === '{"userId":1,"label":1}'
        )
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(b) provider URL', () => {
    it('a baseUrl sent together with a preset is ignored: the preset URL is stored and used', async () => {
      const alice = await createUser();
      const key = newKey();
      acceptedKeys.add(key);
      const res = await create(alice, goodBody(key, { baseUrl: 'https://llm.example.com/steal' }));
      expect(res.status).toBe(201);
      const stored = await AiCredentialModel.findById(res.body.data.id).lean();
      expect(stored?.baseUrl).toBe('https://api.openai.com/v1');
      expect(fake.seen[0].headers.host).toBe('api.openai.com');
      expect(fake.seen[0].url).toBe('/v1/models');
    });

    it('custom is refused (400) while BYOK_ALLOW_CUSTOM_URLS is not true, and no request leaves the server', async () => {
      const alice = await createUser();
      const key = newKey();
      acceptedKeys.add(key);
      for (const flag of [undefined, 'false', '0', 'TRUEISH']) {
        if (flag === undefined) delete process.env.BYOK_ALLOW_CUSTOM_URLS;
        else process.env.BYOK_ALLOW_CUSTOM_URLS = flag;
        const res = await create(
          alice,
          goodBody(key, { preset: 'custom', baseUrl: 'https://llm.example.com/v1' })
        );
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('AI_PROVIDER_URL_INVALID');
      }
      expect(fake.seen).toHaveLength(0);
      expect(await AiCredentialModel.countDocuments({})).toBe(0);
    });

    it('custom with a public https URL works when allowed; the path is kept without a trailing slash', async () => {
      process.env.BYOK_ALLOW_CUSTOM_URLS = 'true';
      const alice = await createUser();
      const key = newKey();
      acceptedKeys.add(key);
      const res = await create(
        alice,
        goodBody(key, { preset: 'custom', baseUrl: 'https://LLM.example.com./v1/' })
      );
      expect(res.status).toBe(201);
      expect(res.body.data.preset).toBe('custom');
      const stored = await AiCredentialModel.findById(res.body.data.id).lean();
      expect(stored?.baseUrl).toBe('https://llm.example.com/v1');
      expect(fake.seen[0].url).toBe('/v1/models');
      expect(fake.seen[0].headers.host).toBe('llm.example.com');
    });

    it.each([
      ['http://llm.example.com/v1', 'plain http'],
      ['https://10.0.0.1/v1', 'private IP'],
      ['https://127.0.0.1/v1', 'loopback'],
      ['https://169.254.169.254/latest/meta-data', 'cloud metadata'],
      ['https://2130706433/v1', 'decimal IP'],
      ['https://0x7f000001/v1', 'hex IP'],
      ['https://[::1]/v1', 'IPv6 loopback'],
      ['https://localhost/v1', 'localhost'],
      ['https://llm.example.com:8443/v1', 'port 8443'],
      ['https://user:pass@llm.example.com/v1', 'userinfo'],
      ['https://llm.example.com/v1?x=1', 'query string'],
      ['https://llm.example.com/v1#frag', 'fragment'],
      ['ftp://llm.example.com/v1', 'ftp'],
      ['file:///etc/passwd', 'file'],
      ['not a url', 'garbage'],
      ['https://llm.example.com/a b', 'space in path'],
      ['https://llm.example.com/%2e%2e/x', 'percent-encoded path'],
    ])('custom %s is refused (%s) and nothing is contacted or saved', async (baseUrl) => {
      process.env.BYOK_ALLOW_CUSTOM_URLS = 'true';
      const alice = await createUser();
      const key = newKey();
      acceptedKeys.add(key);
      const res = await create(alice, goodBody(key, { preset: 'custom', baseUrl }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('AI_PROVIDER_URL_INVALID');
      expect(res.text).not.toContain(key);
      expect(fake.seen).toHaveLength(0);
      expect(await AiCredentialModel.countDocuments({})).toBe(0);
    });

    it('custom without a baseUrl is a 400', async () => {
      process.env.BYOK_ALLOW_CUSTOM_URLS = 'true';
      const alice = await createUser();
      const res = await create(alice, goodBody(newKey(), { preset: 'custom' }));
      expect(res.status).toBe(400);
    });

    it('a custom host that resolves to a private address at connect time (DNS rebinding) is refused and not saved', async () => {
      process.env.BYOK_ALLOW_CUSTOM_URLS = 'true';
      const alice = await createUser();
      const key = newKey();
      const res = await create(
        alice,
        goodBody(key, { preset: 'custom', baseUrl: 'https://rebind.example.com/v1' })
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('AI_PROVIDER_URL_INVALID');
      expect(fake.seen).toHaveLength(0);
      expect(await AiCredentialModel.countDocuments({})).toBe(0);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(c) the provider decides whether the key is good', () => {
    it.each([401, 403])(
      'a %s from the provider is a 400 AI_PROVIDER_REJECTED and nothing is saved',
      async (status) => {
        const alice = await createUser();
        const key = newKey();
        fake.setHandler((req, res) => {
          res.statusCode = status;
          res.end(
            JSON.stringify({ error: { message: `bad key ${String(req.headers.authorization)}` } })
          );
        });
        const res = await create(alice, goodBody(key));
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('AI_PROVIDER_REJECTED');
        // neither the key, nor the Authorization header, nor the provider's own message reach the client
        expect(res.text).not.toContain(key);
        expect(res.text).not.toMatch(/bad key|Bearer/i);
        expect(await AiCredentialModel.countDocuments({})).toBe(0);
        expect(await NotificationModel.countDocuments({})).toBe(0);
        expect(getTestOutbox()).toHaveLength(0);
      }
    );

    it('an unreachable provider does not block saving: stored with lastError "unreachable"', async () => {
      const alice = await createUser();
      const key = newKey();
      useFake(await closedPort());
      const res = await create(alice, goodBody(key));
      expect(res.status).toBe(201);
      expect(res.body.data.lastError).toBe('unreachable');
      expect(res.text).not.toContain(key);
      const stored = await AiCredentialModel.findById(res.body.data.id).lean();
      expect(stored?.lastError).toBe('unreachable');
    });

    it('a provider answering 500 is also "unreachable" (saved, flagged)', async () => {
      const alice = await createUser();
      fake.setHandler((_req, res) => {
        res.statusCode = 500;
        res.end('boom');
      });
      const res = await create(alice, goodBody(newKey()));
      expect(res.status).toBe(201);
      expect(res.body.data.lastError).toBe('unreachable');
    });

    it('a provider that redirects is not followed: a custom URL is refused, a preset is saved as unreachable', async () => {
      const alice = await createUser();
      fake.setHandler((_req, res) => {
        res.statusCode = 302;
        res.setHeader('Location', 'http://169.254.169.254/latest');
        res.end();
      });
      process.env.BYOK_ALLOW_CUSTOM_URLS = 'true';
      const custom = await create(
        alice,
        goodBody(newKey(), { preset: 'custom', label: 'c', baseUrl: 'https://llm.example.com/v1' })
      );
      expect(custom.status).toBe(400);
      expect(custom.body.error.code).toBe('AI_PROVIDER_URL_INVALID');
      const preset = await create(alice, goodBody(newKey(), { label: 'p' }));
      expect(preset.status).toBe(201);
      expect(preset.body.data.lastError).toBe('unreachable');
      expect(fake.seen.every((s) => s.url === '/v1/models')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe("(d) one user can never reach another user's credential (Review Focus 1)", () => {
    it("B with the id of A's credential: 404 on PATCH and DELETE, not in B's list, A's record untouched", async () => {
      const alice = await createUser();
      const bob = await createUser();
      const key = newKey();
      acceptedKeys.add(key);
      const made = await create(alice, goodBody(key));
      const id = made.body.data.id as string;
      const before = await AiCredentialModel.findById(id).lean();

      const patch = await request(app)
        .patch(`/api/ai-credentials/${id}`)
        .set(bob.auth)
        .set(CSRF)
        .send({ label: 'hijacked', model: 'x', apiKey: newKey() });
      expect(patch.status).toBe(404);
      expect(patch.body.error.code).toBe('AI_CREDENTIAL_NOT_FOUND');
      const del = await request(app).delete(`/api/ai-credentials/${id}`).set(bob.auth).set(CSRF);
      expect(del.status).toBe(404);
      expect(del.body.error.code).toBe('AI_CREDENTIAL_NOT_FOUND');
      const list = await request(app).get('/api/ai-credentials').set(bob.auth);
      expect(list.body.data).toEqual([]);
      expect(list.text).not.toContain(id);

      // the 404 is the same one a non-existent id gets: nothing tells B that the id is real
      const ghost = await request(app)
        .delete(`/api/ai-credentials/${new Types.ObjectId()}`)
        .set(bob.auth)
        .set(CSRF);
      expect(ghost.status).toBe(404);
      expect(ghost.body.error).toEqual(del.body.error);

      const after = await AiCredentialModel.findById(id).lean();
      expect(after).toEqual(before);
      expect(fake.seen).toHaveLength(1); // only A's own creation talked to the provider
    });

    it('a malformed id is a 404 as well (never a 500 that names the cast error)', async () => {
      const alice = await createUser();
      for (const method of ['patch', 'delete'] as const) {
        const res = await request(app)
          [method]('/api/ai-credentials/not-an-object-id')
          .set(alice.auth)
          .set(CSRF)
          .send({ label: 'x' });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('AI_CREDENTIAL_NOT_FOUND');
      }
    });

    it('the owner can still delete it afterwards (204) and it is gone', async () => {
      const alice = await createUser();
      acceptedKeys.add('placeholder');
      const key = newKey();
      acceptedKeys.add(key);
      const made = await create(alice, goodBody(key));
      const del = await request(app)
        .delete(`/api/ai-credentials/${made.body.data.id}`)
        .set(alice.auth)
        .set(CSRF);
      expect(del.status).toBe(204);
      expect(del.headers['cache-control']).toMatch(/no-store/);
      expect(await AiCredentialModel.countDocuments({})).toBe(0);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(e) limits', () => {
    it('the sixth credential of a user is a 409; another user is not affected', async () => {
      const alice = await createUser();
      const bob = await createUser();
      for (let i = 1; i <= 5; i++) {
        const key = newKey();
        acceptedKeys.add(key);
        const res = await create(alice, goodBody(key, { label: `k${i}` }));
        expect(res.status).toBe(201);
      }
      const key = newKey();
      acceptedKeys.add(key);
      const sixth = await create(alice, goodBody(key, { label: 'k6' }));
      expect(sixth.status).toBe(409);
      expect(sixth.body.error.code).toBe('AI_CREDENTIAL_LIMIT_REACHED');
      expect(await AiCredentialModel.countDocuments({ userId: alice.id })).toBe(5);
      expect((await create(bob, goodBody(key))).status).toBe(201);
    });

    it('a repeated label is a 409 for the same user, fine for another one', async () => {
      const alice = await createUser();
      const bob = await createUser();
      const key = newKey();
      acceptedKeys.add(key);
      expect((await create(alice, goodBody(key))).status).toBe(201);
      const dup = await create(alice, goodBody(key));
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('AI_CREDENTIAL_LABEL_TAKEN');
      expect((await create(bob, goodBody(key))).status).toBe(201);
    });

    it('the limit also holds when requests race (never more than five stored)', async () => {
      const alice = await createUser();
      const keys = Array.from({ length: 8 }, () => newKey());
      keys.forEach((k) => acceptedKeys.add(k));
      const results = await Promise.all(
        keys.map((k, i) => create(alice, goodBody(k, { label: `race${i}` })))
      );
      expect(results.filter((r) => r.status === 201).length).toBeLessThanOrEqual(5);
      expect(await AiCredentialModel.countDocuments({ userId: alice.id })).toBeLessThanOrEqual(5);
      expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(f) PATCH', () => {
    it('a new apiKey re-seals with a fresh IV, updates last4 and clears lastError; the old key is gone', async () => {
      const alice = await createUser();
      const oldKey = newKey();
      const newerKey = newKey();
      acceptedKeys.add(oldKey);
      acceptedKeys.add(newerKey);
      const made = await create(alice, goodBody(oldKey));
      const id = made.body.data.id as string;
      const before = await AiCredentialModel.findById(id).lean();
      await AiCredentialModel.updateOne({ _id: id }, { $set: { lastError: 'unreachable' } });

      const res = await request(app)
        .patch(`/api/ai-credentials/${id}`)
        .set(alice.auth)
        .set(CSRF)
        .send({ apiKey: newerKey });
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toMatch(/no-store/);
      expect(res.body.data.last4).toBe(newerKey.slice(-4));
      expect(res.body.data.lastError).toBeUndefined();
      expect(res.text).not.toContain(newerKey);
      expect(res.text).not.toContain(oldKey);

      const after = await AiCredentialModel.findById(id).lean();
      expect(after!.sealed.iv).not.toBe(before!.sealed.iv);
      expect(after!.sealed.ct).not.toBe(before!.sealed.ct);
      expect(open(after!.sealed, `${alice.id}|${id}|${after!.baseUrl}`)).toBe(newerKey);
      expect(JSON.stringify(after)).not.toContain(oldKey);
      expect(JSON.stringify(after)).not.toContain(newerKey);
      // the new key was verified too
      expect(fake.seen[fake.seen.length - 1].headers.authorization).toBe(`Bearer ${newerKey}`);
    });

    it('a new apiKey the provider refuses is a 400 and nothing changes', async () => {
      const alice = await createUser();
      const key = newKey();
      acceptedKeys.add(key);
      const made = await create(alice, goodBody(key));
      const id = made.body.data.id as string;
      const before = await AiCredentialModel.findById(id).lean();
      const res = await request(app)
        .patch(`/api/ai-credentials/${id}`)
        .set(alice.auth)
        .set(CSRF)
        .send({ apiKey: newKey(), label: 'renamed' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('AI_PROVIDER_REJECTED');
      expect(await AiCredentialModel.findById(id).lean()).toEqual(before);
    });

    it('label / model changes do not touch the sealed key nor call the provider', async () => {
      const alice = await createUser();
      const key = newKey();
      acceptedKeys.add(key);
      const made = await create(alice, goodBody(key));
      const id = made.body.data.id as string;
      const before = await AiCredentialModel.findById(id).lean();
      fake.seen.length = 0;
      const res = await request(app)
        .patch(`/api/ai-credentials/${id}`)
        .set(alice.auth)
        .set(CSRF)
        .send({ label: 'Otro nombre', model: 'meta-llama/Llama-3.3-70B:free' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        label: 'Otro nombre',
        model: 'meta-llama/Llama-3.3-70B:free',
      });
      const after = await AiCredentialModel.findById(id).lean();
      expect(after!.sealed).toEqual(before!.sealed);
      expect(fake.seen).toHaveLength(0);
    });

    it('renaming to a label already used by the user is a 409; an empty body is a 400', async () => {
      const alice = await createUser();
      const k1 = newKey();
      const k2 = newKey();
      acceptedKeys.add(k1);
      acceptedKeys.add(k2);
      await create(alice, goodBody(k1, { label: 'uno' }));
      const second = await create(alice, goodBody(k2, { label: 'dos' }));
      const id = second.body.data.id as string;
      const dup = await request(app)
        .patch(`/api/ai-credentials/${id}`)
        .set(alice.auth)
        .set(CSRF)
        .send({ label: 'uno' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('AI_CREDENTIAL_LABEL_TAKEN');
      const empty = await request(app)
        .patch(`/api/ai-credentials/${id}`)
        .set(alice.auth)
        .set(CSRF)
        .send({});
      expect(empty.status).toBe(400);
    });

    it('the provider and the URL cannot be changed (they are not part of PATCH)', async () => {
      const alice = await createUser();
      const key = newKey();
      acceptedKeys.add(key);
      const made = await create(alice, goodBody(key));
      const id = made.body.data.id as string;
      const res = await request(app)
        .patch(`/api/ai-credentials/${id}`)
        .set(alice.auth)
        .set(CSRF)
        .send({
          model: 'm2',
          preset: 'groq',
          baseUrl: 'https://evil.example.com/v1',
          sealed: {},
          userId: new Types.ObjectId(),
        });
      expect(res.status).toBe(200);
      const after = await AiCredentialModel.findById(id).lean();
      expect(after!.preset).toBe('openai');
      expect(after!.baseUrl).toBe('https://api.openai.com/v1');
      expect(after!.userId.toString()).toBe(alice.id);
      expect(after!.model).toBe('m2');
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(g) who may call it', () => {
    const routes: Array<[string, string, string]> = [
      ['get', '/api/ai-credentials/config', 'config'],
      ['get', '/api/ai-credentials', 'list'],
      ['post', '/api/ai-credentials', 'create'],
      ['patch', `/api/ai-credentials/${new Types.ObjectId()}`, 'patch'],
      ['delete', `/api/ai-credentials/${new Types.ObjectId()}`, 'delete'],
    ];

    it.each(routes)(
      'BYOK_ENABLED=false: %s %s is a 404 BYOK_DISABLED (%s)',
      async (method, url) => {
        process.env.BYOK_ENABLED = 'false';
        const alice = await createUser();
        const res = await (request(app) as any)
          [method](url)
          .set(alice.auth)
          .set(CSRF)
          .send(goodBody(newKey()));
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('BYOK_DISABLED');
        const anon = await (request(app) as any)[method](url).send({});
        expect(anon.status).toBe(404);
      }
    );

    it('an unset BYOK_ENABLED means off as well', async () => {
      delete process.env.BYOK_ENABLED;
      const alice = await createUser();
      const res = await request(app).get('/api/ai-credentials').set(alice.auth);
      expect(res.status).toBe(404);
    });

    it.each(routes)('without a session: %s %s is a 401 (%s)', async (method, url) => {
      const res = await (request(app) as any)[method](url).set(CSRF).send({});
      expect(res.status).toBe(401);
    });

    it.each(routes)(
      'without a verified email: %s %s is a 403 EMAIL_NOT_VERIFIED (%s)',
      async (method, url) => {
        process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
        const carol = await createUser({ emailVerifiedAt: null });
        const res = await (request(app) as any)
          [method](url)
          .set(carol.auth)
          .set(CSRF)
          .send(goodBody(newKey()));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
        expect(fake.seen).toHaveLength(0);
      }
    );

    it('writes without the X-Requested-With: mockia header are a 403 and nothing is contacted or changed', async () => {
      const alice = await createUser();
      const key = newKey();
      acceptedKeys.add(key);
      const post = await request(app)
        .post('/api/ai-credentials')
        .set(alice.auth)
        .send(goodBody(key));
      expect(post.status).toBe(403);
      const made = await create(alice, goodBody(key));
      const id = made.body.data.id as string;
      fake.seen.length = 0;
      const patch = await request(app)
        .patch(`/api/ai-credentials/${id}`)
        .set(alice.auth)
        .send({ label: 'x' });
      expect(patch.status).toBe(403);
      const del = await request(app).delete(`/api/ai-credentials/${id}`).set(alice.auth);
      expect(del.status).toBe(403);
      const wrong = await request(app)
        .delete(`/api/ai-credentials/${id}`)
        .set(alice.auth)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(wrong.status).toBe(403);
      expect(await AiCredentialModel.countDocuments({})).toBe(1);
      expect(fake.seen).toHaveLength(0);
      // reads do not need it
      expect((await request(app).get('/api/ai-credentials').set(alice.auth)).status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('input validation', () => {
    it.each([
      ['model with a space', { model: 'gpt 4' }],
      ['model with a quote', { model: 'gpt"4' }],
      ['model with a newline', { model: 'gpt-4\n' }],
      ['model with unicode', { model: 'gpt-4o‮' }],
      ['model of 101 characters', { model: 'a'.repeat(101) }],
      ['empty model', { model: '' }],
      ['missing model', { model: undefined }],
      ['empty label', { label: '' }],
      ['whitespace label', { label: '   ' }],
      ['label of 41 characters', { label: 'a'.repeat(41) }],
      ['label with a control character', { label: 'bad\u0007label' }],
      ['unknown preset', { preset: 'anthropic' }],
      ['missing preset', { preset: undefined }],
      ['too short apiKey', { apiKey: 'short' }],
      ['apiKey with a space', { apiKey: 'sk-test with a space inside it' }],
      ['apiKey with a newline', { apiKey: 'sk-test-0123456789abcdef\nX-Evil: 1' }],
      ['non string apiKey', { apiKey: 1234567890123456 }],
      ['apiKey of 513 characters', { apiKey: 'a'.repeat(513) }],
      ['missing apiKey', { apiKey: undefined }],
    ])('%s is a 400 and nothing is contacted or saved', async (_name, over) => {
      const alice = await createUser();
      const body = goodBody(newKey(), over);
      const res = await create(alice, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      // a rejected key must not be echoed back in the validation details
      if (typeof body.apiKey === 'string') expect(res.text).not.toContain(body.apiKey);
      expect(fake.seen).toHaveLength(0);
      expect(await AiCredentialModel.countDocuments({})).toBe(0);
    });

    it('the model accepts what real providers use', async () => {
      const alice = await createUser();
      const models = [
        'gpt-4o',
        'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        'mistral-large-latest',
        'llama-3.3-70b-versatile:free',
        'anthropic/claude@2+x_y'.replace('_', '-'),
      ];
      for (const [i, model] of models.entries()) {
        const key = newKey();
        acceptedKeys.add(key);
        const res = await create(alice, goodBody(key, { label: `m${i}`, model }));
        expect(res.status).toBe(201);
        expect(res.body.data.model).toBe(model);
      }
    });

    it('fields that are not part of the request (userId, sealed, last4, lastError...) are ignored', async () => {
      const alice = await createUser();
      const bob = await createUser();
      const key = newKey();
      acceptedKeys.add(key);
      const res = await create(alice, {
        ...goodBody(key),
        userId: bob.id,
        sealed: { v: 1 },
        last4: 'FAKE',
        lastError: 'rejected',
        lastUsedAt: new Date().toISOString(),
        _id: new Types.ObjectId().toString(),
      });
      expect(res.status).toBe(201);
      const stored = await AiCredentialModel.findById(res.body.data.id).lean();
      expect(stored!.userId.toString()).toBe(alice.id);
      expect(stored!.last4).toBe(key.slice(-4));
      expect(stored!.lastError).toBeUndefined();
      expect(stored!.lastUsedAt).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(i) security notice: in-app notification and email, never with the key', () => {
    it('creating and deleting leave a notification and an email each, without the key', async () => {
      const alice = await createUser();
      const key = newKey();
      acceptedKeys.add(key);
      const made = await create(alice, goodBody(key, { label: 'Trabajo' }));
      expect(made.status).toBe(201);

      let notes = await NotificationModel.find({ userId: alice.id }).sort({ createdAt: 1 }).lean();
      expect(notes).toHaveLength(1);
      expect(notes[0].type).toBe(NotificationType.SYSTEM);
      let mails = getTestOutbox().filter((m) => m.to === alice.email);
      expect(mails.map((m) => m.template)).toEqual(['ai_key_added']);
      expect(mails[0].locale).toBe('es');

      const del = await request(app)
        .delete(`/api/ai-credentials/${made.body.data.id}`)
        .set(alice.auth)
        .set(CSRF);
      expect(del.status).toBe(204);
      notes = await NotificationModel.find({ userId: alice.id }).sort({ createdAt: 1 }).lean();
      expect(notes).toHaveLength(2);
      mails = getTestOutbox().filter((m) => m.to === alice.email);
      expect(mails.map((m) => m.template)).toEqual(['ai_key_added', 'ai_key_removed']);

      const everything = JSON.stringify({ notes, mails });
      expect(everything).not.toContain(key);
      expect(everything).not.toContain(key.slice(-8));
      // the notice says which provider/label, so the owner can recognise (or not) the action
      expect(everything).toContain('Trabajo');
    });

    it('a failing mail transport does not undo the credential nor fail the request', async () => {
      const alice = await createUser();
      const key = newKey();
      acceptedKeys.add(key);
      const savedSmtp = process.env.SMTP_URL;
      process.env.SMTP_URL = 'smtp://127.0.0.1:1'; // nothing listens there
      const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const res = await create(alice, goodBody(key));
        expect(res.status).toBe(201);
        expect(await AiCredentialModel.countDocuments({})).toBe(1);
        // the log line must not hold the key or the address
        const logged = JSON.stringify(errors.mock.calls);
        expect(logged).not.toContain(key);
        expect(logged).not.toContain(alice.email);
      } finally {
        errors.mockRestore();
        if (savedSmtp === undefined) delete process.env.SMTP_URL;
        else process.env.SMTP_URL = savedSmtp;
      }
    });

    it.each(['ai_key_added', 'ai_key_removed'] as const)(
      '%s renders in en, es and zh with distinct, complete text',
      (template) => {
        const subjects = new Set<string>();
        for (const locale of ['en', 'es', 'zh']) {
          const mail = renderMail(template, {
            link: 'https://mockia.test/dashboard',
            locale,
            provider: 'OpenAI',
            label: 'Trabajo',
            username: 'ana',
          });
          expect(mail.locale).toBe(locale);
          expect(mail.subject.length).toBeGreaterThan(5);
          expect(`${mail.subject}${mail.text}${mail.html}`).not.toMatch(/undefined|\[object/);
          expect(mail.text).toContain('OpenAI');
          expect(mail.text).toContain('Trabajo');
          subjects.add(mail.subject);
        }
        expect(subjects.size).toBe(3);
      }
    );

    it('the label is escaped in the HTML body', () => {
      const mail = renderMail('ai_key_added', {
        link: 'https://mockia.test/dashboard',
        provider: 'OpenAI',
        label: '<img src=x onerror=alert(1)>',
      });
      expect(mail.html).not.toContain('<img');
      expect(mail.html).toContain('&lt;img');
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(h) GDPR: export and account deletion', () => {
    it('the export lists metadata only; deleting the account deletes the credentials', async () => {
      const alice = await createUser();
      const bob = await createUser();
      const aliceKey = newKey();
      const bobKey = newKey();
      acceptedKeys.add(aliceKey);
      acceptedKeys.add(bobKey);
      const made = await create(alice, goodBody(aliceKey, { label: 'Ana' }));
      await create(bob, goodBody(bobKey, { label: 'Beto' }));

      const exp = await request(app).get('/api/users/me/export').set(alice.auth);
      expect(exp.status).toBe(200);
      const data = JSON.parse(exp.text);
      expect(data.aiCredentials).toEqual([
        expect.objectContaining({
          id: made.body.data.id,
          label: 'Ana',
          preset: 'openai',
          model: 'gpt-4o-mini',
          last4: aliceKey.slice(-4),
        }),
      ]);
      expect(exp.text).not.toContain(aliceKey);
      expect(exp.text).not.toContain(bobKey);
      expect(exp.text).not.toMatch(/"sealed"|"ct"|"iv"|"tag"/);

      const del = await request(app)
        .delete('/api/users/me')
        .set(alice.auth)
        .send({ password: PASSWORD });
      expect(del.status).toBe(204);
      expect(await AiCredentialModel.countDocuments({ userId: alice.id })).toBe(0);
      expect(await AiCredentialModel.countDocuments({ userId: bob.id })).toBe(1);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe('(j) writes are rate limited per user', () => {
    it('the 21st write of one user within the hour is a 429; another user is unaffected; reads are not counted', async () => {
      const alice = await createUser();
      const bob = await createUser();
      for (let i = 0; i < 20; i++) {
        const res = await request(app)
          .delete(`/api/ai-credentials/${new Types.ObjectId()}`)
          .set(alice.auth)
          .set(CSRF);
        expect(res.status).toBe(404); // counted even though nothing existed
      }
      const blocked = await request(app)
        .delete(`/api/ai-credentials/${new Types.ObjectId()}`)
        .set(alice.auth)
        .set(CSRF);
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
      const blockedPost = await create(alice, goodBody(newKey()));
      expect(blockedPost.status).toBe(429);
      expect(fake.seen).toHaveLength(0);

      expect((await request(app).get('/api/ai-credentials').set(alice.auth)).status).toBe(200);
      const key = newKey();
      acceptedKeys.add(key);
      expect((await create(bob, goodBody(key))).status).toBe(201);
    });
  });
});
