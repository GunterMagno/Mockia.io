import { ProjectModel } from '../../models/Project.js';
import { hashApiKey } from '../mock/mockAuth.js';

/**
 * One-off, idempotent migration of the plain-text `apiKey` field that projects used to carry.
 *
 * Every project with a legacy `apiKey` was already private (the mock required that key), so it becomes
 * visibility 'key' with the SHA-256 of the same key: clients that already send it keep working, and nothing
 * readable is left in the database. Projects without a legacy key are untouched (they stay 'public').
 * The first characters of the old key are kept as the display prefix.
 *
 * It runs at every boot (cheap: one indexed-less scan only when legacy keys exist) and needs no manual step.
 * It works on the raw collection because `apiKey` is no longer part of the Mongoose schema.
 *
 * @returns how many projects were migrated
 */
export async function migrateLegacyApiKeys(): Promise<number> {
  const collection = ProjectModel.collection;
  const legacy = await collection.find({ apiKey: { $exists: true } }, { projection: { apiKey: 1 } }).toArray();
  let migrated = 0;
  for (const doc of legacy) {
    const key = doc.apiKey;
    if (typeof key === 'string' && key.length > 0) {
      const result = await collection.updateOne(
        { _id: doc._id, apiKey: key },
        {
          $set: { apiKeyHash: hashApiKey(key), apiKeyPrefix: key.slice(0, 8), apiKeyCreatedAt: new Date(), visibility: 'key' },
          $unset: { apiKey: '' },
        }
      );
      migrated += result.modifiedCount;
    } else {
      // Empty / null / non-text value: there was no usable key, so the mock was open. Drop the field.
      await collection.updateOne({ _id: doc._id }, { $unset: { apiKey: '' } });
    }
  }
  if (legacy.length > 0) {
    // The unique sparse index on the old field is useless now. Best effort: it may not exist (fresh database).
    await collection.dropIndex('apiKey_1').catch(() => undefined);
  }
  return migrated;
}
