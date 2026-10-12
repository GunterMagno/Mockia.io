import { Types } from 'mongoose';
import {
  AI_CREDENTIAL_MAX_PER_USER,
  AI_PROVIDER_PRESETS,
  ErrorCode,
  type AiCredentialMeta,
  type AiCredentialPreset,
  type AiCredentialsConfig,
} from '@mockia/shared';
import { AppError } from '../../middlewares/errorHandler.js';
import { describeError } from '../../utils/safeErrorLog.js';
import { AiCredentialModel, type AiCredentialDocument } from '../../models/AiCredential.js';
import { seal } from './crypto.js';
import { verifyPathFor } from './presets.js';
import { SafeHttpError, createSafeFetch, normalizeHost, type SafeHttpReason } from './safeHttp.js';

/**
 * Management of the AI keys users bring (decisions D7-D10). The API key travels through this module only as a local
 * variable: it is checked against the provider, sealed, and dropped. It is never logged, returned, or put in an error.
 */

/** Whether the feature is on (BYOK_ENABLED). Read per request, like the other feature switches. */
export function isByokEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(true|1|yes|on)$/i.test(env.BYOK_ENABLED?.trim() ?? '');
}

/** Whether users may point a credential at their own URL (BYOK_ALLOW_CUSTOM_URLS=true; off by default: less SSRF surface). */
export function allowCustomUrls(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BYOK_ALLOW_CUSTOM_URLS?.trim().toLowerCase() === 'true';
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): AiCredentialsConfig {
  return {
    enabled: isByokEnabled(env),
    allowCustom: allowCustomUrls(env),
    presets: AI_PROVIDER_PRESETS,
  };
}

/* ------------------------------------------------------------------------------------------------------------------
 * Outbound calls
 * ---------------------------------------------------------------------------------------------------------------- */

/** A key check is one small GET; a model list can be a few hundred KB. Generous on size, strict on time. */
const VERIFY_TIMEOUT_MS = 10_000;
const VERIFY_MAX_BYTES = 8 * 1024 * 1024;

let fetchOverride: typeof fetch | undefined;

/**
 * TESTS ONLY: replaces the hardened fetch used to talk to providers (the suites point it at a local TLS server through
 * K2's `testDialOverride`). Refuses to work outside NODE_ENV=test so production code can never swap the transport.
 */
export function setProviderFetchForTests(replacement: typeof fetch | undefined): void {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('setProviderFetchForTests is for tests only');
  fetchOverride = replacement;
}

/** The only way this feature reaches a provider: the SSRF-hardened client of K2 (or, in tests, the injected one). */
export function providerFetch(): typeof fetch {
  return (
    fetchOverride ?? createSafeFetch({ timeoutMs: VERIFY_TIMEOUT_MS, maxBytes: VERIFY_MAX_BYTES })
  );
}

/** Longest a generation may wait for the user's provider (a slow model can take a minute or two); the request's overall deadline still applies. */
export const GENERATION_TIMEOUT_MS = 120_000;

/** The SSRF-hardened client used to generate with a user's key (or, in tests, the injected one). */
export function generationFetch(): typeof fetch {
  return fetchOverride ?? createSafeFetch({ timeoutMs: GENERATION_TIMEOUT_MS });
}

/** Refusals of the URL policy (as opposed to the network failing or the provider answering badly). */
const POLICY_REASONS: ReadonlySet<SafeHttpReason> = new Set([
  'invalid_url',
  'forbidden_scheme',
  'forbidden_userinfo',
  'forbidden_port',
  'forbidden_host',
  'forbidden_address',
  'redirect_not_followed',
]);

type Verdict = 'ok' | 'rejected' | 'unreachable' | 'policy';

/**
 * Asks the provider whether it accepts the key. 401/403 = rejected; any 2xx = ok; the URL policy refusing the host (or the
 * provider redirecting) = policy; everything else (network, timeout, 404, 429, 5xx, an oversized answer) = unreachable.
 * The error is dropped on purpose: whatever it says, it must not reach a log next to a key.
 */
