import type { Types } from 'mongoose';
import { AI_CREDENTIAL_MODEL_PATTERN, ErrorCode } from '@mockia/shared';
import { getAiTotalTimeoutMs } from '../../config/ai.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { AiCredentialModel, type AiCredentialDocument } from '../../models/AiCredential.js';
import { describeError } from '../../utils/safeErrorLog.js';
import { redactProviderError } from '../ai/redact.js';
import { createFallbackLlm } from '../ai/providers/index.js';
import {
  STRUCTURED_TEMPERATURE,
  createOpenAiCompatibleProvider,
} from '../ai/providers/openaiCompatible.js';
import { providerOutcomeOf, withProviderOutcome } from '../ai/providers/outcome.js';
import { LlmResponseError, type LlmProvider, type LlmRequest } from '../ai/providers/types.js';
import { ByokCryptoError, open } from './crypto.js';
import {
  GENERATION_TIMEOUT_MS,
  allowCustomUrls,
  credentialAad,
  credentialNotFound,
  credentialObjectId,
  generationFetch,
  isByokEnabled,
  urlInvalid,
} from './service.js';
import { SafeHttpError, type SafeHttpReason } from './safeHttp.js';

/**
 * Generating with the AI key a user brought (decisions D7-D10).
 *
 * The key exists in the clear only here, as a local variable of `prepareCredentialUse` and the closure of the provider it
 * builds: it is never put in an object that is logged or serialised, never in a message, and everything that comes back
 * from the provider is turned into one of OUR fixed messages (a provider's error body is never read, let alone returned).
 */

/** What the user-facing failures say. Fixed texts: nothing the provider wrote can end up in them. */
const MESSAGES = {
  rejected: 'Your AI provider rejected the API key. Check or replace it in your AI settings.',
  noCredit: 'Your AI provider says the account has no credit left. Add credit with your provider.',
  rateLimited: 'Your AI provider is limiting your key right now. Wait a moment and try again.',
  failed:
    'Your AI provider could not complete the request. Check the model name in your AI settings and try again.',
  timeout: 'Your AI provider took too long to answer. Please try again.',
  unreadable: 'The stored API key cannot be read any more. Enter it again in your AI settings.',
  unavailable: 'Your own AI keys are not available on this server right now.',
} as const;

/** Reasons where the URL policy (not the network) stopped the call: a custom host that now resolves somewhere forbidden. */
const POLICY_REASONS: ReadonlySet<SafeHttpReason> = new Set([
  'invalid_url',
  'forbidden_scheme',
  'forbidden_userinfo',
  'forbidden_port',
  'forbidden_host',
  'forbidden_address',
  'redirect_not_followed',
]);

const TIMEOUT_NAMES = new Set(['TimeoutError', 'AbortError']);

/** HTTP status of a provider answer as the OpenAI-compatible client names it (`http_401`), if that is what this is. */
function providerStatus(err: unknown): number | undefined {
  const match = /^http_(\d{3})$/.exec((err as { name?: unknown } | null)?.name as string);
  return match ? Number(match[1]) : undefined;
}

/** What the failed call of the user's provider amounts to for the user: one of our messages, never the provider's. */
function toUserFacingError(err: unknown, apiKey: string): Error {
  // The model answered (cut, empty, not JSON): the chain turns it into its usual 502
  if (err instanceof LlmResponseError || err instanceof AppError) return err;

  const outcome = providerOutcomeOf(err);
  const mark = (error: AppError) => withProviderOutcome(error, outcome);
  const status = providerStatus(err);

  if (status === 401 || status === 403) {
    return mark(new AppError(MESSAGES.rejected, ErrorCode.AI_PROVIDER_REJECTED, 400));
  }
  if (status === 402) {
    return mark(new AppError(MESSAGES.noCredit, ErrorCode.AI_PROVIDER_NO_CREDIT, 402));
  }
  if (status === 429) {
    return mark(new AppError(MESSAGES.rateLimited, ErrorCode.AI_PROVIDER_RATE_LIMITED, 429));
  }
  if (status !== undefined) {
    return mark(new AppError(MESSAGES.failed, ErrorCode.EXTERNAL_SERVICE_ERROR, 502));
  }
  if (err instanceof SafeHttpError) {
    if (err.reason === 'timeout') {
      return mark(new AppError(MESSAGES.timeout, ErrorCode.EXTERNAL_SERVICE_ERROR, 504));
    }
    if (POLICY_REASONS.has(err.reason)) {
      return mark(urlInvalid('The URL of your AI provider is not allowed'));
    }
    return mark(new AppError(MESSAGES.failed, ErrorCode.EXTERNAL_SERVICE_ERROR, 502));
  }
  if (err instanceof Error && TIMEOUT_NAMES.has(err.name)) {
    return mark(new AppError(MESSAGES.timeout, ErrorCode.EXTERNAL_SERVICE_ERROR, 504));
  }

  // Something we did not foresee. Say what it was without trusting its text: the message goes through the redaction
  // (key, Authorization, Bearer, sk-...) and is cut short; the user gets the fixed message
  const text = err instanceof Error ? err.message : '';
  console.error(
    `[AI] Your-own-AI call failed (${describeError(err)})` +
      (text ? `: ${redactProviderError(text, apiKey).slice(0, 300)}` : '')
  );
  return mark(new AppError(MESSAGES.failed, ErrorCode.EXTERNAL_SERVICE_ERROR, 502));
}

