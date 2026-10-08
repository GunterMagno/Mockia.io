import { redactSecrets, redactDeep } from '../modules/ai/redact.js';

/**
 * Redaction of training data. Fixtures are assembled at runtime ('sk_' + 'live_' ...) so the source file itself never
 * contains a string that secret scanners (GitHub push protection) would flag.
 */
const rep = (c: string, n: number) => c.repeat(n);
const b64 = (s: string) => Buffer.from(s).toString('base64url');

const SK_LIVE = 'sk_' + 'live_' + rep('a1B2', 6);
const SK_TEST = 'sk_' + 'test_' + rep('Z9y8', 6);
const SK_DASH = 'sk-' + 'proj-' + rep('Qw3r', 8);
const SK_OR = 'sk-' + 'or-v1-' + rep('0f', 20);
const PK = 'pk_' + 'live_' + rep('k7M2', 6);
const GHP = 'ghp' + '_' + rep('A1b2C3', 7);
const GHO = 'gho' + '_' + rep('X9y8Z7', 7);
const GH_PAT = 'github' + '_pat_' + rep('A1b2C3d4', 8);
const AKIA = 'AKIA' + 'ABCDEFGHIJKLMNOP';
const AIZA = 'AIza' + rep('Sy1_', 8) + 'abc';
const XOX = 'xox' + 'b-' + '1234567890-' + rep('abcdEF', 4);
const JWT = [b64('{"alg":"HS256","typ":"JWT"}'), b64('{"sub":"1234567890","name":"x"}'), b64('signature-bytes')].join('.');
const PEM = [
  '-----BEGIN ' + 'RSA PRIVATE KEY-----',
  'MIIEowIBAAKCAQEA' + rep('abcd', 20),
  rep('efgh', 16),
  '-----END ' + 'RSA PRIVATE KEY-----',
].join('\n');
const MONGO = 'mongodb' + '://admin:s3cr3tP4ss@db.internal:27017/app?authSource=admin';
const MONGO_SRV = 'mongodb' + '+srv://user:hunter2@cluster0.example.net/db';
const POSTGRES = 'postgres' + '://app:pa55word@10.0.0.5:5432/app';

const REDACTED_KEY = '[REDACTED_KEY]';
const REDACTED_EMAIL = '[REDACTED_EMAIL]';

describe('redactSecrets: patterns', () => {
  const table: Array<[string, string, string]> = [
    ['Stripe sk_live', `const stripe = new Stripe("${SK_LIVE}");`, SK_LIVE],
    ['Stripe sk_test', `STRIPE_KEY=${SK_TEST}`, SK_TEST],
    ['sk- style key', `OPENAI=${SK_DASH}`, SK_DASH],
    ['OpenRouter sk-or key', `key: ${SK_OR}`, SK_OR],
    ['Stripe pk key', `publishable ${PK} here`, PK],
    ['GitHub ghp_', `token ${GHP} end`, GHP],
    ['GitHub gho_', `${GHO}`, GHO],
    ['GitHub fine-grained PAT', `git clone https://x:${GH_PAT}@github.com/o/r`, GH_PAT],
    ['AWS access key id', `aws_access_key_id ${AKIA}`, AKIA],
    ['Google API key', `GOOGLE ${AIZA}`, AIZA],
    ['Slack token', `slack ${XOX}`, XOX],
    ['JWT', `Cookie: session=${JWT}; Path=/`, JWT],
    ['Bearer token', 'Authorization: Bearer abcdefghijklmnop.qrstuvwxyz-0123456789', 'abcdefghijklmnop.qrstuvwxyz-0123456789'],
    ['mongodb connection string', `MONGODB_URI=${MONGO}`, 's3cr3tP4ss'],
    ['mongodb+srv connection string', `uri = "${MONGO_SRV}"`, 'hunter2'],
    ['postgres connection string', `DATABASE_URL=${POSTGRES}`, 'pa55word'],
    ['email', 'Contact: jane.doe+test@example.co.uk for access', 'jane.doe+test@example.co.uk'],
  ];

  it.each(table)('%s is removed', (_name, text, secret) => {
    const out = redactSecrets(text);
    expect(out).not.toContain(secret);
    expect(out).toMatch(/\[REDACTED_[A-Z_]+\]/);
  });

  it('PEM private key block is removed entirely, surrounding text kept', () => {
    const out = redactSecrets(`before\n${PEM}\nafter`);
    expect(out).toBe(`before\n${REDACTED_KEY}\nafter`);
  });

  it('an unterminated PEM block (truncated prompt) is removed up to the end', () => {
    const truncated = '-----BEGIN ' + 'PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC' + rep('x', 80);
    const out = redactSecrets(`keep this\n${truncated}`);
    expect(out).toBe(`keep this\n${REDACTED_KEY}`);
  });

  it('a PEM public key block is removed too (BEGIN ... KEY)', () => {
    const pub = '-----BEGIN ' + 'PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYI\n-----END ' + 'PUBLIC KEY-----';
    expect(redactSecrets(pub)).toBe(REDACTED_KEY);
  });

  it('uses stable placeholders', () => {
    expect(redactSecrets(SK_LIVE)).toBe(REDACTED_KEY);
    expect(redactSecrets('a@b.com')).toBe(REDACTED_EMAIL);
    expect(redactSecrets(`Bearer abcd1234efgh5678`)).toBe(`Bearer ${REDACTED_KEY}`);
    expect(redactSecrets(MONGO)).not.toContain('admin:');
    // the host of a connection string is not kept either (it can identify an internal system)
    expect(redactSecrets(MONGO)).not.toContain('db.internal');
  });

  it('the credential is removed from a git URL but the rest of the sentence stays', () => {
    const out = redactSecrets(`clone https://alice:${GHP}@github.com/o/r.git then build`);
    expect(out).not.toContain('alice');
    expect(out).not.toContain(GHP);
    expect(out.startsWith('clone ')).toBe(true);
    expect(out.endsWith(' then build')).toBe(true);
  });
});

