import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { Types } from 'mongoose';
import { connectDB, disconnectDB } from '../config/connection.js';
import { UserModel } from '../models/User.js';
import { AiGenerationModel } from '../models/AiGeneration.js';
import { AiFeedbackModel } from '../models/AiFeedback.js';
import { buildDataset, runExportCli, splitBucket } from '../modules/ai/dataset.js';
import { buildPromptFromInput } from '../modules/ai/prompt.service.js';

/**
 * The dataset exporter: only users whose consent is granted RIGHT NOW, only feedback that says "good" or carries a
 * correction, redacted, deduplicated, anonymous, split deterministically.
 */

const rep = (c: string, n: number) => c.repeat(n);
const SK = 'sk_' + 'live_' + rep('a1B2', 6);
const GHP = 'ghp' + '_' + rep('A1b2C3', 7);

const specWith = (extra: Record<string, unknown> = {}, path = '/members') => ({
  apiVersion: '1.0.0',
  title: 'Gym API',
  description: 'd',
  endpoints: [{ path, method: 'GET', description: 'List', examples: [{ request: {}, response: { id: 1 } }] }],
  dataModels: [],
  ...extra,
});

interface SeedOpts {
  email?: string;
  consent?: { granted: boolean; at: Date } | null;
  userText?: string;
  system?: string;
  output?: string;
  parsedOk?: boolean;
  verdict?: 'good' | 'bad' | null;
  corrected?: unknown;
  expiresAt?: Date;
  user?: { _id: Types.ObjectId };
}

let counter = 0;
async function seed(opts: SeedOpts = {}) {
  counter++;
  const user =
    opts.user ??
    (await UserModel.create({
      email: opts.email ?? `u${counter}-${Date.now()}@example.com`,
      username: `u${counter}`,
      passwordHash: 'x'.repeat(20),
      ...(opts.consent === null ? {} : { aiTrainingConsent: opts.consent ?? { granted: true, at: new Date() } }),
    }));
  const generationId = crypto.randomUUID();
  await AiGenerationModel.create({
    generationId,
    userId: user._id,
    messages: [
      { role: 'system', content: opts.system ?? 'You generate mock APIs.' },
      { role: 'user', content: opts.userText ?? `Make an API number ${counter}` },
    ],
    output: opts.output ?? JSON.stringify(specWith({}, `/p${counter}`)),
    parsedOk: opts.parsedOk ?? true,
    provider: 'fake',
    model: 'm',
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 86_400_000 * 100),
  });
  if (opts.verdict !== null) {
    await AiFeedbackModel.create({
      userId: user._id,
      generationId,
      verdict: opts.verdict ?? 'good',
      provider: 'fake',
      model: 'm',
      ...(opts.corrected !== undefined ? { correctedOutput: opts.corrected } : {}),
      expiresAt: new Date(Date.now() + 86_400_000 * 100),
    });
  }
  return { user, generationId };
}

const lines = (r: { train: string[]; val: string[] }) => [...r.train, ...r.val].map((l) => JSON.parse(l) as { messages: Array<{ role: string; content: string }> });

