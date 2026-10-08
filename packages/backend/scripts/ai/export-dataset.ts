/**
 * Exports the AI training/evaluation dataset (train.jsonl + val.jsonl, chat format) from the generations and feedback of
 * users whose consent is granted AT THIS MOMENT. Redacted, deduplicated, no identifiers in the output.
 *
 *   npm run ai:export-dataset -w @mockia/backend -- --confirm-consent-checked [--out ./ai-datasets] [--val-ratio 0.1]
 *   AI_EXPORT_CONFIRM=1 MONGODB_URI=mongodb://... npm run ai:export-dataset -w @mockia/backend
 *
 * It refuses to run without --confirm-consent-checked (or AI_EXPORT_CONFIRM=1), prints counts only, and writes the files
 * with mode 0600. The default output directory (./ai-datasets) is gitignored. See docs/ia-entrenamiento.md.
 *
 * All the logic lives in src/modules/ai/dataset.ts (tested in-process); this file only connects the database.
 */
import 'dotenv/config'; // first import: connection.ts reads MONGODB_URI when it is evaluated
import { connectDB, disconnectDB } from '../../src/config/connection.js';
import { checkExportInvocation, runExportCli } from '../../src/modules/ai/dataset.js';

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  // Refuse (and fail on bad arguments) BEFORE touching the database
  const checked = checkExportInvocation(argv, process.env);
  if (!checked.ok) {
    console.error(checked.message);
    return checked.code;
  }
  await connectDB();
  try {
    return await runExportCli(argv, process.env);
  } finally {
    await disconnectDB();
  }
}

main()
  .then((code) => process.exit(code))
  .catch(async (err) => {
    // Class and message only; the error of a database driver never carries dataset content
    console.error('[ai:export-dataset] Failed:', err instanceof Error ? err.message : String(err));
    await disconnectDB().catch(() => undefined);
    process.exit(1);
  });
