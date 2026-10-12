import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { parseAiPrices } from '../config/aiPrices.js';
import { assertProdConfig } from '../config/assertProdConfig.js';

/**
 * Task P1: AI_PRICES_JSON (the owner's price table for the cost estimate of the metrics panel) must be settable in
 * every deployment and ship EMPTY, which means "no table, no cost estimate". The compose file passes an unset ${VAR:-}
 * as an empty string, so empty must be accepted everywhere. It holds prices, not secrets, but it is the owner's
 * contract with the providers and has no value in the repository.
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

describe('AI_PRICES_JSON reaches the backend in production and ships empty', () => {
  it('render.yaml lists it on the backend as optional (sync: false, no value in the file)', () => {
    const backend = render.services.find((s) => s.name === 'mockia-backend')!;
    expect(backend.envVars.find((v) => v.key === 'AI_PRICES_JSON')).toEqual({
      key: 'AI_PRICES_JSON',
      sync: false,
    });
  });

  it('render.yaml does not hand it to the static frontend', () => {
    const frontend = render.services.find((s) => s.name === 'mockia-frontend')!;
    expect(frontend.envVars.find((v) => v.key === 'AI_PRICES_JSON')).toBeUndefined();
  });

  it('docker-compose.prod.yml forwards it to the backend only, as ${AI_PRICES_JSON:-} (empty when unset, never required)', () => {
    expect(compose.services.backend.environment?.AI_PRICES_JSON).toBe('${AI_PRICES_JSON:-}');
    for (const name of ['frontend', 'mongo']) {
      expect(compose.services[name]?.environment?.AI_PRICES_JSON).toBeUndefined();
    }
  });

  it('both .env.example document it, empty, with the format', () => {
    expect(read('.env.example')).toMatch(/^AI_PRICES_JSON=$/m);
    expect(read('packages/backend/.env.example')).toMatch(/^# AI_PRICES_JSON=$/m);
    for (const file of ['.env.example', 'packages/backend/.env.example']) {
      expect(read(file)).toMatch(/inputPerMTok/);
    }
  });

  it('what a deployment hands over when the owner sets nothing (an empty string) boots and means no table', () => {
    expect(parseAiPrices({ AI_PRICES_JSON: '' } as NodeJS.ProcessEnv).status).toBe('none');
    expect(() =>
      assertProdConfig({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'a'.repeat(48),
        JWT_REFRESH_SECRET: 'b'.repeat(48),
        MONGODB_URI: 'mongodb://user:s3cr3tpass@mongo:27017/mockia?authSource=admin',
        CORS_ORIGIN: 'https://app.example.com',
        APP_URL: 'https://app.example.com',
        AI_PRICES_JSON: '',
      } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });
});
