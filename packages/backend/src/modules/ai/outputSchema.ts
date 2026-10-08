/**
 * JSON Schema of the mock API specification the model must return (the shape in SYSTEM_PROMPT).
 *
 * It is sent to the provider as a strict `response_format` so a local server (Ollama, vLLM, llama.cpp) can constrain
 * decoding to it. It mirrors llmOutputValidator.validateGeneratedApi, which stays the authority on what is accepted:
 *   - required top level fields: apiVersion, title, description, endpoints (at least one), dataModels;
 *   - endpoint: path and description (strings), method in GET/POST/PUT/DELETE/PATCH, optional requestSchema/responseSchema
 *     (objects) and examples;
 *   - data model: name (string) and schema (object).
 * The only deliberate difference: the validator heals loose `examples` (flat bodies, missing list) while the schema asks
 * for the canonical `{ request, response }` items, because a constrained model should produce the documented format.
 *
 * Plain draft-07 keywords only, so every server's grammar compiler understands it.
 */

const OBJECT = { type: 'object' } as const;

export const MOCK_SPEC_JSON_SCHEMA = {
  type: 'object',
  properties: {
    apiVersion: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    endpoints: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
          description: { type: 'string' },
          requestSchema: OBJECT,
          responseSchema: OBJECT,
          examples: {
            type: 'array',
            items: {
              type: 'object',
              properties: { request: OBJECT, response: OBJECT },
              required: ['request', 'response'],
            },
          },
        },
        required: ['path', 'method', 'description'],
      },
    },
    dataModels: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, schema: OBJECT },
        required: ['name', 'schema'],
      },
    },
  },
  required: ['apiVersion', 'title', 'description', 'endpoints', 'dataModels'],
} as const;