async function verifyKey(
  preset: AiCredentialPreset,
  baseUrl: string,
  apiKey: string
): Promise<Verdict> {
  try {
    const response = await providerFetch()(`${baseUrl}${verifyPathFor(preset)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (response.status === 401 || response.status === 403) return 'rejected';
    return response.ok ? 'ok' : 'unreachable';
  } catch (err) {
    return err instanceof SafeHttpError && POLICY_REASONS.has(err.reason)
      ? 'policy'
      : 'unreachable';
  }
}

/* ------------------------------------------------------------------------------------------------------------------
 * URL and shape helpers
 * ---------------------------------------------------------------------------------------------------------------- */

export const urlInvalid = (message: string) =>
  new AppError(message, ErrorCode.AI_PROVIDER_URL_INVALID, 400);
/** The one answer for a credential that is not yours, does not exist or is not even an id: they must look identical. */
export const credentialNotFound = () =>
  new AppError('AI credential not found', ErrorCode.AI_CREDENTIAL_NOT_FOUND, 404);
const notFound = credentialNotFound;

/**
 * The base URL a credential will use. With a preset the client's value is IGNORED. `custom` needs
 * BYOK_ALLOW_CUSTOM_URLS=true and an https URL on a public host name (K2's normalizeHost: no IP literal in any notation, no
 * userinfo, no port but 443, no localhost); no query, fragment or odd path characters. Names that look public but resolve
 * to a private address are caught when the socket connects (K2), at verification and on every later use.
 */
export function resolveBaseUrl(
  preset: AiCredentialPreset,
  baseUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (preset !== 'custom') return AI_PROVIDER_PRESETS[preset].baseUrl;

  if (!allowCustomUrls(env))
    throw urlInvalid('Custom provider URLs are not enabled on this server');
  const raw = baseUrl?.trim() ?? '';
  if (raw === '') throw urlInvalid('A provider URL is required for a custom provider');
  if (raw.includes('?') || raw.includes('#'))
    throw urlInvalid('The provider URL must not have a query or fragment');
  // The URL parser would quietly rewrite these (%2e%2e becomes .., a backslash becomes a slash): refuse them as typed
  if (/[%\\\s]/.test(raw)) throw urlInvalid('The provider URL has characters that are not allowed');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw urlInvalid('The provider URL is not valid');
  }
  if (url.protocol !== 'https:') throw urlInvalid('The provider URL must use https');
  if (url.username !== '' || url.password !== '')
    throw urlInvalid('The provider URL must not contain credentials');
  if (url.port !== '') throw urlInvalid('The provider URL must use the default https port');
  let host: string;
  try {
    host = normalizeHost(url.hostname);
  } catch {
    throw urlInvalid('The provider URL must point to a public host name');
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  if (!/^(\/[A-Za-z0-9._~-]+)*$/.test(pathname))
    throw urlInvalid('The provider URL path is not valid');
  const result = `https://${host}${pathname}`;
  if (result.length > 300) throw urlInvalid('The provider URL is too long');
  return result;
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** Anything that is not a 24-hex string cannot belong to anyone: the same 404 as a missing credential. */
export function credentialObjectId(id: string): Types.ObjectId {
  if (typeof id !== 'string' || !OBJECT_ID.test(id)) throw notFound();
  return new Types.ObjectId(id);
}

/** The additional authenticated data that binds a sealed key to its user, credential and host. */
export const credentialAad = (userId: string, credId: string, baseUrl: string): string =>
  `${userId}|${credId}|${baseUrl}`;

type CredentialLean = Pick<
  AiCredentialDocument,
  '_id' | 'label' | 'preset' | 'model' | 'last4' | 'createdAt' | 'lastUsedAt' | 'lastError'
>;

/** The only shape of a credential that leaves the server: no key, no `sealed`, no `userId`, no `baseUrl`. */
export function toMeta(doc: CredentialLean): AiCredentialMeta {
  return {
    id: doc._id.toString(),
    label: doc.label,
    preset: doc.preset,
    model: doc.model,
    last4: doc.last4,
    createdAt: new Date(doc.createdAt).toISOString(),
    ...(doc.lastUsedAt && { lastUsedAt: new Date(doc.lastUsedAt).toISOString() }),
    ...(doc.lastError && { lastError: doc.lastError }),
  };
}

const isDuplicateKey = (err: unknown): boolean =>
  (err as { code?: unknown } | null)?.code === 11000;
const labelTaken = () =>
  new AppError(
    'You already have a credential with that label',
    ErrorCode.AI_CREDENTIAL_LABEL_TAKEN,
    409
  );
const limitReached = () =>
  new AppError(
    `You can keep at most ${AI_CREDENTIAL_MAX_PER_USER} AI credentials`,
    ErrorCode.AI_CREDENTIAL_LIMIT_REACHED,
    409
  );
const rejected = () =>
  new AppError('The AI provider rejected the key', ErrorCode.AI_PROVIDER_REJECTED, 400);

/* ------------------------------------------------------------------------------------------------------------------
 * Operations (every one is scoped to the authenticated user)
 * ---------------------------------------------------------------------------------------------------------------- */

export async function listCredentials(userId: string): Promise<AiCredentialMeta[]> {
  const docs = await AiCredentialModel.find({ userId }).sort({ createdAt: 1, _id: 1 }).lean();
  return docs.map(toMeta);
}

export interface CreateCredentialInput {
  label: string;
  preset: AiCredentialPreset;
  baseUrl?: string;
  model: string;
  apiKey: string;
}

/** A credential that was created, with what the notices need (the provider's display name). */
export interface CreatedCredential {
  meta: AiCredentialMeta;
  providerName: string;
}

/** Display name of the provider of a stored credential: the preset's label, or the host of a custom URL. */
export function providerName(preset: AiCredentialPreset, baseUrl: string): string {
  if (preset !== 'custom') return AI_PROVIDER_PRESETS[preset].label;
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return 'custom';
  }
}

export async function createCredential(
  userId: string,
  input: CreateCredentialInput
): Promise<CreatedCredential> {
  const existing = await AiCredentialModel.find({ userId }).select('label').lean();
  if (existing.length >= AI_CREDENTIAL_MAX_PER_USER) throw limitReached();
  if (existing.some((c) => c.label === input.label)) throw labelTaken();

  const baseUrl = resolveBaseUrl(input.preset, input.baseUrl);

  // Checked BEFORE anything is saved: a key the provider refuses leaves no trace
  const verdict = await verifyKey(input.preset, baseUrl, input.apiKey);
  if (verdict === 'rejected') throw rejected();
  if (verdict === 'policy' && input.preset === 'custom') {
    throw urlInvalid('The provider URL is not allowed');
  }

  // The id exists before sealing because it is part of the AAD
  const _id = new Types.ObjectId();
  const sealed = seal(input.apiKey, credentialAad(userId, _id.toString(), baseUrl));

  let doc;
  try {
    doc = await AiCredentialModel.create({
      _id,
      userId,
      label: input.label,
      preset: input.preset,
      baseUrl,
      model: input.model,
      sealed,
      last4: input.apiKey.slice(-4),
      ...(verdict !== 'ok' && { lastError: 'unreachable' as const }),
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw labelTaken();
    throw err;
  }

  // Parallel requests can all pass the count above: whoever ends up beyond the limit takes its own record back
  if ((await AiCredentialModel.countDocuments({ userId })) > AI_CREDENTIAL_MAX_PER_USER) {
    await AiCredentialModel.deleteOne({ _id });
    throw limitReached();
  }

  return { meta: toMeta(doc.toObject()), providerName: providerName(input.preset, baseUrl) };
}

export interface UpdateCredentialInput {
  label?: string;
  model?: string;
  apiKey?: string;
}

export async function updateCredential(
  userId: string,
  id: string,
  patch: UpdateCredentialInput
): Promise<AiCredentialMeta> {
  const _id = credentialObjectId(id);
  const current = await AiCredentialModel.findOne({ _id, userId }).lean();
  if (!current) throw notFound();

  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ''> = {};
  if (patch.label !== undefined && patch.label !== current.label) {
    const clash = await AiCredentialModel.exists({ userId, label: patch.label, _id: { $ne: _id } });
    if (clash) throw labelTaken();
    $set.label = patch.label;
  }
  if (patch.model !== undefined) $set.model = patch.model;

  if (patch.apiKey !== undefined) {
    const verdict = await verifyKey(current.preset, current.baseUrl, patch.apiKey);
    if (verdict === 'rejected') throw rejected();
    if (verdict === 'policy' && current.preset === 'custom') {
      throw urlInvalid('The provider URL is not allowed');
    }
    // A fresh IV every time (seal draws one), under the same AAD: same user, same credential, same host
    $set.sealed = seal(patch.apiKey, credentialAad(userId, id, current.baseUrl));
    $set.last4 = patch.apiKey.slice(-4);
    if (verdict === 'ok') $unset.lastError = '';
    else $set.lastError = 'unreachable';
  }

  let updated;
  try {
    updated = await AiCredentialModel.findOneAndUpdate(
      { _id, userId },
      {
        ...(Object.keys($set).length > 0 && { $set }),
        ...(Object.keys($unset).length > 0 && { $unset }),
      },
      { new: true }
    ).lean();
  } catch (err) {
    if (isDuplicateKey(err)) throw labelTaken();
    throw err;
  }
  if (!updated) throw notFound();
  return toMeta(updated);
}

export interface RemovedCredential {
  label: string;
  providerName: string;
}

export async function deleteCredential(userId: string, id: string): Promise<RemovedCredential> {
  const _id = credentialObjectId(id);
  const removed = await AiCredentialModel.findOneAndDelete({ _id, userId }).lean();
  if (!removed) throw notFound();
  return { label: removed.label, providerName: providerName(removed.preset, removed.baseUrl) };
}

/* ------------------------------------------------------------------------------------------------------------------
 * What a generation leaves on the credential (never the key, never provider text)
 * ---------------------------------------------------------------------------------------------------------------- */

/** A generation with this credential worked: remember when, and forget an earlier failure. Never throws. */
export async function markCredentialUsed(userId: string, credId: Types.ObjectId): Promise<void> {
  try {
    await AiCredentialModel.updateOne(
      { _id: credId, userId },
      { $set: { lastUsedAt: new Date() }, $unset: { lastError: '' } }
    );
  } catch (err) {
    console.error(`[BYOK] could not record the use of a credential (${describeError(err)})`);
  }
}

/** The provider refused this credential's key (401/403): the owner sees it in their list. Never throws. */
export async function markCredentialRejected(
  userId: string,
  credId: Types.ObjectId
): Promise<void> {
  try {
    await AiCredentialModel.updateOne({ _id: credId, userId }, { $set: { lastError: 'rejected' } });
  } catch (err) {
    console.error(`[BYOK] could not mark a credential as rejected (${describeError(err)})`);
  }
}
