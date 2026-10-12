// Pruebas de la comprobacion tras desplegar (tarea A4): tablas de casos de las comprobaciones puras, la composicion de
// hallazgos y la espera del commit. Sin red ni reloj real.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  commitMatches,
  securityHeaders,
  corsClosed,
  ipSpoofable,
  evaluateSmoke,
  FOREIGN_ORIGIN,
} from './smoke-checks.mjs';
import { waitForCommit } from './smoke.mjs';
import { parseIssueMeta, issueBody } from './monitor-decide.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';

// Las cabeceras reales que helmet() pone en el backend (comprobadas con un servidor de prueba)
const HELMET = {
  'content-security-policy': "default-src 'self';frame-ancestors 'self'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'no-referrer',
};
const without = (headers, ...names) =>
  Object.fromEntries(Object.entries(headers).filter(([k]) => !names.includes(k)));

describe('commitMatches(health, sha)', () => {
  const table = [
    ['igual', { commit: SHA }, SHA, 'match'],
    ['igual sin distinguir mayusculas', { commit: SHA.toUpperCase() }, SHA, 'match'],
    ['commit corto que es prefijo del SHA', { commit: SHA.slice(0, 7) }, SHA, 'match'],
    ['distinto', { commit: 'f'.repeat(40) }, SHA, 'mismatch'],
    ['prefijo de menos de 7 caracteres no vale', { commit: SHA.slice(0, 5) }, SHA, 'mismatch'],
    ['ausente (el servidor no lo expone)', { status: 'ok' }, SHA, 'unknown'],
    ['null (RENDER_GIT_COMMIT y GIT_COMMIT sin definir)', { commit: null }, SHA, 'unknown'],
    ['cadena vacia', { commit: '  ' }, SHA, 'unknown'],
    ['sin cuerpo (no era JSON)', null, SHA, 'unknown'],
    ['commit que no es texto', { commit: 42 }, SHA, 'unknown'],
    ['sin SHA esperado (ejecucion manual desde otra rama)', { commit: SHA }, '', 'unknown'],
    ['sin SHA esperado y sin commit', { commit: null }, undefined, 'unknown'],
  ];
  for (const [name, health, sha, expected] of table) {
    test(name, () => assert.equal(commitMatches(health, sha), expected));
  }
});

describe('securityHeaders(headers, { https })', () => {
  const table = [
    ['todas las de helmet por https', HELMET, true, []],
    [
      'claves en mayusculas y valores con espacios',
      {
        'X-Content-Type-Options': ' nosniff ',
        'X-Frame-Options': 'DENY',
        'Strict-Transport-Security': 'max-age=1',
      },
      true,
      [],
    ],
    ['un objeto Headers de fetch', new Headers(HELMET), true, []],
    [
      'sin x-content-type-options',
      without(HELMET, 'x-content-type-options'),
      true,
      ['x-content-type-options'],
    ],
    [
      'x-content-type-options con otro valor',
      { ...HELMET, 'x-content-type-options': 'none' },
      true,
      ['x-content-type-options'],
    ],
    [
      'sin HSTS por https',
      without(HELMET, 'strict-transport-security'),
      true,
      ['strict-transport-security'],
    ],
    ['sin HSTS por http no se exige', without(HELMET, 'strict-transport-security'), false, []],
    [
      'sin x-frame-options pero con CSP con frame-ancestors',
      without(HELMET, 'x-frame-options'),
      true,
      [],
    ],
    [
      'sin x-frame-options y con CSP sin frame-ancestors',
      { ...without(HELMET, 'x-frame-options'), 'content-security-policy': "default-src 'self'" },
      true,
      ['x-frame-options|content-security-policy'],
    ],
    [
      'sin x-frame-options ni CSP',
      without(HELMET, 'x-frame-options', 'content-security-policy'),
      true,
      ['x-frame-options|content-security-policy'],
    ],
    [
      'sin nada (helmet quitado)',
      {},
      true,
      [
        'x-content-type-options',
        'strict-transport-security',
        'x-frame-options|content-security-policy',
      ],
    ],
    [
      'sin cabeceras definidas',
      undefined,
      true,
      [
        'x-content-type-options',
        'strict-transport-security',
        'x-frame-options|content-security-policy',
      ],
    ],
  ];
  for (const [name, headers, https, expected] of table) {
    test(name, () => assert.deepEqual(securityHeaders(headers, { https }), expected));
  }
  test('por defecto se asume https', () => {
    assert.deepEqual(securityHeaders(without(HELMET, 'strict-transport-security')), [
      'strict-transport-security',
    ]);
  });
});

