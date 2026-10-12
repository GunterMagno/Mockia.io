// Pruebas de la vigilancia programada (tarea A3). Se ejecutan con `node --test scripts/ci/` (tambien desde ci.yml).
// Todo lo que se prueba aqui es puro: sin red, sin gh, sin reloj real.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  decide,
  reconcile,
  evaluatedKeys,
  issueTitle,
  issueBody,
  parseIssueMeta,
  redact,
  safeUrl,
  THRESHOLDS,
} from './monitor-decide.mjs';
import { probeWithRetries } from './monitor.mjs';

const ok = { ok: true, status: 200 };
const fail = { ok: false, status: 503 };
const probe = (name, results) => ({ name, url: `https://${name}.example.com/`, results });
const healthyProbes = () => [probe('backend', [ok]), probe('app', [ok])];

/** Resumen con la forma real de GET /api/ops/summary (plana) y todo en orden; cada test cambia lo que necesita. */
const summary = (over = {}) => ({
  generatedAt: '2026-10-12T10:00:00.000Z',
  db: { ok: true },
  demo: { enabled: true, generationsToday: 10, dailyLimit: 100, usedRatio: 0.1 },
  ai: {
    last60m: { calls: 20, errors: 1, errorRatio: 0.05, byScope: {} },
    breakers: {},
  },
  caller: { pseudonym: null },
  ...over,
});
const keys = (findings) => findings.map((f) => f.key).sort();

describe('decide: /health y la aplicacion (Review Focus 5)', () => {
  test('(a) un fallo en 1 de 3 reintentos no es un hallazgo', () => {
    for (const results of [
      [fail, ok, ok],
      [ok, fail, ok],
      [fail, fail, ok],
      [fail, ok],
    ]) {
      assert.deepEqual(decide([probe('backend', results), probe('app', [ok])], null), []);
    }
  });

  test('(a) falla en los 3 reintentos: hallazgo `down` de severidad incident que nombra el servicio', () => {
    const findings = decide([probe('backend', [fail, fail, fail]), probe('app', [ok])], null);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].key, 'down');
    assert.equal(findings[0].severity, 'incident');
    assert.match(findings[0].detail, /backend/);
    assert.doesNotMatch(findings[0].detail, /\bapp\b/);
  });

  test('(a) un error de red (sin estado HTTP) tambien cuenta, y los dos servicios caidos salen en UN hallazgo', () => {
    const net = { ok: false, error: 'timeout' };
    const findings = decide(
      [probe('backend', [net, net, net]), probe('app', [fail, fail, fail])],
      null
    );
    assert.deepEqual(keys(findings), ['down']);
    assert.match(findings[0].detail, /backend/);
    assert.match(findings[0].detail, /app/);
    assert.match(findings[0].detail, /timeout/);
    assert.match(findings[0].detail, /503/);
  });

  test('sin sondeos no hay hallazgos (nada configurado)', () => {
    assert.deepEqual(decide([], null), []);
    assert.deepEqual(decide([probe('app', [])], null), []);
  });
});

