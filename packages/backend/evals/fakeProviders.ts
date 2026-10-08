/**
 * Offline stand-ins for a model, used to test the harness itself (no GPU, no key, no network):
 *   - fake-perfect answers with exactly the expected endpoints: every metric must be 1.0;
 *   - fake-noisy answers with a deterministic, degraded version of them, so the metrics must move.
 */

import type { LlmCompletion, LlmProvider } from '../src/modules/ai/providers/types.js';
import type { EvalCase } from './cases.js';
import type { EndpointSpec } from './scoring.js';

export const FAKE_PROVIDERS = ['fake-perfect', 'fake-noisy'] as const;
export type FakeProviderName = (typeof FAKE_PROVIDERS)[number];

export const isFakeProvider = (name: string): name is FakeProviderName => (FAKE_PROVIDERS as readonly string[]).includes(name);

/** Rough token count (1 token ~ 4 characters), only to give the fakes a usage figure. */
const tokens = (text: string) => Math.ceil(text.length / 4);

function specOf(c: EvalCase, endpoints: EndpointSpec[]) {
  return { apiVersion: '1.0.0', title: c.input.projectTitle, description: c.description, endpoints, dataModels: [] as unknown[] };
}

/** Same endpoint with a response reduced to its first field (a model that "forgot" the types). */
function withThinnedResponses(endpoint: EndpointSpec): EndpointSpec {
  return {
    ...endpoint,
    examples: endpoint.examples.map((example) => {
      const response = example.response as Record<string, unknown>;
      const firstKey = Object.keys(response)[0];
      return { ...example, response: firstKey === undefined ? {} : { [firstKey]: response[firstKey] } };
    }),
  };
}

const INVENTED: EndpointSpec = {
  method: 'DELETE',
  path: '/internal/everything',
  description: 'Invented endpoint that is not in the repository',
  requestSchema: {},
  responseSchema: {},
  examples: [{ request: {}, response: { deleted: true } }],
};

/**
 * Deterministic degradation by the position of the case in the run (index % 5):
 *   0 truncated JSON, 1 half of the endpoints missing and thin responses, 2 one invented endpoint,
 *   3 required field `dataModels` missing, 4 correct but wrapped in prose and a markdown fence.
 */
function noisyText(c: EvalCase, index: number): string {
  const complete = specOf(c, c.expected);
  switch (index % 5) {
    case 0: {
      const json = JSON.stringify(complete);
      return json.slice(0, Math.floor(json.length * 0.6));
    }
    case 1: {
      const kept = c.expected.slice(0, Math.floor(c.expected.length / 2)).map(withThinnedResponses);
      return JSON.stringify(specOf(c, kept));
    }
    case 2:
      return JSON.stringify(specOf(c, [...c.expected, INVENTED]));
    case 3: {
      const { dataModels: _removed, ...withoutModels } = complete;
      return JSON.stringify(withoutModels);
    }
    default:
      return `Here is the specification you asked for:\n\`\`\`json\n${JSON.stringify(complete, null, 2)}\n\`\`\`\nLet me know if you need changes.`;
  }
}

/** @param index position of the case in the run; only fake-noisy uses it */
export function createFakeProvider(kind: FakeProviderName, c: EvalCase, index = 0): LlmProvider {
  return {
    name: kind,
    async complete(req): Promise<LlmCompletion> {
      const text = kind === 'fake-perfect' ? JSON.stringify(specOf(c, c.expected)) : noisyText(c, index);
      return {
        text,
        provider: kind,
        model: 'fake',
        usage: { inputTokens: tokens(req.messages.map((m) => m.content).join('')), outputTokens: tokens(text) },
      };
    },
  };
}