describe('corsClosed(headers) para un origen ajeno', () => {
  const table = [
    ['sin access-control-allow-origin (cerrado)', { vary: 'Origin' }, true],
    [
      'con credentials pero sin allow-origin (como responde el backend)',
      { 'access-control-allow-credentials': 'true' },
      true,
    ],
    ['sin cabeceras', {}, true],
    ['con comodin *', { 'access-control-allow-origin': '*' }, false],
    ['refleja el origen ajeno', { 'access-control-allow-origin': FOREIGN_ORIGIN }, false],
    ['claves en mayusculas', { 'Access-Control-Allow-Origin': FOREIGN_ORIGIN }, false],
    ['permite el origen null', { 'access-control-allow-origin': 'null' }, false],
    [
      'devuelve solo el origen propio (no el ajeno)',
      { 'access-control-allow-origin': 'https://app.example.com' },
      true,
    ],
    [
      'un objeto Headers de fetch con comodin',
      new Headers({ 'access-control-allow-origin': '*' }),
      false,
    ],
    ['un objeto Headers de fetch sin la cabecera', new Headers({ vary: 'Origin' }), true],
  ];
  for (const [name, headers, expected] of table) {
    test(name, () => assert.equal(corsClosed(headers), expected));
  }
  test('el origen ajeno de la prueba es uno que nunca estara en CORS_ORIGIN', () => {
    assert.match(FOREIGN_ORIGIN, /^https:\/\/[a-z0-9.-]+\.invalid$/);
  });
});

describe('ipSpoofable(pseudonymA, pseudonymB)', () => {
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  const table = [
    ['seudonimos distintos con X-Forwarded-For distintos: se puede falsificar', A, B, true],
    ['seudonimos iguales: la cabecera no cuenta', A, A, false],
    ['el primero es null (sin DEMO_HMAC_SECRET): no se puede decidir', null, A, 'unknown'],
    ['el segundo es null', A, null, 'unknown'],
    ['los dos son null', null, null, 'unknown'],
    ['indefinidos (la llamada fallo)', undefined, undefined, 'unknown'],
    ['cadenas vacias', '', '', 'unknown'],
  ];
  for (const [name, a, b, expected] of table) {
    test(name, () => assert.equal(ipSpoofable(a, b), expected));
  }
});

describe('evaluateSmoke: de las observaciones a los hallazgos', () => {
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  const healthy = () => ({
    sha: SHA,
    https: true,
    health: { reachable: true, status: 200, body: { status: 'ok', commit: SHA }, headers: HELMET },
    cors: [
      { method: 'GET', headers: { vary: 'Origin' } },
      { method: 'OPTIONS', headers: {} },
    ],
    pseudonyms: [A, A],
  });
  const keys = (r) => r.findings.map((f) => f.key).sort();

  test('todo en orden: sin hallazgos y las cuatro claves evaluadas (se cierran las incidencias viejas)', () => {
    const r = evaluateSmoke(healthy());
    assert.deepEqual(r.findings, []);
    assert.deepEqual([...r.evaluated].sort(), [
      'cors-open',
      'deploy-commit',
      'ip-spoofable',
      'security-headers',
    ]);
  });

  test('commit distinto: incidente deploy-commit', () => {
    const o = healthy();
    o.health.body = { commit: 'f'.repeat(40) };
    const r = evaluateSmoke(o);
    assert.deepEqual(keys(r), ['deploy-commit']);
    assert.equal(r.findings[0].severity, 'incident');
  });

  test('el servidor no expone commit: no es fallo, se anota y la clave queda sin evaluar', () => {
    const o = healthy();
    o.health.body = { status: 'ok', commit: null };
    const r = evaluateSmoke(o);
    assert.deepEqual(r.findings, []);
    assert.ok(!r.evaluated.has('deploy-commit'));
    assert.ok(r.notes.some((n) => /commit/i.test(n)));
  });

  test('sin SHA esperado (ejecucion manual desde otra rama) no se compara el commit', () => {
    const o = healthy();
    o.sha = '';
    o.health.body = { commit: 'f'.repeat(40) };
    const r = evaluateSmoke(o);
    assert.deepEqual(r.findings, []);
    assert.ok(!r.evaluated.has('deploy-commit'));
  });

  test('el backend no responde: incidente deploy-commit y nada mas se evalua', () => {
    const r = evaluateSmoke({
      ...healthy(),
      health: { reachable: false, status: null, body: null, headers: {} },
      cors: [],
      pseudonyms: null,
    });
    assert.deepEqual(keys(r), ['deploy-commit']);
    assert.deepEqual([...r.evaluated], ['deploy-commit']);
  });

  test('CORS abierto en cualquiera de las dos respuestas: incidente cors-open', () => {
    const o = healthy();
    o.cors = [
      { method: 'GET', headers: { vary: 'Origin' } },
      { method: 'OPTIONS', headers: { 'access-control-allow-origin': '*' } },
    ];
    const r = evaluateSmoke(o);
    assert.deepEqual(keys(r), ['cors-open']);
    assert.equal(r.findings[0].severity, 'incident');
    assert.match(r.findings[0].detail, /OPTIONS/);
  });

  test('faltan cabeceras de helmet: incidente security-headers que las nombra', () => {
    const o = healthy();
    o.health.headers = without(HELMET, 'x-content-type-options');
    const r = evaluateSmoke(o);
    assert.deepEqual(keys(r), ['security-headers']);
    assert.match(r.findings[0].detail, /x-content-type-options/);
  });

  test('seudonimos distintos: aviso (warning) ip-spoofable con la guia de docs/demo.md', () => {
    const o = healthy();
    o.pseudonyms = [A, B];
    const r = evaluateSmoke(o);
    assert.deepEqual(keys(r), ['ip-spoofable']);
    assert.equal(r.findings[0].severity, 'warning');
    assert.match(r.findings[0].detail, /docs\/demo\.md/);
    assert.match(r.findings[0].detail, /TRUST_PROXY/);
  });

  test('seudonimo null o sin token: no se puede decidir, ni hallazgo ni cierre', () => {
    for (const pseudonyms of [null, [null, null], [A, null]]) {
      const r = evaluateSmoke({ ...healthy(), pseudonyms });
      assert.deepEqual(r.findings, []);
      assert.ok(!r.evaluated.has('ip-spoofable'));
      assert.ok(r.notes.some((n) => /TRUST_PROXY|seudonimo/i.test(n)));
    }
  });

  test('varios fallos a la vez dan un hallazgo por clave, reconocible por la marca de la incidencia', () => {
    const o = healthy();
    o.health.body = { commit: 'f'.repeat(40) };
    o.health.headers = {};
    o.cors = [{ method: 'GET', headers: { 'access-control-allow-origin': FOREIGN_ORIGIN } }];
    o.pseudonyms = [A, B];
    const r = evaluateSmoke(o);
    assert.deepEqual(keys(r), ['cors-open', 'deploy-commit', 'ip-spoofable', 'security-headers']);
    for (const f of r.findings) {
      const meta = parseIssueMeta({ body: issueBody(f, { source: 'post-deploy.yml' }) });
      assert.deepEqual(meta, { key: f.key, severity: f.severity });
    }
  });
});