describe('decide: resumen operativo', () => {
  test('(b) errorRatio >= 0.5 con calls >= 10 abre ai-errors; en el limite exacto tambien', () => {
    const s = summary({
      ai: { last60m: { calls: 10, errors: 5, errorRatio: 0.5, byScope: {} }, breakers: {} },
    });
    const findings = decide(healthyProbes(), s);
    assert.deepEqual(keys(findings), ['ai-errors']);
    assert.match(findings[0].detail, /5 de 10/);
  });

  test('(b) por debajo del umbral de proporcion o con menos de 10 llamadas no hay nada', () => {
    const at = (calls, errors, errorRatio) =>
      summary({ ai: { last60m: { calls, errors, errorRatio, byScope: {} }, breakers: {} } });
    assert.deepEqual(decide(healthyProbes(), at(10, 4, 0.4)), []);
    assert.deepEqual(decide(healthyProbes(), at(9, 9, 1)), []);
    assert.deepEqual(decide(healthyProbes(), at(0, 0, 0)), []);
    assert.equal(THRESHOLDS.aiMinCalls, 10);
    assert.equal(THRESHOLDS.aiErrorRatio, 0.5);
  });

  test('(c) un cortacircuitos open abre breaker-open y nombra solo los abiertos', () => {
    const s = summary({
      ai: {
        last60m: { calls: 0, errors: 0, errorRatio: 0, byScope: {} },
        breakers: {
          'users:local': { scope: 'users', provider: 'local', breaker: 'open' },
          'demo:groq': { scope: 'demo', provider: 'groq', breaker: 'closed' },
        },
      },
    });
    const findings = decide(healthyProbes(), s);
    assert.deepEqual(keys(findings), ['breaker-open']);
    assert.match(findings[0].detail, /users:local/);
    assert.doesNotMatch(findings[0].detail, /demo:groq/);
  });

  test('(c) con todos cerrados, o sin cadenas construidas ({}), no hay hallazgo', () => {
    const closed = { 'users:local': { scope: 'users', provider: 'local', breaker: 'closed' } };
    assert.deepEqual(
      decide(healthyProbes(), summary({ ai: { last60m: summary().ai.last60m, breakers: closed } })),
      []
    );
    assert.deepEqual(decide(healthyProbes(), summary()), []);
  });

  test('(d) usedRatio >= 0.8 es warning y >= 1 es incident; por debajo no hay nada', () => {
    const at = (usedRatio) =>
      summary({
        demo: { enabled: true, generationsToday: usedRatio * 100, dailyLimit: 100, usedRatio },
      });
    assert.deepEqual(decide(healthyProbes(), at(0.79)), []);
    for (const [ratio, severity] of [
      [0.8, 'warning'],
      [0.99, 'warning'],
      [1, 'incident'],
    ]) {
      const findings = decide(healthyProbes(), at(ratio));
      assert.equal(findings.length, 1, `usedRatio ${ratio}`);
      assert.equal(findings[0].key, 'demo-budget');
      assert.equal(findings[0].severity, severity, `usedRatio ${ratio}`);
    }
  });

  test('(e) sin resumen (sin token o sin respuesta) solo se evalua `down`', () => {
    assert.deepEqual(decide(healthyProbes(), null), []);
    assert.deepEqual(keys(decide([probe('backend', [fail, fail, fail])], null)), ['down']);
    assert.deepEqual([...evaluatedKeys(healthyProbes(), null)], ['down']);
  });

  test('db.ok === false es el hallazgo db-down (incident) y no se miran las cifras que viven en la base', () => {
    const s = summary({
      db: { ok: false },
      demo: { enabled: true, generationsToday: 0, dailyLimit: 100, usedRatio: 1 },
    });
    const findings = decide(healthyProbes(), s);
    assert.deepEqual(keys(findings), ['db-down']);
    assert.equal(findings[0].severity, 'incident');
    assert.deepEqual([...evaluatedKeys(healthyProbes(), s)].sort(), [
      'breaker-open',
      'db-down',
      'down',
    ]);
  });

  test('varios problemas a la vez dan un hallazgo por clave, con claves estables', () => {
    const s = summary({
      demo: { enabled: true, generationsToday: 100, dailyLimit: 100, usedRatio: 1 },
      ai: {
        last60m: { calls: 12, errors: 12, errorRatio: 1, byScope: {} },
        breakers: { 'users:local': { scope: 'users', provider: 'local', breaker: 'open' } },
      },
    });
    const findings = decide([probe('backend', [fail, fail, fail]), probe('app', [ok])], s);
    assert.deepEqual(keys(findings), ['ai-errors', 'breaker-open', 'demo-budget', 'down']);
    for (const f of findings) {
      assert.ok(['incident', 'warning'].includes(f.severity));
      assert.ok(f.title.length > 0 && f.detail.length > 0);
    }
  });
});

/** Una incidencia abierta tal y como la devuelve `gh issue list --json number,body,updatedAt`. */
const openIssue = (number, finding, updatedAt = '2026-10-12T10:00:00.000Z') => ({
  number,
  body: issueBody(finding),
  updatedAt,
});
const finding = (key, severity = 'incident') => ({
  key,
  severity,
  title: `titulo ${key}`,
  detail: `detalle ${key}`,
});
const NOW = Date.parse('2026-10-12T10:15:00.000Z');