describe('dataset export', () => {
  beforeAll(async () => {
    await connectDB();
  });
  beforeEach(async () => {
    await Promise.all([UserModel, AiGenerationModel, AiFeedbackModel].map((m) => (m as any).deleteMany({})));
  });
  afterAll(async () => {
    await Promise.all([UserModel, AiGenerationModel, AiFeedbackModel].map((m) => (m as any).deleteMany({})));
    await disconnectDB();
  });

  describe('what goes in', () => {
    it('a consenting user\'s "good" generation becomes one chat line: system, user, assistant', async () => {
      await seed({ userText: 'Gym members CRUD' });
      const r = await buildDataset();
      const all = lines(r);
      expect(all).toHaveLength(1);
      const [line] = all;
      expect(Object.keys(line)).toEqual(['messages']);
      expect(line.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
      expect(line.messages[1].content).toBe('Gym members CRUD');
      expect(JSON.parse(line.messages[2].content).endpoints).toHaveLength(1);
      expect(r.counts.included).toBe(1);
    });

    it('each line is a single physical line of valid JSON', async () => {
      await seed({ output: JSON.stringify(specWith({ description: 'line1\nline2' })) });
      const r = await buildDataset();
      for (const l of [...r.train, ...r.val]) {
        expect(l.includes('\n')).toBe(false);
        expect(() => JSON.parse(l)).not.toThrow();
      }
    });

    it('a model output wrapped in fences or prose is normalised to the clean JSON', async () => {
      await seed({ output: 'Here you go:\n```json\n' + JSON.stringify(specWith()) + '\n```\nEnjoy!' });
      const [line] = lines(await buildDataset());
      expect(JSON.parse(line.messages[2].content).title).toBe('Gym API');
      expect(line.messages[2].content.startsWith('{')).toBe(true);
    });

    it('the user\'s corrected output wins over the model output', async () => {
      const corrected = specWith({ title: 'Corrected title' }, '/fixed');
      await seed({ verdict: 'bad', corrected });
      await seed({ verdict: 'good', corrected });
      const all = lines(await buildDataset());
      // both rows carry the same target, so after dedupe-by-content this depends on the prompts: they differ
      expect(all).toHaveLength(2);
      for (const l of all) expect(JSON.parse(l.messages[2].content).title).toBe('Corrected title');
    });

    it('a "bad" verdict without a correction is excluded; with a correction it is included', async () => {
      await seed({ verdict: 'bad' });
      expect((await buildDataset()).counts.included).toBe(0);
      await seed({ verdict: 'bad', corrected: specWith({}, '/fixed') });
      const r = await buildDataset();
      expect(r.counts.included).toBe(1);
      expect(JSON.parse(lines(r)[0].messages[2].content).endpoints[0].path).toBe('/fixed');
    });

    it('a generation with no feedback is excluded', async () => {
      await seed({ verdict: null });
      const r = await buildDataset();
      expect(r.counts.included).toBe(0);
      expect(r.train).toEqual([]);
      expect(r.val).toEqual([]);
    });

    it('a "good" one whose output does not parse is excluded (parsedOk false, or text that is not JSON)', async () => {
      await seed({ parsedOk: false });
      await seed({ output: 'sorry I cannot do that' });
      await seed({ output: '[1,2,3]' });
      expect((await buildDataset()).counts.included).toBe(0);
    });

    it('a correction that no longer passes the validator is excluded', async () => {
      await seed({ verdict: 'bad', corrected: { title: 'broken' } });
      expect((await buildDataset()).counts.included).toBe(0);
    });

    it('expired generations (TTL not yet reaped) are excluded', async () => {
      await seed({ expiresAt: new Date(Date.now() - 1000) });
      expect((await buildDataset()).counts.included).toBe(0);
    });

    it('feedback whose generation was never stored (verdict-only rows) contributes nothing', async () => {
      const { user } = await seed({ verdict: null });
      await AiFeedbackModel.create({ userId: user._id, generationId: crypto.randomUUID(), verdict: 'good', expiresAt: new Date(Date.now() + 1e9) });
      expect((await buildDataset()).counts.included).toBe(0);
    });

    it('feedback of user A on a generation id that belongs to user B never joins them', async () => {
      const a = await seed({ verdict: null });
      const b = await seed({ verdict: null });
      await AiFeedbackModel.create({ userId: b.user._id, generationId: a.generationId, verdict: 'good', expiresAt: new Date(Date.now() + 1e9) });
      expect((await buildDataset()).counts.included).toBe(0);
    });
  });

  describe('consent is checked at export time', () => {
    it('users without consent (absent field, or granted false) are excluded', async () => {
      await seed({ consent: null });
      await seed({ consent: { granted: false, at: new Date() } });
      await seed({ consent: { granted: true, at: new Date() } });
      const r = await buildDataset();
      expect(r.counts.included).toBe(1);
      expect(r.counts.excluded.noConsent).toBe(2);
    });

    it('a user who withdrew AFTER giving feedback is excluded even if their rows are still there', async () => {
      const { user } = await seed({});
      expect((await buildDataset()).counts.included).toBe(1);
      // simulate a withdrawal whose cleanup has not run (or a failed one): flag flipped, rows still present
      await UserModel.updateOne({ _id: user._id }, { aiTrainingConsent: { granted: false, at: new Date() } });
      expect(await AiGenerationModel.countDocuments({})).toBe(1);
      const r = await buildDataset();
      expect(r.counts.included).toBe(0);
      expect(r.train.length + r.val.length).toBe(0);
    });

    it('a deleted user (orphan rows) is excluded', async () => {
      const { user } = await seed({});
      await UserModel.deleteOne({ _id: user._id });
      expect((await buildDataset()).counts.included).toBe(0);
    });
  });

  describe('redaction, anonymity and dedupe', () => {
    it('removes secrets and emails from every message and from the target', async () => {
      await seed({
        system: `System with ${SK}`,
        userText: `README: contact owner@secret-company.io, token ${GHP}, password = hunter22`,
        verdict: 'bad',
        corrected: specWith({ description: `mail admin@secret-company.io key ${SK}` }),
      });
      const r = await buildDataset();
      const text = [...r.train, ...r.val].join('\n');
      expect(text).not.toContain(SK);
      expect(text).not.toContain(GHP);
      expect(text).not.toContain('secret-company.io');
      expect(text).not.toContain('hunter22');
      expect(text).toContain('[REDACTED_KEY]');
      expect(text).toContain('[REDACTED_EMAIL]');
      // the target is still valid JSON after redaction
      expect(() => JSON.parse(lines(r)[0].messages[2].content)).not.toThrow();
    });

    /** Stores a generation of a fresh consenting user with an explicit prompt and a 'good' vote. */
    const seedPrompt = async (messages: Array<{ role: 'system' | 'user'; content: string }>, output: string) => {
      const generationId = crypto.randomUUID();
      const { user } = await seed({ verdict: null });
      await AiGenerationModel.create({ generationId, userId: user._id, messages, output, parsedOk: true, provider: 'p', model: 'm', expiresAt: new Date(Date.now() + 1e9) });
      await AiFeedbackModel.create({ userId: user._id, generationId, verdict: 'good', expiresAt: new Date(Date.now() + 1e9) });
    };

    it('removes the repository, owner, URL, branch and project identifiers of the prompt (built by the real prompt builder)', async () => {
      const ids = ['zelda-acme-labs', 'gym-booking-secret-repo', 'github.com/zelda-acme-labs', 'feature/acme-payroll', 'Acme Internal Gym Portal', 'Acme Corp Madrid'];
      const withRepo = buildPromptFromInput({
        projectTitle: 'Acme Internal Gym Portal',
        projectDescription: 'Portal for the Acme Corp Madrid branch members',
        context: {
          repoName: 'gym-booking-secret-repo',
          repoUrl: 'https://github.com/zelda-acme-labs/gym-booking-secret-repo',
          repoOwner: 'zelda-acme-labs',
          branch: 'feature/acme-payroll',
          summary: 'Repository with 1 analyzed files',
          files: [{ path: 'README.md', type: 'other', summary: 'Gym API' }],
        },
        userInput: 'Members CRUD',
      });
      const noRepo = buildPromptFromInput({
        projectTitle: 'Acme Internal Gym Portal',
        projectDescription: 'Portal for the Acme Corp Madrid branch members',
        context: null,
        userInput: 'Members CRUD',
      });
      await seedPrompt(withRepo as never, JSON.stringify(specWith()));
      await seedPrompt(noRepo as never, JSON.stringify(specWith({}, '/other')));
      const r = await buildDataset();
      const text = [...r.train, ...r.val].join('\n');
      expect(r.counts.included).toBe(2);
      for (const id of ids) expect(text).not.toContain(id);
      expect(text).toContain('Members CRUD');
      expect(text).toContain('[REDACTED_REPO]');
    });

    it('the same prompt from two different repositories is one example (identifiers are neutralised before hashing)', async () => {
      const prompt = (repo: string) =>
        buildPromptFromInput({
          projectTitle: repo,
          context: { repoName: repo, repoUrl: 'https://github.com/o-' + repo + '/' + repo, repoOwner: 'o-' + repo, summary: 's', files: [] },
          userInput: 'Members CRUD',
        });
      for (const repo of ['alpha-repo', 'beta-repo']) await seedPrompt(prompt(repo) as never, JSON.stringify(specWith()));
      const r = await buildDataset();
      expect(r.counts.included).toBe(1);
      expect(r.counts.duplicates).toBe(1);
    });

    it('synthetic mock data in the target survives (example.com e-mails, fake passwords and tokens), real-looking keys do not, prompts stay strict', async () => {
      const login = {
        user: { email: 'john.doe@example.com', password: 'Secret123!' },
        token: 'abc123',
        accessToken: 'eyJhbGciOi.fake.token',
      };
      const target = specWith({
        endpoints: [
          {
            path: '/login',
            method: 'POST',
            description: 'Login',
            examples: [
              { request: { email: 'jane@example.org', password: 'hunter2' }, response: login, statusCode: 200 },
              { request: {}, response: { leaked: SK } },
            ],
          },
        ],
      });
      await seed({ userText: 'Auth API, contact boss@real-company.io and use password = Secret123!', output: JSON.stringify(target) });
      const r = await buildDataset();
      const text = [...r.train, ...r.val].join('\n');
      const out = JSON.parse(lines(r)[0].messages[2].content);
      const example = out.endpoints[0].examples[0];
      expect(example.response).toEqual(login);
      expect(example.request).toEqual({ email: 'jane@example.org', password: 'hunter2' });
      expect(text).not.toContain(SK);
      expect(out.endpoints[0].examples[1].response.leaked).toBe('[REDACTED_KEY]');
      const prompt = lines(r)[0].messages[1].content;
      expect(prompt).not.toContain('boss@real-company.io');
      expect(prompt).not.toContain('Secret123!');
    });

    it('does not contain the email, user id or generation id of the author', async () => {
      const email = 'author.person@example.org';
      const { user, generationId } = await seed({ email });
      const r = await buildDataset();
      const text = [...r.train, ...r.val].join('\n');
      expect(r.counts.included).toBe(1);
      expect(text).not.toContain(email);
      expect(text).not.toContain('author.person');
      expect(text).not.toContain(user._id.toString());
      expect(text).not.toContain(generationId);
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    });

    it('two identical generations (same messages, same target) are kept once', async () => {
      const common = { system: 'S', userText: 'Same prompt', output: JSON.stringify(specWith()) };
      await seed(common);
      await seed(common);
      await seed({ ...common, userText: 'Different prompt' });
      const r = await buildDataset();
      expect(r.counts.included).toBe(2);
      expect(r.counts.duplicates).toBe(1);
    });

    it('generations that differ only in a secret are duplicates after redaction', async () => {
      const k1 = 'sk_' + 'live_' + rep('a1B2', 6);
      const k2 = 'sk_' + 'live_' + rep('Z9y8', 6);
      await seed({ userText: `use key ${k1}`, output: JSON.stringify(specWith()) });
      await seed({ userText: `use key ${k2}`, output: JSON.stringify(specWith()) });
      const r = await buildDataset();
      expect(r.counts.included).toBe(1);
      expect(r.counts.duplicates).toBe(1);
    });

    it('the surviving duplicate is chosen deterministically (not by insertion order)', async () => {
      const common = { system: 'S', userText: 'Same prompt', output: JSON.stringify(specWith()) };
      const first = await seed(common);
      const second = await seed(common);
      const winner = [first.generationId, second.generationId].sort()[0];
      // the survivor decides the train/val bucket: ask for the bucket of the lowest id
      const ratio = 0.5;
      const r = await buildDataset({ valRatio: ratio });
      const expectedInVal = splitBucket(winner) < ratio;
      expect(r.val.length).toBe(expectedInVal ? 1 : 0);
      expect(r.train.length).toBe(expectedInVal ? 0 : 1);
    });
  });

  describe('split', () => {
    it('is deterministic: same data, same split, whatever the insertion order', async () => {
      for (let i = 0; i < 60; i++) await seed({});
      const a = await buildDataset({ valRatio: 0.2 });
      const b = await buildDataset({ valRatio: 0.2 });
      expect(a.train).toEqual(b.train);
      expect(a.val).toEqual(b.val);
      // lines are sorted by content hash, so row order from the database does not matter either
      const sortedTrain = [...a.train].sort();
      const key = (l: string) => crypto.createHash('sha256').update(l).digest('hex');
      const keys = a.train.map(key);
      expect(keys).toEqual([...keys].sort());
      expect(sortedTrain.length).toBe(a.train.length);
    });

    it('defaults to roughly 90/10 and every example lands in exactly one file', async () => {
      for (let i = 0; i < 300; i++) await seed({});
      const r = await buildDataset();
      expect(r.train.length + r.val.length).toBe(300);
      expect(r.val.length).toBeGreaterThan(10);
      expect(r.val.length).toBeLessThan(60);
      expect(new Set([...r.train, ...r.val]).size).toBe(300);
      expect(r.counts.train).toBe(r.train.length);
      expect(r.counts.val).toBe(r.val.length);
    });

    it('--val-ratio is honoured, 0 means everything to train', async () => {
      for (let i = 0; i < 100; i++) await seed({});
      const none = await buildDataset({ valRatio: 0 });
      expect(none.val).toHaveLength(0);
      expect(none.train).toHaveLength(100);
      const half = await buildDataset({ valRatio: 0.5 });
      expect(half.val.length).toBeGreaterThan(30);
      expect(half.val.length).toBeLessThan(70);
    });

    it('the bucket depends on the generation id only and stays in [0,1)', () => {
      const id = crypto.randomUUID();
      expect(splitBucket(id)).toBe(splitBucket(id));
      for (let i = 0; i < 50; i++) {
        const b = splitBucket(crypto.randomUUID());
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(1);
      }
    });

    it('rejects a nonsensical ratio', async () => {
      await expect(buildDataset({ valRatio: -0.1 })).rejects.toThrow();
      await expect(buildDataset({ valRatio: 1 })).rejects.toThrow();
      await expect(buildDataset({ valRatio: Number.NaN })).rejects.toThrow();
    });
  });

  describe('the command line', () => {
    let out: string;
    let printed: string[];
    const log = (l: string) => printed.push(l);

    beforeEach(() => {
      out = fs.mkdtempSync(path.join(os.tmpdir(), 'mockia-ds-'));
      fs.rmSync(out, { recursive: true, force: true }); // let the exporter create it
      printed = [];
    });
    afterEach(() => {
      fs.rmSync(out, { recursive: true, force: true });
    });

    it('refuses to run without the confirmation flag or AI_EXPORT_CONFIRM=1: no files, no directory', async () => {
      await seed({});
      const code = await runExportCli(['--out', out], {}, log);
      expect(code).not.toBe(0);
      expect(fs.existsSync(out)).toBe(false);
      expect(printed.join('\n')).toMatch(/confirm/i);
      // any other value of the env is not a confirmation
      for (const v of ['0', '', 'true', 'yes']) {
        expect(await runExportCli(['--out', out], { AI_EXPORT_CONFIRM: v }, log)).not.toBe(0);
      }
      expect(fs.existsSync(out)).toBe(false);
    });

    it('--confirm-consent-checked runs it; AI_EXPORT_CONFIRM=1 runs it too', async () => {
      await seed({});
      expect(await runExportCli(['--out', out, '--confirm-consent-checked'], {}, log)).toBe(0);
      expect(fs.existsSync(path.join(out, 'train.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(out, 'val.jsonl'))).toBe(true);
      fs.rmSync(out, { recursive: true, force: true });
      expect(await runExportCli([`--out=${out}`], { AI_EXPORT_CONFIRM: '1' }, log)).toBe(0);
      expect(fs.existsSync(path.join(out, 'train.jsonl'))).toBe(true);
    });

    it('writes train.jsonl and val.jsonl whose lines are the dataset, both always present', async () => {
      for (let i = 0; i < 40; i++) await seed({});
      await runExportCli(['--out', out, '--confirm-consent-checked', '--val-ratio', '0.25'], {}, log);
      const train = fs.readFileSync(path.join(out, 'train.jsonl'), 'utf8');
      const val = fs.readFileSync(path.join(out, 'val.jsonl'), 'utf8');
      const trainLines = train.split('\n').filter(Boolean);
      const valLines = val.split('\n').filter(Boolean);
      expect(trainLines.length + valLines.length).toBe(40);
      expect(valLines.length).toBeGreaterThan(2);
      expect(train.endsWith('\n') || train === '').toBe(true);
      const expected = await buildDataset({ valRatio: 0.25 });
      expect(trainLines).toEqual(expected.train);
      expect(valLines).toEqual(expected.val);
    });

    it('with nothing to export it still writes two empty files and says so', async () => {
      expect(await runExportCli(['--out', out, '--confirm-consent-checked'], {}, log)).toBe(0);
      expect(fs.readFileSync(path.join(out, 'train.jsonl'), 'utf8')).toBe('');
      expect(fs.readFileSync(path.join(out, 'val.jsonl'), 'utf8')).toBe('');
    });

    it('prints counts only: never a prompt, an output, an id or an email', async () => {
      const { user, generationId } = await seed({ email: 'printer.person@example.org', userText: 'UNIQUE-PROMPT-TEXT-123' });
      await runExportCli(['--out', out, '--confirm-consent-checked'], {}, log);
      const text = printed.join('\n');
      expect(text).toMatch(/\d/);
      expect(text).not.toContain('UNIQUE-PROMPT-TEXT-123');
      expect(text).not.toContain('Gym API');
      expect(text).not.toContain(generationId);
      expect(text).not.toContain(user._id.toString());
      expect(text).not.toContain('printer.person');
    });

    (process.platform === 'win32' ? it.skip : it)('creates the files with mode 0600 (owner only) and the directory 0700', async () => {
      // POSIX permission bits do not exist on Windows (NTFS ACLs): the assertion is skipped there, the code still sets the mode
      await seed({});
      await runExportCli(['--out', out, '--confirm-consent-checked'], {}, log);
      for (const f of ['train.jsonl', 'val.jsonl']) {
        expect(fs.statSync(path.join(out, f)).mode & 0o777).toBe(0o600);
      }
      expect(fs.statSync(out).mode & 0o777).toBe(0o700);
    });

    (process.platform === 'win32' ? it.skip : it)('re-tightens the mode of files that already existed with looser permissions', async () => {
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'train.jsonl'), 'old', { mode: 0o644 });
      fs.chmodSync(path.join(out, 'train.jsonl'), 0o644);
      await seed({});
      await runExportCli(['--out', out, '--confirm-consent-checked'], {}, log);
      expect(fs.statSync(path.join(out, 'train.jsonl')).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(path.join(out, 'train.jsonl'), 'utf8')).not.toBe('old');
    });

    it('rejects a bad --val-ratio and unknown flags with a non-zero code and writes nothing', async () => {
      await seed({});
      for (const args of [['--val-ratio', '2'], ['--val-ratio', 'abc'], ['--val-ratio', '1'], ['--nope']]) {
        const code = await runExportCli(['--out', out, '--confirm-consent-checked', ...args], {}, log);
        expect(code).not.toBe(0);
      }
      expect(fs.existsSync(out)).toBe(false);
    });

    it('the default output directory is gitignored (dataset files must never be committed)', () => {
      const root = path.resolve(__dirname, '../../../..');
      const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
      expect(gitignore).toMatch(/^ai-datasets\/?$/m);
      expect(gitignore).toMatch(/\*\.jsonl/);
    });
  });
});
