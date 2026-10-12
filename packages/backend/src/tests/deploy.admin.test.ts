import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { getAdminEmails } from '../config/admin.js';
import { assertProdConfig } from '../config/assertProdConfig.js';

/**
 * Task O2: ADMIN_EMAILS (who is the owner) must be settable in every deployment and ship EMPTY, which means "nobody is
 * an administrator". The compose file passes an unset ${VAR:-} as an empty string, so empty must be accepted everywhere.
 * The value is an address, not a secret, but it is the list of who can see the metrics: it has no value in the repository.
 */

const ROOT = path.resolve(__dirname, '../../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const render = yaml.load(read('render.yaml')) as {
  services: Array<{
    name: string;
    envVars: Array<{ key: string; value?: unknown; sync?: boolean }>;
  }>;
};
const compose = yaml.load(read('docker-compose.prod.yml')) as {
  services: Record<string, { environment?: Record<string, string> }>;
};

describe('ADMIN_EMAILS reaches the backend in production and ships empty', () => {
  it('render.yaml lists it on the backend as optional (sync: false, no value in the file)', () => {
    const backend = render.services.find((s) => s.name === 'mockia-backend')!;
    expect(backend.envVars.find((v) => v.key === 'ADMIN_EMAILS')).toEqual({
      key: 'ADMIN_EMAILS',
      sync: false,
    });
  });

  it('render.yaml does not hand it to the static frontend', () => {
    const frontend = render.services.find((s) => s.name === 'mockia-frontend')!;
    expect(frontend.envVars.find((v) => v.key === 'ADMIN_EMAILS')).toBeUndefined();
  });

  it('docker-compose.prod.yml forwards it to the backend only, as ${ADMIN_EMAILS:-} (empty when unset, never required)', () => {
    expect(compose.services.backend.environment?.ADMIN_EMAILS).toBe('${ADMIN_EMAILS:-}');
    for (const name of ['frontend', 'mongo']) {
      expect(compose.services[name]?.environment?.ADMIN_EMAILS).toBeUndefined();
    }
  });

  it('both .env.example document it, empty', () => {
    expect(read('.env.example')).toMatch(/^ADMIN_EMAILS=$/m);
    expect(read('packages/backend/.env.example')).toMatch(/^# ADMIN_EMAILS=$/m);
  });

  it('what a deployment hands over when the owner sets nothing (an empty string) boots and makes nobody an administrator', () => {
    expect(getAdminEmails({ ADMIN_EMAILS: '' } as NodeJS.ProcessEnv).size).toBe(0);
    expect(() =>
      assertProdConfig({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'a'.repeat(48),
        JWT_REFRESH_SECRET: 'b'.repeat(48),
        MONGODB_URI: 'mongodb://user:s3cr3tpass@mongo:27017/mockia?authSource=admin',
        CORS_ORIGIN: 'https://app.example.com',
        APP_URL: 'https://app.example.com',
        ADMIN_EMAILS: '',
      } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });
});