describe('reconcile (Review Focus 5)', () => {
  test('(f) un hallazgo nuevo se abre una sola vez; la segunda ejecucion no abre otra', () => {
    const findings = [finding('down')];
    const first = reconcile(findings, [], { now: NOW });
    assert.deepEqual(
      first.toOpen.map((f) => f.key),
      ['down']
    );
    assert.deepEqual(first.toComment, []);
    assert.deepEqual(first.toClose, []);

    // La incidencia que abrio la primera ejecucion aparece ya en la lista de abiertas de la segunda
    const second = reconcile(findings, [openIssue(7, findings[0])], { now: NOW });
    assert.deepEqual(second.toOpen, []);
    assert.deepEqual(second.toClose, []);
  });

  test('(f) un hallazgo que desaparece cierra su incidencia, y solo esa', () => {
    const issues = [openIssue(7, finding('down')), openIssue(8, finding('demo-budget', 'warning'))];
    const result = reconcile([finding('demo-budget', 'warning')], issues, { now: NOW });
    assert.deepEqual(
      result.toClose.map((c) => [c.number, c.key, c.reason]),
      [[7, 'down', 'recovered']]
    );
    assert.deepEqual(result.toOpen, []);
  });

  test('(f) sin hallazgos se cierra todo lo abierto', () => {
    const issues = [openIssue(1, finding('down')), openIssue(2, finding('ai-errors', 'warning'))];
    const result = reconcile([], issues, { now: NOW });
    assert.deepEqual(result.toClose.map((c) => c.number).sort(), [1, 2]);
  });

  test('(f) una incidencia en curso no se comenta en cada ejecucion: solo al cambiar la gravedad o como recordatorio', () => {
    const f = finding('demo-budget', 'warning');
    // Actualizada hace 15 minutos: nada que decir
    assert.deepEqual(
      reconcile([f], [openIssue(3, f, '2026-10-12T10:00:00.000Z')], { now: NOW }).toComment,
      []
    );
    // La gravedad sube de warning a incident: se comenta (y se anota la nueva)
    const worse = finding('demo-budget', 'incident');
    const changed = reconcile([worse], [openIssue(3, f)], { now: NOW });
    assert.deepEqual(
      changed.toComment.map((c) => [c.number, c.reason]),
      [[3, 'severity-changed']]
    );
    // Sin novedad en 6 horas: recordatorio
    const stale = reconcile([f], [openIssue(3, f, '2026-10-12T03:00:00.000Z')], { now: NOW });
    assert.deepEqual(
      stale.toComment.map((c) => [c.number, c.reason]),
      [[3, 'reminder']]
    );
    assert.equal(stale.toComment[0].finding.key, 'demo-budget');
  });

  test('(f) si hay dos incidencias abiertas de la misma clave se conserva la mas antigua y se cierra la otra', () => {
    const f = finding('down');
    const result = reconcile([f], [openIssue(9, f), openIssue(4, f)], { now: NOW });
    assert.deepEqual(result.toOpen, []);
    assert.deepEqual(
      result.toClose.map((c) => [c.number, c.reason]),
      [[9, 'duplicate']]
    );
  });

  test('(f) las incidencias sin marca del monitor (hechas a mano) no se tocan', () => {
    const manual = { number: 5, body: 'Lo abri yo a mano', updatedAt: '2026-10-01T00:00:00.000Z' };
    const result = reconcile([], [manual], { now: NOW });
    assert.deepEqual(result, { toOpen: [], toComment: [], toClose: [] });
  });

  test('(f) una clave que no se pudo evaluar (resumen no disponible) no cierra su incidencia', () => {
    const issues = [openIssue(1, finding('down')), openIssue(2, finding('ai-errors', 'warning'))];
    // Solo se evaluo `down` (no hay resumen): `down` se recupero, ai-errors no se sabe
    const result = reconcile([], issues, { now: NOW, evaluated: new Set(['down']) });
    assert.deepEqual(
      result.toClose.map((c) => c.key),
      ['down']
    );
  });

  test('la marca de la incidencia se lee de vuelta', () => {
    assert.deepEqual(parseIssueMeta(openIssue(1, finding('breaker-open', 'warning'))), {
      key: 'breaker-open',
      severity: 'warning',
    });
    assert.equal(parseIssueMeta({ number: 2, body: 'sin marca' }), null);
    assert.equal(parseIssueMeta({ number: 3 }), null);
  });
});

