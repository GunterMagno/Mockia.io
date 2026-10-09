import { anonymizePromptIdentifiers } from '../modules/ai/anonymize.js';
import { redactSecrets } from '../modules/ai/redact.js';
import { buildPromptFromInput, type PromptInput } from '../modules/ai/prompt.service.js';

/**
 * The stored prompt carries who the repository and the project are. The tests are driven by the REAL prompt builder, so
 * a change in its format that reintroduces an identifier fails here instead of silently leaking.
 */

const OWNER = 'zelda-acme-labs';
const REPO = 'gym-booking-secret-repo';
const TITLE = 'Acme Internal Gym Portal';
const DESCRIPTION = 'Portal for the Acme Corp Madrid branch members';

const withRepo: PromptInput = {
  projectTitle: TITLE,
  projectDescription: DESCRIPTION,
  context: {
    repoName: REPO,
    repoUrl: `https://github.com/${OWNER}/${REPO}`,
    repoOwner: OWNER,
    branch: 'feature/acme-payroll',
    summary: 'Repository with 2 analyzed files (1 interfaces, 0 functions, 2 API routes)',
    stats: { totalFiles: 2, totalInterfaces: 1, totalFunctions: 0, totalRoutes: 2 },
    files: [
      { path: 'README.md', type: 'other', summary: '# Gym\nBook classes. Maintained by Maria Gonzalez (maria@acme.io).' },
      { path: 'src/routes/members.ts', type: 'typescript', summary: 's', routes: [{ methods: ['GET'], path: '/members' }] },
    ],
  },
  userInput: 'Members and classes',
};
const noRepo: PromptInput = { projectTitle: TITLE, projectDescription: DESCRIPTION, context: null, userInput: 'Members and classes' };
const noRepoNoDescription: PromptInput = { projectTitle: TITLE, context: null, userInput: 'Members and classes' };

const promptText = (input: PromptInput) => buildPromptFromInput(input).map((m) => anonymizePromptIdentifiers(m.content)).join('\n----\n');

describe('anonymizePromptIdentifiers with the real prompt builder', () => {
  it('a prompt with a repository loses owner, repo name, URL and branch', () => {
    const out = promptText(withRepo);
    for (const secret of [OWNER, REPO, `github.com/${OWNER}`, 'feature/acme-payroll']) expect(out).not.toContain(secret);
    expect(out).toContain('## Repository: [REDACTED_REPO]');
    expect(out).toContain('Owner: [REDACTED_OWNER]');
    expect(out).toContain('Branch: [REDACTED_BRANCH]');
    expect(out).toMatch(/URL: \[REDACTED_REPO\]/);
  });

  it('the task part of a prompt with a repository is untouched (instructions, user requirement)', () => {
    const out = promptText(withRepo);
    expect(out).toContain('Members and classes');
    expect(out).toContain('Based EXCLUSIVELY on the project description');
    expect(out).toContain('src/routes/members.ts');
    expect(out).toContain('Total Files: 2');
  });

  it('a prompt without a repository loses the project title and description in both places they appear', () => {
    const out = promptText(noRepo);
    expect(out).not.toContain(TITLE);
    expect(out).not.toContain(DESCRIPTION);
    expect(out).not.toContain('Acme');
    expect(out).toContain('## Project: [REDACTED_PROJECT]');
    expect(out).toContain('Members and classes');
    expect(out).toContain('No GitHub context available yet.');
    expect(out).toContain('MAXIMUM CREATIVE FREEDOM');
  });

  it('the default description text ("A software application") is handled too', () => {
    const out = promptText(noRepoNoDescription);
    expect(out).not.toContain(TITLE);
    expect(out).toContain('## Project: [REDACTED_PROJECT]');
  });

  it('a multi-line description and a title with quotes and parentheses are fully masked', () => {
    const input: PromptInput = {
      projectTitle: 'My "App" (v2)',
      projectDescription: 'line one SECRETWORD\nline two (with "quotes") SECRETWORD2',
      context: null,
      userInput: 'x',
    };
    const out = promptText(input);
    for (const s of ['My "App"', '(v2)', 'SECRETWORD', 'SECRETWORD2', 'line two']) expect(out).not.toContain(s);
    expect(out).toContain('x');
  });

  it('is idempotent on real prompts', () => {
    for (const input of [withRepo, noRepo, noRepoNoDescription]) {
      for (const m of buildPromptFromInput(input)) {
        const once = anonymizePromptIdentifiers(m.content);
        expect(anonymizePromptIdentifiers(once)).toBe(once);
        expect(redactSecrets(once)).toBe(redactSecrets(redactSecrets(once)));
      }
    }
  });

  it('keeps working together with redactSecrets (the dataset applies both)', () => {
    const out = buildPromptFromInput(withRepo).map((m) => redactSecrets(anonymizePromptIdentifiers(m.content))).join('\n');
    expect(out).not.toContain(OWNER);
    expect(out).not.toContain('maria@acme.io');
  });

  it('does NOT claim to remove a person named inside README text', () => {
    // documented limit: names (and other personal data typed inside the README) are not identifiers we can detect
    const out = promptText(withRepo);
    expect(out).toContain('Maria Gonzalez');
  });
});

