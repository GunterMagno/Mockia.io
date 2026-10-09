import fs from 'fs/promises';
import path from 'path';

// The clone writes part of the repository and then fails (network drop, missing branch, private repo...)
jest.mock('simple-git', () => ({
  simpleGit: () => ({
    raw: async (args: string[]) => {
      const target = args[args.length - 1];
      await (await import('fs/promises')).writeFile(path.join(target, 'partial.txt'), 'half a repository');
      throw new Error('fatal: unable to access: connection reset');
    },
  }),
}));

import { cloneRepository } from '../services/github.service.js';

/** Privacy promises the temporary copy of a repository is deleted: also when the clone fails half-way. */
describe('cloneRepository removes its temporary directory when the clone fails', () => {
  const tmpRoot = path.join(process.cwd(), '.tmp-repos');
  const owner = `cleanup-owner-${Date.now()}`;

  const leftovers = async () =>
    (await fs.readdir(tmpRoot).catch(() => [] as string[])).filter((name) => name.startsWith(`${owner}-`));

  it('no partial clone is left on disk', async () => {
    await expect(cloneRepository(owner, 'repo', 'main')).rejects.toBeDefined();
    expect(await leftovers()).toEqual([]);
  });
});
