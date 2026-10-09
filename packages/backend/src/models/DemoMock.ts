import { Schema, model } from 'mongoose';

/**
 * An ephemeral mock of the public demo (anonymous visitor, no account). It references no user and no project: it is
 * served only by modules/demo/mockRouter.ts under its unguessable `demoId` and disappears when `expiresAt` passes
 * (TTL index; the router also checks the date itself because MongoDB removes expired documents lazily, up to a
 * minute late). `ipHash` is the daily pseudonym of the creator (see modules/demo/ipHash.ts), never an address.
 *
 * Each endpoint keeps its response body as JSON TEXT (`bodyJson`) instead of a nested document: Mongo would drop
 * empty objects and trip over keys that start with "$" or contain ".", and the router sends the text as it is.
 */
export interface DemoEndpointDocument {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Normalised: starts with "/", no trailing slash (except the root), `:name` for path parameters. */
  path: string;
  statusCode: number;
  bodyJson: string;
  /** Allow-listed response headers only, lower-case names (see mockStore.ts). */
  headers: Record<string, string>;
}

export interface DemoMockDocument {
  /** 128 random bits, hex. */
  demoId: string;
  ipHash: string;
  endpoints: DemoEndpointDocument[];
  requestCount: number;
  createdAt: Date;
  expiresAt: Date;
}

const endpointSchema = new Schema<DemoEndpointDocument>(
  {
    method: { type: String, required: true, enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
    path: { type: String, required: true },
    statusCode: { type: Number, required: true },
    bodyJson: { type: String, required: true },
    headers: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false, minimize: false },
);

const demoMockSchema = new Schema<DemoMockDocument>(
  {
    demoId: { type: String, required: true, match: /^[0-9a-f]{32}$/ },
    ipHash: { type: String, required: true },
    endpoints: { type: [endpointSchema], required: true },
    requestCount: { type: Number, required: true, default: 0, min: 0 },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { minimize: false },
);

demoMockSchema.index({ demoId: 1 }, { unique: true });
demoMockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DemoMockModel = model<DemoMockDocument>('DemoMock', demoMockSchema);