describe('anonymizePromptIdentifiers: repository URLs anywhere in the text', () => {
  const cases: Array<[string, string, string]> = [
    ['https github', 'See https://github.com/some-owner/some-repo for details', 'some-owner'],
    ['with .git', 'git clone https://github.com/some-owner/some-repo.git now', 'some-owner'],
    ['no scheme', 'Source at github.com/some-owner/some-repo', 'some-owner'],
    ['www', 'https://www.github.com/some-owner/some-repo', 'some-owner'],
    ['owner only (profile)', 'Profile https://github.com/some-owner', 'some-owner'],
    ['gitlab', 'https://gitlab.com/some-owner/some-repo', 'some-owner'],
    ['bitbucket', 'https://bitbucket.org/some-owner/some-repo', 'some-owner'],
    ['ssh scp style', 'git@github.com:some-owner/some-repo.git', 'some-owner'],
    ['ssh url', 'ssh://git@gitlab.com/some-owner/some-repo.git', 'some-owner'],
    ['badge in README', '![build](https://github.com/some-owner/some-repo/actions/workflows/ci.yml/badge.svg)', 'some-owner'],
  ];
  it.each(cases)('%s', (_n, text, owner) => {
    const out = anonymizePromptIdentifiers(text);
    expect(out).not.toContain(owner);
    expect(out).toContain('[REDACTED_REPO]');
  });

  it('text without such URLs is unchanged', () => {
    for (const t of ['Use the GitHub API to list repos', 'Visit https://example.com/some-owner/some-repo', 'The repository owner', 'Owner of the gym: the members']) {
      expect(anonymizePromptIdentifiers(t)).toBe(t);
    }
  });

  it('empty input passes through', () => {
    expect(anonymizePromptIdentifiers('')).toBe('');
  });

  it('handles very long input quickly', () => {
    const big = ('lorem ipsum github dolor ' + 'a'.repeat(60) + ' ').repeat(5000);
    const t0 = Date.now();
    anonymizePromptIdentifiers(big);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

// Superlinear regex guard (C4): crafted 100 KB inputs must finish fast
describe('anonymizePromptIdentifiers on adversarial 100 KB input', () => {
  const timed = (input: string) => {
    const t0 = Date.now();
    anonymizePromptIdentifiers(input);
    return Date.now() - t0;
  };
  it('many unterminated "Project Name (" sentences: < 200 ms', () => {
    expect(timed('Project Name ("x") and Description ("'.repeat(2800))).toBeLessThan(200);
  });
  it('many "Project Name (" openings without a closing: < 200 ms', () => {
    expect(timed('Project Name ("'.repeat(7000))).toBeLessThan(200);
  });
  it('many "## Project:" blocks without the closing line: < 200 ms', () => {
    expect(timed('## Project: x\nDescription: y\n'.repeat(3500))).toBeLessThan(200);
  });
  it('a long description (over 600 characters) is still anonymised', () => {
    const long = 'd'.repeat(5000);
    const out = anonymizePromptIdentifiers(`Project Name ("Gym") and Description ("${long}"), generate a beautiful API`);
    expect(out).not.toContain(long);
  });
  it('a real sentence is still anonymised', () => {
    const out = anonymizePromptIdentifiers('Project Name ("Gym") and Description ("A gym API"), generate a beautiful API');
    expect(out).not.toContain('Gym');
    expect(out).not.toContain('A gym API');
  });
});
