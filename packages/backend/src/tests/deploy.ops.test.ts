import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { assertProdConfig } from '../config/assertProdConfig.js';

/**
 * Task O3: OPS_TOKEN (the bearer token of GET /api/ops/summary) must be settable in every deployment and ship EMPTY,
 * which means "the endpoint does not exist". It is a secret: it has no value anywhere in the repository, and it never
 * reaches the static frontend. The compose file passes an unset ${VAR:-} as an empty string, so empty must boot.
 */

const ROOT = path.resolve(__dirname, '../../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const render = yaml.load(read('render.yaml')) as {
  services: Array<{
    name: string;
    envVars: Array<{ key: string; value?: unknown; sync?: boolean; generateValue?: boolean }>;
  }>;
};
const compose = yaml.load(read('docker-compose.prod.yml')) as {
  services: Record<string, { environment?: Record<string, string> }>;
};

describe('OPS_TOKEN reaches the backend in production and ships empty', () => {
  it('render.yaml lists it on the backend as a secret to fill in by hand (sync: false, no value, no generated value)', () => {
    const backend = render.services.find((s) => s.name === 'mockia-backend')!;
    expect(backend.envVars.find((v) => v.key === 'OPS_TOKEN')).toEqual({
      key: 'OPS_TOKEN',
      sync: false,
    });
  });

  it('render.yaml does not hand it to the static frontend', () => {
    const frontend = render.services.find((s) => s.name === 'mockia-frontend')!;
    expect(frontend.envVars.find((v) => v.key === 'OPS_TOKEN')).toBeUndefined();
  });

  it('docker-compose.prod.yml forwards it to the backend only, as ${OPS_TOKEN:-} (empty when unset, never required)', () => {
    expect(compose.services.backend.environment?.OPS_TOKEN).toBe('${OPS_TOKEN:-}');
    for (const name of ['frontend', 'mongo']) {
      expect(compose.services[name]?.environment?.OPS_TOKEN).toBeUndefined();
    }
  });

  it('both .env.example document it, empty', () => {
    expect(read('.env.example')).toMatch(/^OPS_TOKEN=$/m);
    expect(read('packages/backend/.env.example')).toMatch(/^# OPS_TOKEN=$/m);
  });

  it('what a deployment hands over when the owner sets nothing (an empty string) boots', () => {
    expect(() =>
      assertProdConfig({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'a'.repeat(48),
        JWT_REFRESH_SECRET: 'b'.repeat(48),
        MONGODB_URI: 'mongodb://user:s3cr3tpass@mongo:27017/mockia?authSource=admin',
        CORS_ORIGIN: 'https://app.example.com',
        APP_URL: 'https://app.example.com',
        OPS_TOKEN: '',
      } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });

  it('the commit shown by /api/health can be handed over: render.yaml needs nothing (Render sets RENDER_GIT_COMMIT), compose forwards GIT_COMMIT', () => {
    expect(compose.services.backend.environment?.GIT_COMMIT).toBe('${GIT_COMMIT:-}');
  });
});
