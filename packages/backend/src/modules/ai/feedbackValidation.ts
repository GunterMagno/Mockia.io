import Joi from 'joi';

/** A correction is a whole API specification; 200 KB is far above any real one and below the 1 MB body limit. */
export const MAX_CORRECTED_OUTPUT_BYTES = 200 * 1024;

/**
 * Body of POST /ai/feedback. Unknown keys (a client-supplied provider/model/output, say) are stripped by the validate
 * middleware, never stored.
 */
export const feedbackSchema = Joi.object({
  generationId: Joi.string().uuid().required().messages({
    'any.required': 'generationId is required',
    'string.guid': 'generationId must be a UUID',
    'string.base': 'generationId must be a UUID',
  }),
  verdict: Joi.string().valid('good', 'bad').required().messages({
    'any.only': 'verdict must be "good" or "bad"',
    'any.required': 'verdict is required',
    'string.base': 'verdict must be "good" or "bad"',
  }),
  correctedOutput: Joi.object()
    .unknown(true)
    .custom((value: unknown, helpers) => {
      if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_CORRECTED_OUTPUT_BYTES) {
        return helpers.message({ custom: 'correctedOutput is too large (200 KB maximum)' });
      }
      return value;
    })
    .optional()
    .messages({ 'object.base': 'correctedOutput must be an object' }),
});

/** Longest requirement (free text the user writes) accepted by the endpoint-generation routes. */
export const MAX_REQUIREMENT_CHARS = 4000;

/**
 * Body of POST /ai/generate-mock-api-spec and /ai/generate-and-save. Only these two fields survive (the validate
 * middleware strips the rest): a client-sent temperature or maxTokens is dropped, the server decides the sampling.
 */
export const generationBodySchema = Joi.object({
  projectId: Joi.string().trim().min(1).max(200).required().messages({
    'any.required': 'projectId is required',
    'string.base': 'projectId must be a string',
    'string.max': 'projectId is too long',
  }),
  requirement: Joi.string().trim().min(1).max(MAX_REQUIREMENT_CHARS).required().messages({
    'any.required': 'requirement is required (description of what the mock API should do)',
    'string.base': 'requirement must be a string',
    'string.empty': 'requirement is required (description of what the mock API should do)',
    'string.max': `requirement is too long (${MAX_REQUIREMENT_CHARS} characters maximum)`,
  }),
});
