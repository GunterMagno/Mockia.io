import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { assertProdConfig } from '../config/assertProdConfig.js';

/**
 * Task K1: the "bring your own AI key" feature (D7) ships OFF in every deployment. BYOK_KEYS is the keyring that seals
 * the users' keys: a secret that has NO value anywhere in the repository and never reaches the static frontend. The
 * compose file passes an unset ${VAR:-} as an empty string, so empty must boot.
 */

const ROOT = path.resolve(__dirname, '../../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

type RenderVar = { key: string; value?: unknown; sync?: boolean; generateValue?: boolean };
const render = yaml.load(read('render.yaml')) as {
  services: Array<{ name: string; envVars: RenderVar[] }>;
};
const compose = yaml.load(read('docker-compose.prod.yml')) as {
  services: Record<string, { environment?: Record<string, string> }>;
};

const renderVar = (service: string, key: string): RenderVar | undefined =>
  render.services.find((s) => s.name === service)!.envVars.find((v) => v.key === key);

const BYOK_VARS = [
  'BYOK_ENABLED',
  'BYOK_KEYS',
  'BYOK_ALLOW_CUSTOM_URLS',
  'BYOK_MAX_MONTHLY_GENERATIONS',
];

describe('BYOK settings reach the backend in production, switched off and without secrets in the repo', () => {
  it('render.yaml: BYOK_ENABLED and BYOK_KEYS are filled in by hand (sync: false, no value, no generated value)', () => {
    expect(renderVar('mockia-backend', 'BYOK_ENABLED')).toEqual({
      key: 'BYOK_ENABLED',
      sync: false,
    });
    // never a value, never generateValue: Render would invent a keyring the owner cannot back up or rotate
    expect(renderVar('mockia-backend', 'BYOK_KEYS')).toEqual({ key: 'BYOK_KEYS', sync: false });
  });

  it('render.yaml: custom URLs are off and the monthly cap is 3000 by default', () => {
    expect(renderVar('mockia-backend', 'BYOK_ALLOW_CUSTOM_URLS')?.value).toBe('false');
    expect(String(renderVar('mockia-backend', 'BYOK_MAX_MONTHLY_GENERATIONS')?.value)).toBe('3000');
  });

  it('render.yaml does not hand any of them to the static frontend', () => {
    for (const key of BYOK_VARS) expect(renderVar('mockia-frontend', key)).toBeUndefined();
  });

  it('docker-compose.prod.yml forwards them to the backend only, with safe defaults (off, no keyring, no custom URLs)', () => {
    const env = compose.services.backend.environment!;
    expect(env.BYOK_ENABLED).toBe('${BYOK_ENABLED:-false}');
    expect(env.BYOK_KEYS).toBe('${BYOK_KEYS:-}');
    expect(env.BYOK_ALLOW_CUSTOM_URLS).toBe('${BYOK_ALLOW_CUSTOM_URLS:-false}');
    expect(env.BYOK_MAX_MONTHLY_GENERATIONS).toBe('${BYOK_MAX_MONTHLY_GENERATIONS:-3000}');
    for (const name of ['frontend', 'mongo']) {
      for (const key of BYOK_VARS) {
        expect(compose.services[name]?.environment?.[key]).toBeUndefined();
      }
    }
  });

  it('both .env.example document them with the safe defaults and no key', () => {
    const root = read('.env.example');
    expect(root).toMatch(/^BYOK_ENABLED=false$/m);
    expect(root).toMatch(/^BYOK_KEYS=$/m);
    expect(root).toMatch(/^BYOK_ALLOW_CUSTOM_URLS=false$/m);
    expect(root).toMatch(/^BYOK_MAX_MONTHLY_GENERATIONS=3000$/m);

    const backend = read('packages/backend/.env.example');
    expect(backend).toMatch(/^# BYOK_ENABLED=false$/m);
    expect(backend).toMatch(/^# BYOK_KEYS=$/m);
    expect(backend).toMatch(/^# BYOK_ALLOW_CUSTOM_URLS=false$/m);
    expect(backend).toMatch(/^# BYOK_MAX_MONTHLY_GENERATIONS=3000$/m);
  });

  it('no file that ships a deployment holds a BYOK_KEYS value', () => {
    for (const rel of ['render.yaml', 'docker-compose.prod.yml', '.env.example']) {
      expect(read(rel)).not.toMatch(/BYOK_KEYS\s*[:=]\s*["']?[a-z0-9_-]{1,16}:[A-Za-z0-9+/]{43}=/);
    }
    expect(read('packages/backend/.env.example')).not.toMatch(/[A-Za-z0-9+/]{43}=/);
  });

  it('what a deployment hands over when the owner sets nothing boots (feature off, empty keyring)', () => {
    expect(() =>
      assertProdConfig({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'a'.repeat(48),
        JWT_REFRESH_SECRET: 'b'.repeat(48),
        MONGODB_URI: 'mongodb://user:s3cr3tpass@mongo:27017/mockia?authSource=admin',
        CORS_ORIGIN: 'https://app.example.com',
        APP_URL: 'https://app.example.com',
        BYOK_ENABLED: 'false',
        BYOK_KEYS: '',
        BYOK_ALLOW_CUSTOM_URLS: 'false',
        BYOK_MAX_MONTHLY_GENERATIONS: '3000',
      } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });
});
