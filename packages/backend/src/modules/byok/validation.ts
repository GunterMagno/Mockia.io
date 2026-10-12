import Joi from 'joi';
import {
  AI_CREDENTIAL_KEY_MAX,
  AI_CREDENTIAL_KEY_MIN,
  AI_CREDENTIAL_LABEL_MAX,
  AI_CREDENTIAL_MODEL_MAX,
  AI_CREDENTIAL_MODEL_PATTERN,
  AI_PROVIDER_PRESET_IDS,
} from '@mockia/shared';

/**
 * Request schemas of /api/ai-credentials.
 *
 * Joi's default message for a failed `pattern` quotes the offending VALUE, and the validation details travel back to the
 * client (and into error logs of some setups): for `apiKey` that would echo a secret. Every rule of every field therefore
 * carries a fixed message that never includes the value.
 */

// The point of this rule is to refuse control characters, so the regex has to name them
// eslint-disable-next-line no-control-regex
const noControlChars = /^[^\u0000-\u001f\u007f]+$/;
// Printable ASCII without spaces: what API keys are made of; also rules out header-injection characters (CR, LF)
const keyChars = /^[\x21-\x7e]+$/;

const label = Joi.string()
  .trim()
  .min(1)
  .max(AI_CREDENTIAL_LABEL_MAX)
  .pattern(noControlChars)
  .messages({
    'string.base': 'label must be a string',
    'string.empty': 'label is required',
    'string.min': 'label is required',
    'string.max': `label must be at most ${AI_CREDENTIAL_LABEL_MAX} characters`,
    'string.pattern.base': 'label must not contain control characters',
    'any.required': 'label is required',
  });

const model = Joi.string()
  .max(AI_CREDENTIAL_MODEL_MAX)
  .pattern(AI_CREDENTIAL_MODEL_PATTERN)
  .messages({
    'string.base': 'model must be a string',
    'string.empty': 'model is required',
    'string.max': `model must be at most ${AI_CREDENTIAL_MODEL_MAX} characters`,
    'string.pattern.base': 'model may only contain letters, digits and . _ : / @ + -',
    'any.required': 'model is required',
  });

const apiKey = Joi.string()
  .trim()
  .min(AI_CREDENTIAL_KEY_MIN)
  .max(AI_CREDENTIAL_KEY_MAX)
  .pattern(keyChars)
  .messages({
    'string.base': 'apiKey must be a string',
    'string.empty': 'apiKey is required',
    'string.min': `apiKey must be at least ${AI_CREDENTIAL_KEY_MIN} characters`,
    'string.max': `apiKey must be at most ${AI_CREDENTIAL_KEY_MAX} characters`,
    'string.pattern.base': 'apiKey has an invalid format',
    'any.required': 'apiKey is required',
  });

/** POST body. `baseUrl` is only read for preset "custom" and is checked by the service (SSRF policy), not here. */
export const createCredentialSchema = Joi.object({
  label: label.required(),
  preset: Joi.string()
    .valid(...AI_PROVIDER_PRESET_IDS, 'custom')
    .required()
    .messages({
      'any.only': 'preset is not supported',
      'any.required': 'preset is required',
      'string.base': 'preset must be a string',
    }),
  baseUrl: Joi.string()
    .max(300)
    .allow('')
    .messages({ 'string.base': 'baseUrl must be a string', 'string.max': 'baseUrl is too long' }),
  model: model.required(),
  apiKey: apiKey.required(),
});

/** PATCH body: at least one of label, model, apiKey. The provider and its URL cannot change (they are part of the AAD). */
export const updateCredentialSchema = Joi.object({
  label,
  model,
  apiKey,
})
  .min(1)
  .messages({ 'object.min': 'Send at least one of label, model or apiKey' });
