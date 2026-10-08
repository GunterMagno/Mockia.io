/**
 * Removal of secrets and personal identifiers from text that is about to become training data.
 *
 * `redactSecrets` is pure and idempotent. It replaces, with stable placeholders:
 *  - `[REDACTED_KEY]`   API keys and tokens (Stripe, OpenAI/OpenRouter style `sk-`, GitHub, AWS, Google, Slack, JWT,
 *                       `Bearer ...`), PEM key blocks, URLs that carry credentials (`scheme://user:pass@host`) and the
 *                       value of `password|secret|token|api_key` assignments.
 *  - `[REDACTED_EMAIL]` e-mail addresses.
 *
 * It errs on the side of over-redacting literals, but it deliberately leaves alone what is only code: type annotations
 * (`password: string`), environment reads (`secret = process.env.JWT_SECRET`) and call or member expressions
 * (`password: Joi.string().min(8)`), because README fragments and TypeScript types are exactly what the model must learn
 * from. Every quantifier is bounded or anchored to a rare literal so that large prompts cannot trigger catastrophic
 * backtracking.
 */

export const REDACTED_KEY = '[REDACTED_KEY]';
export const REDACTED_EMAIL = '[REDACTED_EMAIL]';

// Not preceded by a letter or digit, so `task_sk_live_...` (an identifier that merely ends in the prefix) still matches
// but `desk-lamp-...` style prose does not start a "key".
const NB = '(?<![A-Za-z0-9])';

/** PEM blocks with their END marker, then any BEGIN ... KEY left over (a truncated prompt): up to the end of the text. */
const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]{0,40}KEY)-----[\s\S]*?-----END \1-----/g;
const PEM_UNTERMINATED = /-----BEGIN [A-Z0-9 ]{0,40}KEY-----[\s\S]*$/;

/** `scheme://user:password@host/...`: the whole URL goes (the host of a private database identifies the system). */
const URL_CREDENTIALS = /(?<![A-Za-z0-9+.-])[a-z][a-z0-9+.-]{0,15}:\/\/[^\s\/@:'"`<>]{1,128}:[^\s'"`<>]{1,256}@[^\s'"`<>)]{1,256}/g;

const TOKEN_PATTERNS: RegExp[] = [
  new RegExp(`${NB}(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}`, 'g'), // Stripe
  new RegExp(`${NB}(?:sk|pk)_[A-Za-z0-9]{24,}`, 'g'),
  new RegExp(`${NB}sk-[A-Za-z0-9_-]{16,}`, 'g'), // OpenAI, OpenRouter, Anthropic
  new RegExp(`${NB}gh[pousr]_[A-Za-z0-9]{20,}`, 'g'), // GitHub tokens
  new RegExp(`${NB}github_pat_[A-Za-z0-9_]{20,}`, 'g'),
  new RegExp(`${NB}(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])`, 'g'), // AWS access key id
  new RegExp(`${NB}AIza[0-9A-Za-z_-]{30,}`, 'g'), // Google API key
  new RegExp(`${NB}xox[baprs]-[A-Za-z0-9-]{10,}`, 'g'), // Slack
  /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{0,}/g, // JWT
];

/** `Bearer <token>`: only values that look like one (they contain a digit), so "Bearer authentication" stays prose. */
const BEARER = /(Bearer\s+)(?=[A-Za-z0-9._~+/=-]{0,200}\d)[A-Za-z0-9._~+/=-]{8,}/g;

const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,4}\.[A-Za-z]{2,24}/g;

/**
 * `name = value` where name contains password/secret/token/api key (optionally with a quote, with a `_key|_id|...`
 * suffix, in `.env`, JSON or code). Group 1: name + separator, group 2: the value, quoted or not.
 */
const SECRET_NAME = '(?:password|passwd|secret|token|api[_-]?key|apikey|private[_-]?key)(?:[_-]?(?:key|id|secret|value|hash))?';
const ASSIGNMENT = new RegExp(
  `(${SECRET_NAME}\\\\?["']?\\s*[:=]\\s*)("[^"\\n]{1,500}"|'[^'\\n]{1,500}'|[^\\s,;'"\`]{1,500})`,
  'gi'
);

const SECRET_KEY_NAME = new RegExp(`${SECRET_NAME}$`, 'i');

const TYPE_WORDS = new Set([
  'string', 'number', 'boolean', 'bool', 'any', 'unknown', 'never', 'void', 'null', 'undefined', 'true', 'false',
  'object', 'array', 'date', 'integer', 'int', 'float', 'required', 'optional', 'secret', 'password', 'token',
  'changeme', 'example', 'your-token', 'your_token', 'yourpassword', 'your-password', 'xxxxx', 'xxxxxx', '******',
]);

/** True when a would-be secret value is clearly not a literal: a type, a placeholder, or code that reads/derives one. */
function isNotALiteralSecret(raw: string): boolean {
  const unquoted = raw.replace(/^["']|["']$/g, '');
  if (unquoted.includes(REDACTED_KEY)) return true; // already done (idempotence)
  if (/^["']/.test(raw)) {
    // a quoted value is a literal unless it is a type word or a placeholder
    return TYPE_WORDS.has(unquoted.toLowerCase()) || /^\$\{.*\}$|^<.*>$|^\*+$|^x+$/i.test(unquoted);
  }
  if (raw.length < 6) return true; // too short to be worth losing the surrounding sentence
  const lower = raw.toLowerCase().replace(/[;,)}\]]+$/, '');
  if (TYPE_WORDS.has(lower)) return true;
  if (/^[<{(\[$]/.test(raw)) return true; // <token>, ${TOKEN}, {...}, (...), [...], $TOKEN
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\([^)]*\)?|\[[^\]]*\]?)+/.test(raw)) return true; // process.env.X, Joi.string(), a[0]
  if (/^(?:process|env|req|res|this|config|import)\b/.test(raw)) return true;
  return false;
}

/** Replaces secrets and e-mail addresses in a string. Pure and idempotent. */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(PEM_BLOCK, REDACTED_KEY).replace(PEM_UNTERMINATED, REDACTED_KEY);
  out = out.replace(URL_CREDENTIALS, REDACTED_KEY);
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, REDACTED_KEY);
  out = out.replace(BEARER, `$1${REDACTED_KEY}`);
  out = out.replace(ASSIGNMENT, (whole: string, head: string, value: string) => {
    if (isNotALiteralSecret(value)) return whole;
    const quote = /^["']/.test(value) ? value[0] : '';
    return `${head}${quote}${REDACTED_KEY}${quote}`;
  });
  out = out.replace(EMAIL, REDACTED_EMAIL);
  return out;
}

/**
 * Redacts every string inside a JSON-like value (objects, arrays, strings; other scalars pass through) and returns a
 * NEW value, so the result is always valid JSON when stringified. A string stored under a secret-looking key
 * (`"password": "hunter2"`) is redacted as a whole unless it is a type word or already a placeholder.
 */
export function redactDeep<T>(value: T): T {
  return walk(value, undefined) as T;
}

function walk(value: unknown, key: string | undefined): unknown {
  if (typeof value === 'string') {
    if (key && SECRET_KEY_NAME.test(key) && value !== '' && !isNotALiteralSecret(JSON.stringify(value))) return REDACTED_KEY;
    return redactSecrets(value);
  }
  if (Array.isArray(value)) return value.map((v) => walk(v, undefined));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[redactSecrets(k)] = walk(v, k);
    return out;
  }
  return value;
}
