import { AI_PROVIDER_PRESETS, type AiProviderPresetId } from '@mockia/shared';

/**
 * Provider presets (the URLs live in @mockia/shared so the interface shows the same ones) and the request that proves a
 * key is good.
 *
 * Verification asks the provider for something that REQUIRES a valid key and costs nothing. For four of the five that is
 * `GET {baseUrl}/models`. OpenRouter is the exception: its model list is public (it answers 200 to anyone, key or not,
 * checked against the live API), so a "valid" answer would prove nothing; its `GET /key` (the key's own limits) answers
 * 401 to an invalid key.
 */
export { AI_PROVIDER_PRESETS };

const VERIFY_PATH: Record<AiProviderPresetId, string> = {
  openai: '/models',
  openrouter: '/key',
  groq: '/models',
  mistral: '/models',
  together: '/models',
};

/** Path, relative to the credential's baseUrl, of the key check. `custom` (and anything unknown) uses /models. */
export function verifyPathFor(preset: string): string {
  return Object.prototype.hasOwnProperty.call(VERIFY_PATH, preset)
    ? VERIFY_PATH[preset as AiProviderPresetId]
    : '/models';
}
