import fs from 'fs';
import path from 'path';

/**
 * Every Dockerfile runs the same Node major as the CI (22): Node 20 reached end of life and the current
 * dependencies (e.g. @faker-js/faker 10) ask for Node >= 20.19.
 */
const ROOT = path.resolve(__dirname, '../../../..');

const DOCKERFILES = [
  'Dockerfile',
  'packages/backend/Dockerfile.dev',
  'packages/backend/Dockerfile.prod',
  'packages/frontend/Dockerfile.dev',
  'packages/frontend/Dockerfile.prod',
];

describe('Dockerfiles: Node version', () => {
  it.each(DOCKERFILES)('%s uses node:22', (file) => {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const bases = text.match(/^FROM\s+node:\S+/gim) ?? [];
    expect(bases.length).toBeGreaterThan(0);
    for (const base of bases) expect(base).toMatch(/node:22(-|\s|$)/);
  });
});
