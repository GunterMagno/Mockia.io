import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AiFeedbackModel } from '../../models/AiFeedback.js';
import { AiGenerationModel } from '../../models/AiGeneration.js';
import { UserModel } from '../../models/User.js';
import { extractJsonFromLLMOutput } from './llmOutputParser.js';
import { validateGeneratedApi } from './llmOutputValidator.js';
import { anonymizePromptIdentifiers } from './anonymize.js';
import { redactSecrets, redactTarget } from './redact.js';

/**
 * Training/evaluation dataset exporter (chat format, one JSON object per line).
 *
 * What goes in: generations of users whose consent is granted AT EXPORT TIME, with feedback that is "good" or that
 * carries a correction. Target (assistant message) = the user's correction if there is one, else the model's output
 * when the user said "good" and it parses and validates; everything else is left out. Every prompt message loses the
 * repository/owner/project identifiers (anonymize.ts) and goes through the strict redactor; the target goes through the
 * milder target redaction (redact.ts: synthetic mock data survives, real-looking secrets do not); exact duplicates (after redaction) are kept once; nothing that identifies the author (e-mail,
 * user id, generation id) is written. The train/val split is a pure function of the generation id.
 *
 * It never prints or logs content: only counts.
 */

export interface DatasetCounts {
  /** Examples written (train + val). */
  included: number;
  train: number;
  val: number;
  /** Examples dropped because an identical one (after redaction) was already kept. */
  duplicates: number;
  /** Feedback rows read that said neither "good" nor carried a correction. */
  notUseful: number;
  excluded: {
    noConsent: number;
    noGeneration: number;
    expired: number;
    unparseable: number;
    invalidCorrection: number;
  };
}

export interface DatasetResult {
  /** JSONL lines (without the trailing newline). */
  train: string[];
  val: string[];
  counts: DatasetCounts;
}

export interface DatasetOptions {
  /** Fraction of examples that go to val.jsonl, [0, 1). Default 0.1. */
  valRatio?: number;
  /** Clock, for tests. */
  now?: Date;
}

export const DEFAULT_VAL_RATIO = 0.1;
const BATCH = 500;