describe('waitForCommit: espera a que el despliegue sirva este commit', () => {
  const answer = (commit, extra = {}) => ({
    reachable: true,
    status: 200,
    body: { commit },
    headers: {},
    ...extra,
  });
  const down = { reachable: false, status: null, body: null, headers: {} };
  const run = (answers, opts = {}) => {
    const sleeps = [];
    const queue = [...answers];
    const promise = waitForCommit(SHA, {
      getHealth: async () => (queue.length > 1 ? queue.shift() : queue[0]),
      sleep: async (ms) => sleeps.push(ms),
      timeoutMs: 600_000,
      pollMs: 20_000,
      ...opts,
    });
    return promise.then((r) => ({ ...r, sleeps }));
  };

  test('el commit nuevo aparece tras un par de sondeos con la version vieja o el servicio reiniciando', async () => {
    const r = await run([answer('1'.repeat(40)), down, answer(SHA)]);
    assert.equal(r.state, 'match');
    assert.deepEqual(r.sleeps, [20_000, 20_000]);
    assert.equal(r.health.body.commit, SHA);
  });

  test('si el servidor no expone commit salta la espera de inmediato', async () => {
    const r = await run([answer(null)]);
    assert.equal(r.state, 'no-commit');
    assert.deepEqual(r.sleeps, []);
  });

  test('nunca llega el commit: tras 10 minutos (31 sondeos cada 20 s) da por vencido el plazo', async () => {
    const r = await run([answer('1'.repeat(40))]);
    assert.equal(r.state, 'timeout');
    assert.equal(r.sleeps.length, 30);
    assert.equal(
      r.sleeps.reduce((a, b) => a + b, 0),
      600_000
    );
    assert.equal(r.health.body.commit, '1'.repeat(40));
  });

  test('el servicio no responde nunca: timeout con la ultima observacion no alcanzable', async () => {
    const r = await run([down]);
    assert.equal(r.state, 'timeout');
    assert.equal(r.health.reachable, false);
  });

  test('sin SHA esperado no espera: se comprueba lo que haya', async () => {
    const sleeps = [];
    const r = await waitForCommit('', {
      getHealth: async () => answer('1'.repeat(40)),
      sleep: async (ms) => sleeps.push(ms),
    });
    assert.equal(r.state, 'no-commit');
    assert.deepEqual(sleeps, []);
  });
});