/** The model name to report: the one the provider says answered, unless it is odd or quotes the key (then the configured one). */
function reportedModel(reported: string, configured: string, apiKey: string): string {
  const clean = redactProviderError(reported, apiKey);
  return clean === reported && AI_CREDENTIAL_MODEL_PATTERN.test(reported) ? reported : configured;
}

/** The same request, asking for `json_object` instead of a strict schema (providers that do not support `json_schema`). */
function withJsonObject(req: LlmRequest): LlmRequest {
  const { jsonSchema: _schema, ...rest } = req;
  return { ...rest, json: true, temperature: req.temperature ?? STRUCTURED_TEMPERATURE };
}

type ProviderTarget = Pick<AiCredentialDocument, 'preset' | 'baseUrl' | 'model'>;

/** One call to the user's provider: OpenAI-compatible, through the hardened client, with every failure translated. */
function createSingleCallProvider(cred: ProviderTarget, apiKey: string): LlmProvider {
  const inner = createOpenAiCompatibleProvider({
    // The preset, never the URL of a custom host: the name ends up in logs and metrics
    name: cred.preset,
    baseUrl: cred.baseUrl,
    model: cred.model,
    timeoutMs: GENERATION_TIMEOUT_MS,
    apiKey,
    transport: generationFetch(),
  });
  // Once a provider has refused `json_schema` there is no point in asking again in the repair turn
  let schemaRefused = false;
  return {
    name: cred.preset,
    async complete(req) {
      try {
        let completion;
        if (req.jsonSchema && !schemaRefused) {
          try {
            completion = await inner.complete(req);
          } catch (err) {
            // A 400 often means "this model does not take response_format json_schema": ONE more try with json_object
            if (providerStatus(err) !== 400) throw err;
            schemaRefused = true;
            completion = await inner.complete(withJsonObject(req));
          }
        } else {
          completion = await inner.complete(req.jsonSchema ? withJsonObject(req) : req);
        }
        return { ...completion, model: reportedModel(completion.model, cred.model, apiKey) };
      } catch (err) {
        throw toUserFacingError(err, apiKey);
      }
    },
  };
}

/**
 * The language model that is the user's own AI: OpenAI-compatible, through `createSafeFetch` (K2) as the transport. It is
 * wrapped in a chain of ONE: the same answer validation, the same single repair turn and the same overall deadline as the
 * platform's AI, but no circuit breaker (one user's key must never trip anything for others) and nothing after it, so
 * there is no fallback to the platform's AI when it fails.
 */
export function createByokProvider(cred: ProviderTarget, apiKey: string): LlmProvider {
  return createFallbackLlm([{ provider: createSingleCallProvider(cred, apiKey) }], {
    totalTimeoutMs: getAiTotalTimeoutMs(),
  });
}

/** What a generation needs from a credential: the id (to mark use / failure) and the model to call. */
export interface CredentialInUse {
  id: Types.ObjectId;
  llm: LlmProvider;
}

/**
 * Loads the credential `credentialId` of the AUTHENTICATED user, opens its key in memory and builds the provider. Nothing
 * has left the server nor been counted when this throws.
 *  - BYOK_ENABLED off -> 404 BYOK_DISABLED
 *  - not yours / missing / malformed -> the same 404 AI_CREDENTIAL_NOT_FOUND (the lookup is always by `userId`)
 *  - a stored custom URL while custom URLs are off -> 400 AI_PROVIDER_URL_INVALID
 *  - the key cannot be opened (moved or altered record, unknown key id) -> 409 AI_CREDENTIAL_UNREADABLE; a server
 *    without a valid keyring -> 503
 */
export async function prepareCredentialUse(
  userId: string,
  credentialId: string
): Promise<CredentialInUse> {
  if (!isByokEnabled()) {
    throw new AppError('Not found', ErrorCode.BYOK_DISABLED, 404);
  }
  const id = credentialObjectId(credentialId);
  const cred = await AiCredentialModel.findOne({ _id: id, userId }).lean();
  if (!cred) throw credentialNotFound();

  if (cred.preset === 'custom' && !allowCustomUrls()) {
    throw urlInvalid('Custom provider URLs are not enabled on this server');
  }

  let apiKey: string;
  try {
    apiKey = open(cred.sealed, credentialAad(userId, id.toString(), cred.baseUrl));
  } catch (err) {
    const code = err instanceof ByokCryptoError ? err.code : 'unknown';
    console.error(`[BYOK] a stored key could not be opened (${code})`);
    if (code === 'keyring_invalid') {
      throw new AppError(MESSAGES.unavailable, ErrorCode.EXTERNAL_SERVICE_ERROR, 503);
    }
    throw new AppError(MESSAGES.unreadable, ErrorCode.AI_CREDENTIAL_UNREADABLE, 409);
  }

  return { id, llm: createByokProvider(cred, apiKey) };
}
