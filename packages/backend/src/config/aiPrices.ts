/**
 * AI_PRICES_JSON: the owner's price table, used only for the cost estimate of the metrics panel (decision D4: the
 * server never invents prices). Format:
 *
 *   {"<provider>/<model>": {"inputPerMTok": number, "outputPerMTok": number}}
 *
 * Prices are USD per million tokens, as the provider publishes them. The key is the provider name and the model as the
 * server recorded them in AiCall (e.g. "openrouter/anthropic/claude-3.5-sonnet": the model may contain slashes).
 *
 * Empty or unset (the default) or an empty object = no table. Anything else that is not exactly this shape is
 * INVALID as a whole: a half-read table would produce a wrong cost with no hint of it. The result never carries the
 * text of the variable, so callers can report "invalid" without echoing it.
 */

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export type AiPricesResult =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'ok'; prices: ReadonlyMap<string, ModelPrice> };

const isPrice = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function parseAiPrices(env: NodeJS.ProcessEnv = process.env): AiPricesResult {
  const raw = (env.AI_PRICES_JSON ?? '').trim();
  if (raw === '') return { status: 'none' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'invalid' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { status: 'invalid' };
  }
  const prices = new Map<string, ModelPrice>();
  for (const [key, entry] of Object.entries(parsed)) {
    const slash = key.indexOf('/');
    if (slash <= 0 || slash === key.length - 1) return { status: 'invalid' };
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { status: 'invalid' };
    }
    const { inputPerMTok, outputPerMTok } = entry as Record<string, unknown>;
    if (!isPrice(inputPerMTok) || !isPrice(outputPerMTok)) return { status: 'invalid' };
    prices.set(key, { inputPerMTok, outputPerMTok });
  }
  return prices.size === 0 ? { status: 'none' } : { status: 'ok', prices };
}
