import { Schema, model } from 'mongoose';

/**
 * Daily counters of the public demo. One document per UTC day, scope ('ip' = one visitor's pseudonym, 'net' = the pseudonym of an IPv6 /48, 'global' = the
 * whole demo) and kind; `count` only grows through a conditional $inc (see modules/demo/budget.ts). `key` is the
 * pseudonym produced by pseudonymizeIp (never an address) or the literal 'global'. Documents expire 48 h after the
 * day they count, through the TTL index on `expiresAt`.
 */
export interface DemoBudgetDocument {
  day: string;
  scope: 'ip' | 'net' | 'global';
  key: string;
  kind: 'generation' | 'mockRequest';
  count: number;
  expiresAt: Date;
}

const demoBudgetSchema = new Schema<DemoBudgetDocument>({
  day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  scope: { type: String, required: true, enum: ['ip', 'net', 'global'] },
  key: { type: String, required: true },
  kind: { type: String, required: true, enum: ['generation', 'mockRequest'] },
  count: { type: Number, required: true, default: 0, min: 0 },
  expiresAt: { type: Date, required: true },
});

demoBudgetSchema.index({ day: 1, scope: 1, key: 1, kind: 1 }, { unique: true });
demoBudgetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DemoBudgetModel = model<DemoBudgetDocument>('DemoBudget', demoBudgetSchema);
