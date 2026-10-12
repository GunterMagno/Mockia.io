import { randomBytes } from 'crypto';
import { execFileSync } from 'child_process';
import path from 'path';
import {
  ByokCryptoError,
  generateKeyEntry,
  loadKeyring,
  needsRotation,
  open,
  seal,
  type Keyring,
  type SealedSecret,
} from '../modules/byok/crypto.js';
import { assertProdConfig } from '../config/assertProdConfig.js';

/**
 * Task K1 (D10): API keys of users are stored sealed with AES-256-GCM. The keyring comes from the environment
 * (BYOK_KEYS="id:base64(32 bytes),..."; the first entry is the active one). The AAD ties a ciphertext to its user,
 * credential and host. Keys here are generated on the fly: no real key appears in the repository.
 */

const newKey = (): string => randomBytes(32).toString('base64');
const ring = (...ids: string[]): Keyring =>
  loadKeyring({ BYOK_KEYS: ids.map((id) => `${id}:${newKey()}`).join(',') });

const PLAIN = 'sk-test-0123456789abcdefghijklmnopqrstuvwxyz';
const AAD = 'user1|cred1|https://api.openai.com/v1';

/** The error the callback throws, or fails the test. */
function thrown(fn: () => unknown): ByokCryptoError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ByokCryptoError);
    return err as ByokCryptoError;
  }
  throw new Error('expected the call to throw');
}

/** Changes the first character of a base64 string to another valid base64 character. */
const tamper = (b64: string): string => (b64[0] === 'A' ? 'B' : 'A') + b64.slice(1);