describe('texto de las incidencias (g)', () => {
  const TOKEN = 'a'.repeat(16) + 'SECRETO-DEL-MONITOR' + 'b'.repeat(16);

  test('(g) las URL salen sin credenciales, sin query y sin fragmento', () => {
    assert.equal(
      safeUrl('https://user:pass@api.example.com/api/health?token=abc#x'),
      'https://api.example.com/api/health'
    );
    assert.equal(safeUrl('https://api.example.com'), 'https://api.example.com/');
    assert.equal(safeUrl('esto no es una url con pass'), '[url no valida]');
  });

  test('(g) decide nunca copia credenciales de la URL de un sondeo al hallazgo', () => {
    const risky = {
      name: 'backend',
      url: 'https://admin:hunter2@backend.example.com/api/health?apikey=XYZ123',
      results: [fail, fail, fail],
    };
    const text = JSON.stringify(decide([risky], null));
    assert.doesNotMatch(text, /hunter2|XYZ123|admin:/);
    assert.match(text, /backend\.example\.com/);
  });

  test('(g) redact elimina el token (y su version codificada) y las credenciales de cualquier URL del texto', () => {
    const dirty = `fallo con Bearer ${TOKEN} en https://u:p4ss@x.example.com/a?k=${encodeURIComponent(TOKEN)} y ${encodeURIComponent(TOKEN)}`;
    const clean = redact(dirty, [TOKEN]);
    assert.doesNotMatch(clean, new RegExp(TOKEN));
    assert.doesNotMatch(clean, /SECRETO-DEL-MONITOR/);
    assert.doesNotMatch(clean, /p4ss/);
    assert.doesNotMatch(clean, /u:p4ss/);
    // Un secreto vacio o indefinido no rompe nada ni borra todo el texto
    assert.equal(redact('hola', [undefined, '', null]), 'hola');
  });

  test('(g) el titulo y el cuerpo de la incidencia no incluyen el token aunque el detalle lo traiga', () => {
    const leaky = {
      key: 'down',
      severity: 'incident',
      title: `Caido ${TOKEN}`,
      detail: `Error: GET https://u:p4ss@x.example.com/api/ops/summary con Authorization: Bearer ${TOKEN}`,
    };
    for (const text of [issueTitle(leaky, [TOKEN]), issueBody(leaky, { secrets: [TOKEN] })]) {
      assert.doesNotMatch(text, /SECRETO-DEL-MONITOR/);
      assert.doesNotMatch(text, /p4ss/);
    }
  });

  test('el cuerpo lleva la marca de clave y gravedad, y el titulo es estable por clave', () => {
    const f = finding('demo-budget', 'warning');
    assert.match(issueBody(f), /monitor-key: demo-budget/);
    assert.match(issueBody(f), /severity: warning/);
    assert.equal(issueTitle(f), issueTitle({ ...f, detail: 'otro detalle' }));
    assert.match(issueTitle(f), /^\[auto\]/);
  });
});

describe('probeWithRetries (monitor.mjs)', () => {
  const response = (status) => ({ ok: status >= 200 && status < 300, status });

  test('para en el primer exito: un fallo aislado deja 2 resultados y espera 30 s una sola vez', async () => {
    const answers = [response(503), response(200)];
    const sleeps = [];
    const result = await probeWithRetries('backend', 'https://b.example.com/api/health', {
      fetchFn: async () => answers.shift(),
      sleep: async (ms) => sleeps.push(ms),
    });
    assert.deepEqual(
      result.results.map((r) => r.ok),
      [false, true]
    );
    assert.deepEqual(sleeps, [30_000]);
    assert.deepEqual(decide([result], null), []);
  });

  test('falla 3 veces (HTTP 503 o excepcion) con 30 s entre intentos y da el hallazgo down', async () => {
    let n = 0;
    const sleeps = [];
    const result = await probeWithRetries('app', 'https://a.example.com/', {
      fetchFn: async () => {
        n += 1;
        if (n === 2)
          throw Object.assign(new Error('boom con https://u:p@a.example.com'), {
            name: 'TypeError',
          });
        return response(503);
      },
      sleep: async (ms) => sleeps.push(ms),
    });
    assert.equal(n, 3);
    assert.deepEqual(sleeps, [30_000, 30_000]);
    assert.deepEqual(keys(decide([result], null)), ['down']);
    // El mensaje de la excepcion no se copia (puede traer la URL con credenciales): solo su nombre
    assert.doesNotMatch(JSON.stringify(result), /boom|u:p@/);
  });
});
