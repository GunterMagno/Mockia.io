import fs from 'fs/promises';
import path from 'path';

// What git is asked to do with a repository URL that came from a user: only https://github.com, never an option.
const rawCalls: string[][] = [];
const envCalls: Array<Record<string, string | undefined>> = [];

jest.mock('simple-git', () => ({
  simpleGit: () => {
    const client = {
      env: (values: Record<string, string | undefined>) => {
        envCalls.push(values);
        return client;
      },
      raw: async (args: string[]) => {
        rawCalls.push(args);
        return '';
      },
    };
    return client;
  },
}));

import { cloneRepository } from '../services/github.service.js';

const tmpRoot = path.join(process.cwd(), '.tmp-repos');

describe('cloneRepository only talks https to github.com and never lets user text become a git option', () => {
  beforeEach(() => {
    rawCalls.length = 0;
    envCalls.length = 0;
  });

  afterAll(async () => {
    // Nothing is cloned for real: remove the empty directories the happy-path cases created
    const names = await fs.readdir(tmpRoot).catch(() => [] as string[]);
    await Promise.all(
      names
        .filter((n) => n.startsWith('sec-owner-'))
        .map((n) => fs.rm(path.join(tmpRoot, n), { recursive: true, force: true }))
    );
  });

  it('builds a fixed https://github.com URL and puts "--" before it', async () => {
    const dir = await cloneRepository('sec-owner-a', 'my.repo_1', 'feature/x-1');
    expect(rawCalls).toHaveLength(1);
    const args = rawCalls[0];
    expect(args.slice(0, 3)).toEqual(['clone', '--branch', 'feature/x-1']);
    expect(args[3]).toBe('--');
    expect(args[4]).toBe('https://github.com/sec-owner-a/my.repo_1.git');
    expect(args[5]).toBe(dir);
  });

  it('without branch there is no --branch and still a "--" separator', async () => {
    await cloneRepository('sec-owner-b', 'repo');
    expect(rawCalls[0].slice(0, 2)).toEqual(['clone', '--']);
    expect(rawCalls[0][2]).toBe('https://github.com/sec-owner-b/repo.git');
  });

  it('restricts git to the https protocol and never prompts for credentials', async () => {
    await cloneRepository('sec-owner-c', 'repo');
    expect(envCalls).toHaveLength(1);
    expect(envCalls[0].GIT_ALLOW_PROTOCOL).toBe('https');
    expect(envCalls[0].GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('the git process does not inherit the server secrets nor GIT_*/EDITOR variables', async () => {
    const saved = { ...process.env };
    process.env.JWT_SECRET = 'must-not-leak';
    process.env.MONGODB_URI = 'mongodb://user:pass@host/db';
    process.env.GIT_SSH_COMMAND = 'ssh -o evil';
    process.env.EDITOR = 'vim';
    try {
      await cloneRepository('sec-owner-d', 'repo');
    } finally {
      process.env = saved;
    }
    const keys = Object.keys(envCalls[0]);
    expect(keys).not.toContain('JWT_SECRET');
    expect(keys).not.toContain('MONGODB_URI');
    expect(keys).not.toContain('GIT_SSH_COMMAND');
    expect(keys).not.toContain('EDITOR');
    expect(keys.map((k) => k.toLowerCase())).toContain('path');
  });

  it.each([
    ['option as owner', '--upload-pack=evil', 'repo', undefined],
    ['option as repo', 'owner', '--config=core.sshCommand=evil', undefined],
    ['ext transport in owner', 'ext::sh -c touch /tmp/pwn', 'repo', undefined],
    ['file transport in repo', 'owner', 'file:///etc/passwd', undefined],
    ['dots only as owner', '..', 'repo', undefined],
    ['dots only as repo', 'owner', '.', undefined],
    ['space in owner', 'own er', 'repo', undefined],
    ['at sign (userinfo) in repo', 'owner', 'x@evil.com', undefined],
    ['option as branch', 'owner', 'repo', '--upload-pack=touch /tmp/pwn'],
    ['option-like short branch', 'owner', 'repo', '-c'],
    ['parent traversal in branch', 'owner', 'repo', 'a/../b'],
    ['space in branch', 'owner', 'repo', 'main --depth=1'],
    ['control char in branch', 'owner', 'repo', 'main\n--evil'],
    ['empty owner', '', 'repo', undefined],
  ])('rejects %s with a 400 before running git', async (_label, owner, repo, branch) => {
    await expect(cloneRepository(owner, repo, branch)).rejects.toMatchObject({ statusCode: 400 });
    expect(rawCalls).toHaveLength(0);
  });
});