describe('byok crypto (AES-256-GCM, keyring in the environment)', () => {
  describe('(a) round trip', () => {
    it('opens what it sealed, in the documented format', () => {
      const r = ring('k1');
      const sealed = seal(PLAIN, AAD, r);
      expect(sealed.v).toBe(1);
      expect(sealed.kid).toBe('k1');
      expect(Buffer.from(sealed.iv, 'base64')).toHaveLength(12);
      expect(Buffer.from(sealed.tag, 'base64')).toHaveLength(16);
      expect(Buffer.from(sealed.ct, 'base64').length).toBeGreaterThan(0);
      expect(open(sealed, AAD, r)).toBe(PLAIN);
    });

    it('handles unicode and long values', () => {
      const r = ring('k1');
      const text = 'clave-ñandú-日本語-' + 'x'.repeat(500);
      expect(open(seal(text, AAD, r), AAD, r)).toBe(text);
    });

    it('survives a JSON round trip (this is how it is stored)', () => {
      const r = ring('k1');
      const stored = JSON.parse(JSON.stringify(seal(PLAIN, AAD, r))) as SealedSecret;
      expect(open(stored, AAD, r)).toBe(PLAIN);
    });

    it('reads the keyring from the environment on every call when none is passed', () => {
      const saved = process.env.BYOK_KEYS;
      try {
        process.env.BYOK_KEYS = `k1:${newKey()}`;
        const sealed = seal(PLAIN, AAD);
        expect(open(sealed, AAD)).toBe(PLAIN);
        // another keyring in the same process (tests, rotation) is picked up without restarting
        process.env.BYOK_KEYS = `k9:${newKey()}`;
        expect(thrown(() => open(sealed, AAD)).code).toBe('unknown_key');
      } finally {
        if (saved === undefined) delete process.env.BYOK_KEYS;
        else process.env.BYOK_KEYS = saved;
      }
    });
  });

  describe('(b) the AAD binds the ciphertext', () => {
    it.each([
      ['another user', 'user2|cred1|https://api.openai.com/v1'],
      ['another credential', 'user1|cred2|https://api.openai.com/v1'],
      ['another host', 'user1|cred1|https://evil.example/v1'],
      ['a prefix of the right AAD', 'user1|cred1|https://api.openai.com/v'],
    ])('does not open for %s', (_name, otherAad) => {
      const r = ring('k1');
      const sealed = seal(PLAIN, AAD, r);
      expect(thrown(() => open(sealed, otherAad, r)).code).toBe('decrypt_failed');
    });

    it.each(['', undefined, 42, null])('requires a non-empty string AAD (%p)', (bad) => {
      const r = ring('k1');
      expect(thrown(() => seal(PLAIN, bad as unknown as string, r)).code).toBe('invalid_input');
      const sealed = seal(PLAIN, AAD, r);
      expect(thrown(() => open(sealed, bad as unknown as string, r)).code).toBe('invalid_input');
    });

    it.each(['', undefined, 42])('does not seal an empty or non-string secret (%p)', (bad) => {
      expect(thrown(() => seal(bad as unknown as string, AAD, ring('k1'))).code).toBe(
        'invalid_input'
      );
    });
  });

  describe('(c) tampering is detected', () => {
    it.each(['ct', 'tag', 'iv'] as const)('fails when %s is altered', (field) => {
      const r = ring('k1');
      const sealed = seal(PLAIN, AAD, r);
      const altered = { ...sealed, [field]: tamper(sealed[field]) };
      expect(thrown(() => open(altered, AAD, r)).code).toBe('decrypt_failed');
    });

    it('fails when ct is truncated or extended', () => {
      const r = ring('k1');
      const sealed = seal(PLAIN, AAD, r);
      const ct = Buffer.from(sealed.ct, 'base64');
      const shorter = { ...sealed, ct: ct.subarray(1).toString('base64') };
      const longer = { ...sealed, ct: Buffer.concat([ct, Buffer.from([0])]).toString('base64') };
      expect(thrown(() => open(shorter, AAD, r)).code).toBe('decrypt_failed');
      expect(thrown(() => open(longer, AAD, r)).code).toBe('decrypt_failed');
    });

    it('rejects malformed records without trying to decrypt them', () => {
      const r = ring('k1');
      const sealed = seal(PLAIN, AAD, r);
      const bad: unknown[] = [
        null,
        'text',
        {},
        { ...sealed, v: 2 },
        { ...sealed, kid: 7 },
        { ...sealed, iv: Buffer.alloc(11).toString('base64') },
        { ...sealed, iv: Buffer.alloc(16).toString('base64') },
        { ...sealed, tag: Buffer.alloc(15).toString('base64') },
        { ...sealed, tag: Buffer.alloc(17).toString('base64') },
        { ...sealed, iv: 'not base64!!' },
        { ...sealed, ct: '' },
        { ...sealed, ct: undefined },
      ];
      for (const record of bad) {
        expect(thrown(() => open(record as SealedSecret, AAD, r)).code).toBe('invalid_input');
      }
    });
  });

  describe('(d) unknown key id', () => {
    it('fails when the kid is not in the keyring', () => {
      const sealed = seal(PLAIN, AAD, ring('k1'));
      expect(thrown(() => open(sealed, AAD, ring('k2'))).code).toBe('unknown_key');
    });

    it('does not accept another key under the same kid', () => {
      const sealed = seal(PLAIN, AAD, ring('k1'));
      expect(thrown(() => open(sealed, AAD, ring('k1'))).code).toBe('decrypt_failed');
    });

    it('does not resolve inherited property names as key ids', () => {
      const sealed = seal(PLAIN, AAD, ring('k1'));
      const forged = { ...sealed, kid: '__proto__' };
      expect(thrown(() => open(forged, AAD, ring('k1'))).code).toBe('unknown_key');
    });
  });

  describe('(e) rotation', () => {
    it('opens with the old key, reports it needs rotation, and a re-seal does not', () => {
      const k1 = newKey();
      const k2 = newKey();
      const before = loadKeyring({ BYOK_KEYS: `k1:${k1}` });
      const after = loadKeyring({ BYOK_KEYS: `k2:${k2},k1:${k1}` });
      expect(after.active).toBe('k2');

      const sealed = seal(PLAIN, AAD, before);
      expect(sealed.kid).toBe('k1');
      expect(needsRotation(sealed, before)).toBe(false);

      expect(open(sealed, AAD, after)).toBe(PLAIN);
      expect(needsRotation(sealed, after)).toBe(true);

      const resealed = seal(open(sealed, AAD, after), AAD, after);
      expect(resealed.kid).toBe('k2');
      expect(needsRotation(resealed, after)).toBe(false);
      expect(open(resealed, AAD, after)).toBe(PLAIN);
    });

    it('treats a record sealed with a key that left the keyring as needing rotation', () => {
      const sealed = seal(PLAIN, AAD, ring('k1'));
      expect(needsRotation(sealed, ring('k2'))).toBe(true);
    });
  });

  describe('(f) a fresh IV for every sealing', () => {
    it('10 000 sealings of the same text have 10 000 different IVs and ciphertexts', () => {
      const r = ring('k1');
      const ivs = new Set<string>();
      const cts = new Set<string>();
      for (let i = 0; i < 10_000; i++) {
        const sealed = seal(PLAIN, AAD, r);
        ivs.add(sealed.iv);
        cts.add(sealed.ct);
      }
      expect(ivs.size).toBe(10_000);
      expect(cts.size).toBe(10_000);
    });
  });

  describe('(g) nothing readable leaks', () => {
    it('the stored record does not contain the plaintext', () => {
      const sealed = seal(PLAIN, AAD, ring('k1'));
      const json = JSON.stringify(sealed);
      expect(json).not.toContain(PLAIN);
      expect(json).not.toContain(PLAIN.slice(3, 20));
      expect(json).not.toContain(Buffer.from(PLAIN).toString('base64'));
      expect(Object.keys(sealed).sort()).toEqual(['ct', 'iv', 'kid', 'tag', 'v']);
    });

    it('error messages are fixed and contain neither plaintext, AAD, key material nor record fields', () => {
      const keyB64 = newKey();
      const r = loadKeyring({ BYOK_KEYS: `k1:${keyB64}` });
      const sealed = seal(PLAIN, AAD, r);
      const errors: ByokCryptoError[] = [
        thrown(() => open(sealed, 'other|aad', r)),
        thrown(() => open({ ...sealed, ct: tamper(sealed.ct) }, AAD, r)),
        thrown(() => open({ ...sealed, kid: 'zz' }, AAD, r)),
        thrown(() => open({ ...sealed, iv: 'x' }, AAD, r)),
        thrown(() => seal(PLAIN, '', r)),
        thrown(() => loadKeyring({ BYOK_KEYS: `k1:${keyB64.slice(2)}` })),
        thrown(() => loadKeyring({ BYOK_KEYS: `K1:${keyB64}` })),
      ];
      const secrets = [
        PLAIN,
        PLAIN.slice(3, 20),
        AAD,
        'other|aad',
        keyB64,
        keyB64.slice(2),
        sealed.ct,
        sealed.iv,
        sealed.tag,
      ];
      for (const err of errors) {
        expect(err.name).toBe('ByokCryptoError');
        const shown = `${err.message}\n${err.stack ?? ''}\n${JSON.stringify(err)}\n${String(err)}`;
        for (const secret of secrets) expect(shown).not.toContain(secret);
        expect(err.message.length).toBeLessThan(120);
        expect((err as { cause?: unknown }).cause).toBeUndefined();
      }
      // the same failure always gives the same message (no oracle between tampering and a wrong AAD)
      expect(errors[0].message).toBe(errors[1].message);
    });
  });

  describe('(h) loadKeyring validates the format', () => {
    const errorOf = (value: string | undefined): ByokCryptoError =>
      thrown(() => loadKeyring({ BYOK_KEYS: value }));

    it('reads several keys; the first is the active one', () => {
      const a = newKey();
      const b = newKey();
      const loaded = loadKeyring({ BYOK_KEYS: ` k1:${a} , k_2-x:${b} ` });
      expect(loaded.active).toBe('k1');
      expect([...loaded.keys.keys()]).toEqual(['k1', 'k_2-x']);
      expect(loaded.keys.get('k1')!.equals(Buffer.from(a, 'base64'))).toBe(true);
      expect(loaded.keys.get('k_2-x')!.equals(Buffer.from(b, 'base64'))).toBe(true);
    });

    it.each([undefined, '', '   '])('rejects a missing keyring (%p)', (value) => {
      expect(errorOf(value).code).toBe('keyring_invalid');
    });

    it.each([16, 24, 31, 33, 64])('rejects a key of %i bytes', (bytes) => {
      expect(errorOf(`k1:${randomBytes(bytes).toString('base64')}`).code).toBe('keyring_invalid');
    });

    it.each([
      ['uppercase', 'K1'],
      ['dot', 'k.1'],
      ['space', 'k 1'],
      ['too long', 'a'.repeat(17)],
      ['empty', ''],
      ['accent', 'ké'],
    ])('rejects a key id that is %s', (_name, id) => {
      expect(errorOf(`${id}:${newKey()}`).code).toBe('keyring_invalid');
    });

    it('accepts ids of 1 and 16 characters', () => {
      expect(() =>
        loadKeyring({ BYOK_KEYS: `a:${newKey()},${'z'.repeat(16)}:${newKey()}` })
      ).not.toThrow();
    });

    it('rejects duplicate ids', () => {
      expect(errorOf(`k1:${newKey()},k1:${newKey()}`).code).toBe('keyring_invalid');
    });

    it.each([
      'k1',
      'k1:',
      ':abc',
      `k1:${newKey()}:extra`,
      'k1:not-base64!!!',
      `k1:${newKey()},`,
      `,k1:${newKey()}`,
      'k1:  ',
    ])('rejects the malformed entry %p', (value) => {
      expect(errorOf(value).code).toBe('keyring_invalid');
    });

    it('rejects non-canonical base64 (padding missing, urlsafe alphabet)', () => {
      const raw = randomBytes(32);
      expect(errorOf(`k1:${raw.toString('base64').replace(/=+$/, '')}`).code).toBe(
        'keyring_invalid'
      );
      const urlsafe = Buffer.alloc(32, 0xfb).toString('base64url');
      expect(errorOf(`k1:${urlsafe}`).code).toBe('keyring_invalid');
    });

    it('never echoes the value (neither ids nor key bytes) in the message', () => {
      const key = newKey();
      for (const value of [
        `secretid:${key.slice(5)}`,
        `Secret:${key}`,
        `k1:${key},k1:${key}`,
        `onlyonetoken${key}`,
      ]) {
        const shown = errorOf(value).message;
        expect(shown).not.toContain(key);
        expect(shown).not.toContain(key.slice(5));
        expect(shown).not.toMatch(/secretid|Secret|onlyonetoken/);
      }
    });

    it('the loaded keyring cannot be changed by the caller', () => {
      const loaded = loadKeyring({ BYOK_KEYS: `k1:${newKey()}` });
      expect(Object.isFrozen(loaded)).toBe(true);
    });
  });

  describe('generateKeyEntry (byok:genkey)', () => {
    it('makes a random `<id>:<base64 of 32 bytes>` line that loadKeyring accepts', () => {
      const a = generateKeyEntry();
      const b = generateKeyEntry();
      expect(a).toMatch(/^k1:[A-Za-z0-9+/]{43}=$/);
      expect(a).not.toBe(b);
      expect(loadKeyring({ BYOK_KEYS: a }).active).toBe('k1');
      expect(generateKeyEntry('k2').startsWith('k2:')).toBe(true);
    });

    it('rejects an invalid id', () => {
      expect(thrown(() => generateKeyEntry('NO')).code).toBe('keyring_invalid');
    });

    it('the script prints a single line and nothing else', () => {
      const cwd = path.resolve(__dirname, '../..');
      const script = path.join(cwd, 'scripts', 'byok-genkey.ts');
      const run = (...args: string[]): string =>
        execFileSync(process.execPath, ['--import', 'tsx', script, ...args], {
          encoding: 'utf8',
          cwd,
          env: { ...process.env, BYOK_KEYS: '' },
        });
      const out = run();
      expect(out.endsWith('\n')).toBe(true);
      expect(out.trimEnd().split('\n')).toHaveLength(1);
      expect(() => loadKeyring({ BYOK_KEYS: out.trim() })).not.toThrow();
      expect(out.trim().startsWith('k1:')).toBe(true);
      expect(run('k7').trim().startsWith('k7:')).toBe(true);
    }, 60_000);
  });

  describe('(i) assertProdConfig', () => {
    const prod = (extra: Record<string, string | undefined>): NodeJS.ProcessEnv => ({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://app.mockia.io',
      MONGODB_URI: 'mongodb://mockia:s3cr3t-Pr0d-pass@mongo:27017/mockia?authSource=admin',
      APP_URL: 'https://app.mockia.io',
      JWT_ACCESS_SECRET: 'a'.repeat(48),
      JWT_REFRESH_SECRET: 'b'.repeat(48),
      ...extra,
    });

    it('asks for nothing when BYOK is off (unset, empty, false)', () => {
      expect(() => assertProdConfig(prod({}))).not.toThrow();
      expect(() => assertProdConfig(prod({ BYOK_ENABLED: '', BYOK_KEYS: '' }))).not.toThrow();
      expect(() => assertProdConfig(prod({ BYOK_ENABLED: 'false' }))).not.toThrow();
      // a broken keyring is only checked when the feature is on
      expect(() =>
        assertProdConfig(prod({ BYOK_ENABLED: 'false', BYOK_KEYS: 'garbage' }))
      ).not.toThrow();
    });

    it('accepts BYOK_ENABLED=true with a valid keyring', () => {
      expect(() =>
        assertProdConfig(prod({ BYOK_ENABLED: 'true', BYOK_KEYS: `k1:${newKey()}` }))
      ).not.toThrow();
    });

    it.each(['true', 'TRUE', '1', 'yes', 'on'])(
      'BYOK_ENABLED=%s without a keyring stops the boot',
      (flag) => {
        expect(() => assertProdConfig(prod({ BYOK_ENABLED: flag }))).toThrow(/BYOK_KEYS/);
        expect(() => assertProdConfig(prod({ BYOK_ENABLED: flag, BYOK_KEYS: '' }))).toThrow(
          /BYOK_KEYS/
        );
      }
    );

    it('rejects an invalid keyring without echoing it', () => {
      const key = newKey();
      for (const bad of [
        `k1:${key.slice(4)}`,
        `K1:${key}`,
        `k1:${key},k1:${key}`,
        `justsomething${key}`,
      ]) {
        let message = '';
        try {
          assertProdConfig(prod({ BYOK_ENABLED: 'true', BYOK_KEYS: bad }));
        } catch (err) {
          message = (err as Error).message;
        }
        expect(message).toMatch(/BYOK_KEYS/);
        expect(message).not.toContain(key);
        expect(message).not.toContain(key.slice(4));
        expect(message).not.toContain('justsomething');
      }
    });

    it('does not check anything outside production', () => {
      expect(() =>
        assertProdConfig({ NODE_ENV: 'development', BYOK_ENABLED: 'true' } as NodeJS.ProcessEnv)
      ).not.toThrow();
    });
  });
});