/** Deterministic position of a generation in [0, 1): the first 32 bits of sha256(generationId). */
export function splitBucket(generationId: string): number {
  const head = crypto.createHash('sha256').update(generationId).digest().readUInt32BE(0);
  return head / 0x1_0000_0000;
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The target as a clean object, or the reason it cannot be used. */
function pickTarget(
  feedback: { correctedOutput?: unknown },
  generation: { output: string; parsedOk: boolean }
): { ok: true; target: Record<string, unknown> } | { ok: false; reason: 'unparseable' | 'invalidCorrection' } {
  if (feedback.correctedOutput !== undefined && feedback.correctedOutput !== null) {
    try {
      validateGeneratedApi(clone(feedback.correctedOutput)); // it heals in place: validate a copy
      if (!isPlainObject(feedback.correctedOutput)) throw new Error('not an object');
      return { ok: true, target: clone(feedback.correctedOutput) };
    } catch {
      return { ok: false, reason: 'invalidCorrection' };
    }
  }
  if (!generation.parsedOk) return { ok: false, reason: 'unparseable' };
  try {
    const parsed = extractJsonFromLLMOutput(generation.output, { silent: true });
    if (!isPlainObject(parsed)) throw new Error('not an object');
    validateGeneratedApi(clone(parsed));
    return { ok: true, target: parsed };
  } catch {
    return { ok: false, reason: 'unparseable' };
  }
}

/**
 * Reads the database (it must be connected) and builds the dataset in memory. Idempotent and read-only.
 * @throws Error when valRatio is not a finite number in [0, 1)
 */
export async function buildDataset(options: DatasetOptions = {}): Promise<DatasetResult> {
  const valRatio = options.valRatio ?? DEFAULT_VAL_RATIO;
  if (!Number.isFinite(valRatio) || valRatio < 0 || valRatio >= 1) {
    throw new Error('valRatio must be a number in [0, 1)');
  }
  const now = options.now ?? new Date();

  const counts: DatasetCounts = {
    included: 0,
    train: 0,
    val: 0,
    duplicates: 0,
    notUseful: 0,
    excluded: { noConsent: 0, noGeneration: 0, expired: 0, unparseable: 0, invalidCorrection: 0 },
  };

  counts.notUseful = await AiFeedbackModel.countDocuments({
    verdict: { $ne: 'good' },
    $or: [{ correctedOutput: { $exists: false } }, { correctedOutput: null }],
  });

  const useful = AiFeedbackModel.find({
    $or: [{ verdict: 'good' }, { correctedOutput: { $exists: true, $ne: null } }],
  })
    .sort({ _id: 1 })
    .lean()
    .cursor({ batchSize: BATCH });

  // content hash -> the example and the generation id that decides its split (the smallest id wins a tie)
  const kept = new Map<string, { line: string; generationId: string }>();

  const processBatch = async (batch: Array<Awaited<ReturnType<typeof useful.next>> & object>) => {
    const generations = await AiGenerationModel.find({ generationId: { $in: batch.map((f) => f.generationId) } }).lean();
    const byId = new Map(generations.map((g) => [g.generationId, g]));
    const users = await UserModel.find({ _id: { $in: batch.map((f) => f.userId) } })
      .select('aiTrainingConsent')
      .lean();
    const consentOf = new Map(users.map((u) => [u._id.toString(), u.aiTrainingConsent?.granted === true]));

    for (const fb of batch) {
      // Consent first and as it stands NOW: a withdrawal after the feedback removes the example
      if (!consentOf.get(fb.userId.toString())) {
        counts.excluded.noConsent++;
        continue;
      }
      const gen = byId.get(fb.generationId);
      if (!gen || gen.userId.toString() !== fb.userId.toString()) {
        counts.excluded.noGeneration++;
        continue;
      }
      if (gen.expiresAt.getTime() <= now.getTime()) {
        counts.excluded.expired++;
        continue;
      }
      const picked = pickTarget(fb, gen);
      if (!picked.ok) {
        counts.excluded[picked.reason]++;
        continue;
      }

      const messages = [
        ...gen.messages.map((m) => ({ role: m.role, content: redactSecrets(anonymizePromptIdentifiers(m.content)) })),
        { role: 'assistant' as const, content: JSON.stringify(redactTarget(picked.target)) },
      ];
      const line = JSON.stringify({ messages });
      const key = sha256(line);
      const existing = kept.get(key);
      if (existing) {
        counts.duplicates++;
        if (gen.generationId < existing.generationId) existing.generationId = gen.generationId;
      } else {
        kept.set(key, { line, generationId: gen.generationId });
      }
    }
  };

  let batch: Array<Awaited<ReturnType<typeof useful.next>> & object> = [];
  for await (const fb of useful) {
    batch.push(fb);
    if (batch.length >= BATCH) {
      await processBatch(batch);
      batch = [];
    }
  }
  if (batch.length) await processBatch(batch);

  // Ordered by content hash: independent of database order, and it does not group the examples of one author together
  const ordered = [...kept.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const train: string[] = [];
  const val: string[] = [];
  for (const [, { line, generationId }] of ordered) {
    (splitBucket(generationId) < valRatio ? val : train).push(line);
  }
  counts.included = train.length + val.length;
  counts.train = train.length;
  counts.val = val.length;
  return { train, val, counts };
}

/** Writes train.jsonl and val.jsonl into `outDir` (created with mode 0700 if missing); the files are 0600. */
export function writeDataset(result: Pick<DatasetResult, 'train' | 'val'>, outDir: string): { trainPath: string; valPath: string } {
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const write = (name: string, lines: string[]) => {
    const file = path.join(outDir, name);
    fs.rmSync(file, { force: true }); // a fresh file gets the mode below even if an older one was looser
    fs.writeFileSync(file, lines.map((l) => `${l}\n`).join(''), { mode: 0o600 });
    fs.chmodSync(file, 0o600); // the umask can only remove bits, but make it explicit (a no-op on Windows)
    return file;
  };
  return { trainPath: write('train.jsonl', result.train), valPath: write('val.jsonl', result.val) };
}

export const DEFAULT_OUT_DIR = './ai-datasets';

export interface ExportArgs {
  out: string;
  valRatio: number;
  confirm: boolean;
}

function parseArgs(argv: string[]): ExportArgs | { error: string } {
  const args: ExportArgs = { out: DEFAULT_OUT_DIR, valRatio: DEFAULT_VAL_RATIO, confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].startsWith('--') && argv[i].includes('=') ? [argv[i].slice(0, argv[i].indexOf('=')), argv[i].slice(argv[i].indexOf('=') + 1)] : [argv[i], undefined];
    const value = () => (inline !== undefined ? inline : argv[++i]);
    switch (flag) {
      case '--confirm-consent-checked':
        args.confirm = true;
        break;
      case '--out': {
        const v = value();
        if (!v) return { error: '--out needs a directory' };
        args.out = v;
        break;
      }
      case '--val-ratio': {
        const v = value();
        const n = v === undefined || v.trim() === '' ? Number.NaN : Number(v);
        if (!Number.isFinite(n) || n < 0 || n >= 1) return { error: '--val-ratio must be a number in [0, 1)' };
        args.valRatio = n;
        break;
      }
      default:
        return { error: `Unknown argument: ${flag.slice(0, 40)}` };
    }
  }
  return args;
}

const USAGE =
  'Usage: ai:export-dataset --confirm-consent-checked [--out ./ai-datasets] [--val-ratio 0.1]  (or AI_EXPORT_CONFIRM=1)';

/**
 * Arguments and confirmation guard, checked BEFORE the database is touched (the wrapper script calls it first so a
 * refused run never even connects). Exit code 1 = refused (no confirmation), 2 = bad arguments.
 */
export function checkExportInvocation(
  argv: string[],
  env: NodeJS.ProcessEnv
): { ok: true; args: ExportArgs } | { ok: false; code: 1 | 2; message: string } {
  const args = parseArgs(argv);
  if ('error' in args) return { ok: false, code: 2, message: `${args.error}\n${USAGE}` };
  if (!args.confirm && env.AI_EXPORT_CONFIRM !== '1') {
    return {
      ok: false,
      code: 1,
      message:
        'Refusing to export: confirm that consent was checked by passing --confirm-consent-checked (or AI_EXPORT_CONFIRM=1). ' +
        'The export includes only users whose consent is granted now, but it creates files with training data; run it deliberately.',
    };
  }
  return { ok: true, args };
}

/**
 * The command line behind `npm run ai:export-dataset`, with the I/O injected so tests can call it in-process.
 * Needs a connected database. Returns the process exit code: 0 done, 1 refused (no confirmation), 2 bad arguments.
 * Prints counts only.
 */
export async function runExportCli(
  argv: string[],
  env: NodeJS.ProcessEnv,
  log: (line: string) => void = (l) => console.log(l)
): Promise<number> {
  const checked = checkExportInvocation(argv, env);
  if (!checked.ok) {
    log(checked.message);
    return checked.code;
  }
  const { args } = checked;

  const result = await buildDataset({ valRatio: args.valRatio });
  const { trainPath, valPath } = writeDataset(result, path.resolve(args.out));
  const c = result.counts;
  log(`Dataset written: ${c.included} examples (train ${c.train}, val ${c.val}) from ${c.included + c.duplicates} usable feedback rows.`);
  log(`Duplicates dropped: ${c.duplicates}. Not useful (bad without correction): ${c.notUseful}.`);
  log(
    `Excluded: no consent ${c.excluded.noConsent}, generation missing ${c.excluded.noGeneration}, expired ${c.excluded.expired}, ` +
      `unparseable ${c.excluded.unparseable}, invalid correction ${c.excluded.invalidCorrection}.`
  );
  log(`Files (mode 0600): ${trainPath}, ${valPath}`);
  return 0;
}
