/**
 * K3 - key rotation (`npm run byok:rotate`, ruling Q-R6).
 *
 * The keyring in BYOK_KEYS has the active key first. After adding a new key at the front, the sealed AI keys of the users
 * still carry the old key id; the rotation re-seals them with the active one so the old entry can be dropped. These tests
 * pin: it only touches what needs it, derives each record's AAD itself, is idempotent, loads the keyring once, counts
 * (and leaves alone) records of an unknown key or that do not open, and prints counts only, never key material.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { connectDB, disconnectDB } from '../config/connection.js';
import { AiCredentialModel } from '../models/AiCredential.js';
import * as cryptoModule from '../modules/byok/crypto.js';
import { generateKeyEntry, loadKeyring, open, seal, type Keyring } from '../modules/byok/crypto.js';
import { rotateCredentials } from '../modules/byok/rotate.js';
import { credentialAad } from '../modules/byok/service.js';

const sentinel = () => `sk-test-${randomBytes(18).toString('hex')}`;
const ringOf = (...entries: string[]): Keyring => loadKeyring({ BYOK_KEYS: entries.join(',') });

describe('byok:rotate', () => {
  const entryK1 = generateKeyEntry('k1');
  const entryK2 = generateKeyEntry('k2');
  const ringOld = ringOf(entryK1);
  const ringNew = ringOf(entryK2, entryK1); // k2 active, k1 still around to open older records

  const plains = new Map<string, string>();

  /** A stored credential sealed with `ring`, the way the API does it (id first, then AAD userId|credId|baseUrl). */
  async function store(ring: Keyring, over: Record<string, unknown> = {}) {
    const _id = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const baseUrl = 'https://api.openai.com/v1';
    const plain = sentinel();
    plains.set(_id.toString(), plain);
    await AiCredentialModel.collection.insertOne({
      _id,
      userId,
      label: `l-${_id.toString()}`,
      preset: 'openai',
      baseUrl,
      model: 'gpt-4o-mini',
      sealed: seal(plain, credentialAad(userId.toString(), _id.toString(), baseUrl), ring),
      last4: plain.slice(-4),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      ...over,
    });
    return { _id, userId, baseUrl, plain };
  }

  beforeAll(async () => {
    await connectDB();
  });
  afterAll(async () => {
    await AiCredentialModel.deleteMany({});
    await disconnectDB();
  });
  beforeEach(async () => {
    await AiCredentialModel.deleteMany({});
    plains.clear();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('re-seals with the active key what was sealed with an old one; each key still opens with its own AAD', async () => {
    const a = await store(ringOld);
    const b = await store(ringOld);
    const before = await AiCredentialModel.collection.find({}).toArray();

    const result = await rotateCredentials({ ring: ringNew });

    expect(result).toEqual({
      dryRun: false,
      total: 2,
      rotated: 2,
      alreadyCurrent: 0,
      unknownKey: 0,
      failed: 0,
      skipped: 0,
    });
    for (const c of [a, b]) {
      const doc = await AiCredentialModel.collection.findOne({ _id: c._id });
      expect(doc!.sealed.kid).toBe('k2');
      expect(
        open(doc!.sealed, credentialAad(c.userId.toString(), c._id.toString(), c.baseUrl), ringNew)
      ).toBe(c.plain);
      const old = before.find((d) => d._id.equals(c._id))!;
      expect(doc!.sealed.iv).not.toBe(old.sealed.iv); // a fresh IV, never reused
      // nothing else about the record changed, not even its updatedAt (a rotation is not an edit)
      const { sealed: _s1, ...restNow } = doc!;
      const { sealed: _s2, ...restBefore } = old;
      expect(restNow).toEqual(restBefore);
    }
    // the old key alone no longer opens them: the old entry can be dropped from BYOK_KEYS
    const rotated = await AiCredentialModel.collection.findOne({ _id: a._id });
    expect(() =>
      open(
        rotated!.sealed,
        credentialAad(a.userId.toString(), a._id.toString(), a.baseUrl),
        ringOld
      )
    ).toThrow();
  });

  it('is idempotent: a second run changes nothing', async () => {
    await store(ringOld);
    await store(ringNew);
    await rotateCredentials({ ring: ringNew });
    const snapshot = await AiCredentialModel.collection.find({}).sort({ _id: 1 }).toArray();

    const again = await rotateCredentials({ ring: ringNew });

    expect(again).toMatchObject({
      total: 2,
      rotated: 0,
      alreadyCurrent: 2,
      failed: 0,
      unknownKey: 0,
    });
    expect(await AiCredentialModel.collection.find({}).sort({ _id: 1 }).toArray()).toEqual(
      snapshot
    );
  });

  it('leaves records already on the active key alone (same bytes)', async () => {
    const c = await store(ringNew);
    const before = await AiCredentialModel.collection.findOne({ _id: c._id });
    const result = await rotateCredentials({ ring: ringNew });
    expect(result).toMatchObject({ total: 1, rotated: 0, alreadyCurrent: 1 });
    expect(await AiCredentialModel.collection.findOne({ _id: c._id })).toEqual(before);
  });

  it('--dry-run reports what it would do and writes nothing', async () => {
    await store(ringOld);
    await store(ringOld);
    await store(ringNew);
    const before = await AiCredentialModel.collection.find({}).sort({ _id: 1 }).toArray();

    const result = await rotateCredentials({ ring: ringNew, dryRun: true });

    expect(result).toEqual({
      dryRun: true,
      total: 3,
      rotated: 2,
      alreadyCurrent: 1,
      unknownKey: 0,
      failed: 0,
      skipped: 0,
    });
    expect(await AiCredentialModel.collection.find({}).sort({ _id: 1 }).toArray()).toEqual(before);
  });

  it('counts apart (and does not touch) records sealed with a key that is no longer in the keyring', async () => {
    const ringGone = ringOf(generateKeyEntry('k0'));
    const orphan = await store(ringGone);
    await store(ringOld);
    const before = await AiCredentialModel.collection.findOne({ _id: orphan._id });

    const result = await rotateCredentials({ ring: ringNew });

    expect(result).toMatchObject({ total: 2, rotated: 1, unknownKey: 1, failed: 0 });
    expect(await AiCredentialModel.collection.findOne({ _id: orphan._id })).toEqual(before);
  });

  it('counts as failed (and does not touch) a record that does not open: tampered, or moved to another user/host', async () => {
    const tampered = await store(ringOld);
    const moved = await store(ringOld);
    const good = await store(ringOld);
    // The sealed record copied under another user, and another record pointed at a different host
    await AiCredentialModel.collection.updateOne(
      { _id: tampered._id },
      { $set: { 'sealed.ct': Buffer.from('xxxxxxxxxxxxxxxx').toString('base64') } }
    );
    await AiCredentialModel.collection.updateOne(
      { _id: moved._id },
      { $set: { baseUrl: 'https://evil.example.com/v1' } }
    );
    const beforeTampered = await AiCredentialModel.collection.findOne({ _id: tampered._id });
    const beforeMoved = await AiCredentialModel.collection.findOne({ _id: moved._id });

    const result = await rotateCredentials({ ring: ringNew });

    expect(result).toMatchObject({ total: 3, rotated: 1, failed: 2, unknownKey: 0 });
    expect(await AiCredentialModel.collection.findOne({ _id: tampered._id })).toEqual(
      beforeTampered
    );
    expect(await AiCredentialModel.collection.findOne({ _id: moved._id })).toEqual(beforeMoved);
    expect((await AiCredentialModel.collection.findOne({ _id: good._id }))!.sealed.kid).toBe('k2');
  });

  it('does not overwrite a record that changed while the rotation was running', async () => {
    const c = await store(ringOld);
    const real = AiCredentialModel.collection.updateOne.bind(AiCredentialModel.collection);
    // Simulates the user replacing the key (PATCH) between our read and our write
    const fresh = seal(
      'sk-test-replacement-from-the-user',
      credentialAad(c.userId.toString(), c._id.toString(), c.baseUrl),
      ringOld
    );
    let raced = false;
    jest.spyOn(AiCredentialModel, 'updateOne').mockImplementation(((
      filter: any,
      update: any,
      options: any
    ) => {
      if (!raced) {
        raced = true;
        return real({ _id: c._id }, { $set: { sealed: fresh } }).then(() =>
          real(filter, update, options)
        ) as any;
      }
      return real(filter, update, options) as any;
    }) as any);

    const result = await rotateCredentials({ ring: ringNew });

    expect(result).toMatchObject({ rotated: 0, skipped: 1, failed: 0 });
    const doc = await AiCredentialModel.collection.findOne({ _id: c._id });
    expect(doc!.sealed).toEqual(fresh); // the user's newer key survived
  });

  it('loads the keyring once for the whole run', async () => {
    for (let i = 0; i < 4; i++) await store(ringOld);
    const saved = process.env.BYOK_KEYS;
    process.env.BYOK_KEYS = `${entryK2},${entryK1}`;
    const spy = jest.spyOn(cryptoModule, 'loadKeyring');
    try {
      const result = await rotateCredentials();
      expect(result.rotated).toBe(4);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      if (saved === undefined) delete process.env.BYOK_KEYS;
      else process.env.BYOK_KEYS = saved;
    }
  });

  it('handles more records than one batch and reports only numbers', async () => {
    for (let i = 0; i < 7; i++) await store(ringOld);
    const result = await rotateCredentials({ ring: ringNew, batchSize: 3 });
    expect(result).toMatchObject({ total: 7, rotated: 7 });
    expect(
      Object.values(result).every((v) => typeof v === 'number' || typeof v === 'boolean')
    ).toBe(true);
    const text = JSON.stringify(result);
    for (const plain of plains.values()) expect(text).not.toContain(plain);
  });

  it('with no credentials it is a quiet no-op', async () => {
    expect(await rotateCredentials({ ring: ringNew })).toEqual({
      dryRun: false,
      total: 0,
      rotated: 0,
      alreadyCurrent: 0,
      unknownKey: 0,
      failed: 0,
      skipped: 0,
    });
  });

  describe('the command line script', () => {
    const backendDir = path.resolve(__dirname, '..', '..');
    const tsxCli = require.resolve('tsx/cli');
    const run = (env: Record<string, string>, args: string[] = []) =>
      spawnSync(process.execPath, [tsxCli, 'scripts/byok-rotate.ts', ...args], {
        cwd: backendDir,
        env: { ...process.env, NODE_ENV: 'test', ...env },
        encoding: 'utf8',
        timeout: 90_000,
      });
    const dbUri = () => process.env.MONGODB_URI ?? 'mongodb://localhost:27017/mockia';

    it('--dry-run prints counts only and writes nothing; the real run rotates; neither prints key material', async () => {
      const c = await store(ringOld);
      const keysEnv = `${entryK2},${entryK1}`;

      const dry = run({ BYOK_KEYS: keysEnv, MONGODB_URI: dbUri() }, ['--dry-run']);
      expect(dry.status).toBe(0);
      expect(dry.stdout).toMatch(
        /total=1 rotated=1 alreadyCurrent=0 unknownKey=0 failed=0 skipped=0/
      );
      expect(dry.stdout).toMatch(/dry run/i);
      expect((await AiCredentialModel.collection.findOne({ _id: c._id }))!.sealed.kid).toBe('k1');

      const real = run({ BYOK_KEYS: keysEnv, MONGODB_URI: dbUri() });
      expect(real.status).toBe(0);
      expect(real.stdout).toMatch(
        /total=1 rotated=1 alreadyCurrent=0 unknownKey=0 failed=0 skipped=0/
      );
      expect((await AiCredentialModel.collection.findOne({ _id: c._id }))!.sealed.kid).toBe('k2');

      const second = run({ BYOK_KEYS: keysEnv, MONGODB_URI: dbUri() });
      expect(second.stdout).toMatch(/rotated=0 alreadyCurrent=1/);

      const everything = `${dry.stdout}${dry.stderr}${real.stdout}${real.stderr}${second.stdout}${second.stderr}`;
      for (const secret of [c.plain, entryK1.split(':')[1], entryK2.split(':')[1]]) {
        expect(everything).not.toContain(secret);
      }
    });

    it('exits 1 when some record could not be rotated, and 1 with a fixed message when the keyring is invalid (no echo)', async () => {
      await store(ringOf(generateKeyEntry('k0'))); // sealed with a key that is gone
      const incomplete = run({ BYOK_KEYS: `${entryK2},${entryK1}`, MONGODB_URI: dbUri() });
      expect(incomplete.status).toBe(1);
      expect(incomplete.stdout).toMatch(/unknownKey=1/);

      const badRing = 'k1:this-is-not-a-valid-base64-key-material';
      const invalid = run({ BYOK_KEYS: badRing, MONGODB_URI: dbUri() });
      expect(invalid.status).toBe(1);
      expect(`${invalid.stdout}${invalid.stderr}`).not.toContain('this-is-not-a-valid');
      expect(invalid.stderr).toMatch(/keyring/i);
    });
  });
});