describe('redactSecrets: generic assignments', () => {
  const cases: Array<[string, string]> = [
    ['password = hunter2', 'hunter2'],
    ['password: "hunter2"', 'hunter2'],
    ["PASSWORD='hunter2'", 'hunter2'],
    ['"password": "hunter2",', 'hunter2'],
    ['JWT_SECRET=supersecretvalue123', 'supersecretvalue123'],
    ['api_key: abc123def456', 'abc123def456'],
    ['API-KEY = abc123def456', 'abc123def456'],
    ['apiKey: "abc123def456"', 'abc123def456'],
    ['secret=0123456789abcdef', '0123456789abcdef'],
    ['ACCESS_TOKEN: "tok_1234567890"', 'tok_1234567890'],
  ];

  it.each(cases)('%s', (text, secret) => {
    const out = redactSecrets(text);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED_KEY);
  });

  it('keeps the name of the variable and the quotes, so the code still reads', () => {
    expect(redactSecrets('password: "hunter2"')).toBe(`password: "${REDACTED_KEY}"`);
    expect(redactSecrets('JWT_SECRET=supersecretvalue123')).toBe(`JWT_SECRET=${REDACTED_KEY}`);
  });
});

describe('redactSecrets: ordinary code and prose stay intact', () => {
  const untouched = [
    'Create a REST API for a gym with members and classes.',
    'export interface Credentials { password: string; token: string; apiKey?: string }',
    'type Login = { password: string }',
    'const schema = Joi.object({ password: Joi.string().min(8).required() });',
    'const secret = process.env.JWT_SECRET;',
    'headers: { token: req.headers.authorization }',
    'password: boolean',
    'POST /api/auth/login returns a token',
    'GET /users/{id}/orders?status=open&page=2',
    'Use the sk- prefix for secret keys', // a prefix alone is not a key
    'The pk column is the primary key',
    'const url = "https://example.com/path?a=1";',
    'https://github.com/owner/repo.git',
    'See docs at http://localhost:3000/api/docs (no credentials)',
    '{"name":"Ada","age":36,"tags":["a","b"]}',
    'Bearer authentication is required',
    'AKIA is the prefix of AWS access keys',
    'Header: Authorization: Bearer <token>',
    'mongodb://localhost:27017/mockia',
  ];

  it.each(untouched)('%s', (text) => {
    expect(redactSecrets(text)).toBe(text);
  });

  it('empty and whitespace-only strings pass through', () => {
    expect(redactSecrets('')).toBe('');
    expect(redactSecrets('  \n')).toBe('  \n');
  });
});

describe('redactSecrets: properties', () => {
  const dirty = [
    `a ${SK_LIVE} b ${GHP} c ${AKIA}`,
    `password: "hunter2" and ${JWT} and x@y.com`,
    `${PEM}\nuri=${MONGO}`,
    `Authorization: Bearer abcd1234efgh5678`,
  ];

  it.each(dirty)('is idempotent: %#', (text) => {
    const once = redactSecrets(text);
    expect(redactSecrets(once)).toBe(once);
  });

  it('redacts every occurrence, not only the first', () => {
    const out = redactSecrets(`${SK_LIVE} ${SK_LIVE} ${GHP} a@b.com c@d.com`);
    expect(out).toBe(`${REDACTED_KEY} ${REDACTED_KEY} ${REDACTED_KEY} ${REDACTED_EMAIL} ${REDACTED_EMAIL}`);
  });

  it('a long non-secret text is processed quickly (no catastrophic backtracking)', () => {
    const big = ('lorem ipsum dolor sit amet ' + rep('a', 50) + ' password ').repeat(4000);
    const t0 = Date.now();
    redactSecrets(big);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('a very long unterminated PEM header does not hang', () => {
    const text = '-----BEGIN ' + 'PRIVATE KEY-----' + rep('A', 200_000);
    const t0 = Date.now();
    expect(redactSecrets(text)).toBe(REDACTED_KEY);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('redactDeep (structured targets)', () => {
  it('redacts every string inside objects and arrays and keeps the JSON valid', () => {
    const input = {
      title: `Admin ${SK_LIVE}`,
      endpoints: [{ path: '/x', description: 'mail a@b.com', examples: [{ request: {}, response: { token: 'abc123def' } }] }],
      count: 3,
      ok: true,
      none: null,
    };
    const out = redactDeep(input) as typeof input;
    const text = JSON.stringify(out);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).not.toContain(SK_LIVE);
    expect(text).not.toContain('a@b.com');
    expect(text).not.toContain('abc123def');
    expect(out.count).toBe(3);
    expect(out.ok).toBe(true);
    expect(out.none).toBeNull();
    expect(out.endpoints[0].path).toBe('/x');
  });

  it('a string under a secret-looking key is redacted, but type words and objects under that key are not', () => {
    const out = redactDeep({ password: 'hunter2', token: 'string', secret: { type: 'string' }, apiKey: '' }) as Record<string, unknown>;
    expect(out.password).toBe(REDACTED_KEY);
    expect(out.token).toBe('string');
    expect(out.secret).toEqual({ type: 'string' });
    expect(out.apiKey).toBe('');
  });

  it('does not mutate its input', () => {
    const input = { a: [`x ${SK_LIVE}`] };
    const copy = JSON.parse(JSON.stringify(input));
    redactDeep(input);
    expect(input).toEqual(copy);
  });
});
