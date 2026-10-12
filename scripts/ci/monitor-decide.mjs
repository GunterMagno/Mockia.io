// Logica PURA de la vigilancia programada (tarea A3): decide que hallazgos hay y que incidencias abrir, comentar o cerrar.
// Sin red, sin gh, sin reloj propio: monitor.mjs hace los sondeos y las llamadas a `gh`; todo lo que se puede equivocar
// esta aqui y se prueba en monitor-decide.test.mjs.
//
// Tipos (JSDoc):
//   Attempt = { ok: boolean, status?: number, error?: string }          un intento de sondeo
//   Probe   = { name: string, url: string, results: Attempt[] }         los intentos hechos contra una URL
//   Finding = { key: string, severity: 'incident' | 'warning', title: string, detail: string }
//   OpsSummary = la respuesta PLANA de GET /api/ops/summary (docs/demo.md, "Resumen operativo")

/** Umbrales documentados en docs/demo.md. */
export const THRESHOLDS = {
  /** Con menos llamadas que estas en la ultima hora la proporcion de errores no dice nada (2 de 3 fallos es ruido). */
  aiMinCalls: 10,
  /** Proporcion de llamadas de IA fallidas (todo resultado distinto de `ok`) a partir de la cual se avisa. */
  aiErrorRatio: 0.5,
  /** Parte del presupuesto diario de la demo gastada a partir de la cual se avisa (y a 1 es incidente). */
  demoBudgetWarning: 0.8,
  demoBudgetIncident: 1,
  /** Una incidencia que sigue abierta sin novedades se recuerda con un comentario cada tantas horas. */
  reminderAfterMs: 6 * 60 * 60 * 1000,
};

/** Titulos estables por clave: la incidencia abierta se reconoce por su marca, el titulo es solo para leer. */
const TITLES = {
  down: 'El servicio no responde',
  'db-down': 'La base de datos no responde',
  'ai-errors': 'Muchas llamadas de IA fallan',
  'breaker-open': 'Un proveedor de IA esta cortado',
  'demo-budget': 'El presupuesto diario de la demo se acaba',
};

/** Nombre corto de un error de fetch, nunca su mensaje (puede traer la URL entera, con sus credenciales). */
export function errorCode(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout';
  // fetch envuelve el fallo de red en un TypeError generico; el motivo (ECONNREFUSED, ENOTFOUND...) esta en `cause.code`
  if (/^[A-Z][A-Z0-9_]{2,40}$/.test(err?.cause?.code ?? '')) return err.cause.code;
  return /^[w.-]{1,40}$/.test(err?.name ?? '') ? err.name : 'error';
}

// --- Texto seguro -------------------------------------------------------------------------------------------------------

/** URL sin credenciales, sin query y sin fragmento (las tres cosas pueden llevar secretos). */
export function safeUrl(url) {
  try {
    const u = new URL(String(url));
    return `${u.origin}${u.pathname}`;
  } catch {
    return '[url no valida]';
  }
}

/**
 * Quita de un texto los secretos dados (tal cual y codificados para URL), las credenciales (`usuario:clave@`) y las query
 * de cualquier URL, y el valor de un `Bearer`. Se aplica a TODO lo que sale hacia una incidencia o un registro.
 */
export function redact(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 4) continue;
    for (const variant of new Set([secret, encodeURIComponent(secret)]))
      out = out.split(variant).join('[oculto]');
  }
  return out
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, '$1')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [oculto]');
}

// --- Decision -----------------------------------------------------------------------------------------------------------

/** Una frase corta del ultimo intento fallido: estado HTTP o nombre del error, nunca un mensaje libre. */
function lastFailure(results) {
  const last = [...results].reverse().find((r) => !r.ok);
  if (!last) return '';
  if (typeof last.status === 'number') return `HTTP ${last.status}`;
  return /^[\w .:-]{1,40}$/.test(last.error ?? '') ? last.error : 'sin respuesta';
}

function downFinding(probes) {
  const failed = probes.filter((p) => p.results.length > 0 && p.results.every((r) => !r.ok));
  if (failed.length === 0) return null;
  const lines = failed.map(
    (p) =>
      `- ${p.name} (${safeUrl(p.url)}): ${p.results.length} de ${p.results.length} intentos fallidos, el ultimo con ${lastFailure(p.results)}`
  );
  return {
    key: 'down',
    severity: 'incident',
    title: TITLES.down,
    detail: `No responde tras reintentarlo:\n${lines.join('\n')}`,
  };
}

/**
 * Claves que esta ejecucion pudo evaluar. Una incidencia solo se cierra por recuperacion si su clave se evaluo: sin
 * resumen (sin token, o el resumen fallo) no se sabe si `ai-errors` sigue, y no se la da por resuelta.
 * @returns {Set<string>}
 */
export function evaluatedKeys(probes, summary) {
  const keys = new Set();
  if (probes.length > 0) keys.add('down');
  if (summary) {
    keys.add('db-down');
    keys.add('breaker-open');
    // Con la base caida las cifras que viven en ella salen a cero: no son una lectura fiable
    if (summary.db?.ok !== false) {
      keys.add('ai-errors');
      keys.add('demo-budget');
    }
  }
  return keys;
}

/**
 * @param {Probe[]} probes
 * @param {object|null} summary respuesta de /api/ops/summary, o null si no hay token o no se pudo leer
 * @returns {Finding[]}
 */
export function decide(probes, summary) {
  const findings = [];
  const down = downFinding(probes);
  if (down) findings.push(down);
  if (!summary) return findings;

  // db.ok se mira primero: si la base no responde, el resumen contesta 200 con las cifras a cero
  if (summary.db?.ok === false) {
    findings.push({
      key: 'db-down',
      severity: 'incident',
      title: TITLES['db-down'],
      detail: 'El backend responde pero informa de que no puede leer MongoDB (db.ok es false).',
    });
  } else {
    const ai = summary.ai?.last60m;
    if (ai && ai.calls >= THRESHOLDS.aiMinCalls && ai.errorRatio >= THRESHOLDS.aiErrorRatio) {
      findings.push({
        key: 'ai-errors',
        severity: 'warning',
        title: TITLES['ai-errors'],
        detail: `${ai.errors} de ${ai.calls} llamadas de IA fallaron en la ultima hora (${Math.round(ai.errorRatio * 100)} %).`,
      });
    }
    const demo = summary.demo;
    if (demo && demo.usedRatio >= THRESHOLDS.demoBudgetWarning) {
      const exhausted = demo.usedRatio >= THRESHOLDS.demoBudgetIncident;
      findings.push({
        key: 'demo-budget',
        severity: exhausted ? 'incident' : 'warning',
        title: TITLES['demo-budget'],
        detail: `La demo ha gastado ${demo.generationsToday} de ${demo.dailyLimit} generaciones de hoy (${Math.round(demo.usedRatio * 100)} %)${exhausted ? ': el cupo esta agotado y la demo no genera hasta manana (UTC).' : '.'}`,
      });
    }
  }

  const open = Object.entries(summary.ai?.breakers ?? {})
    .filter(([, b]) => b?.breaker === 'open')
    .map(([name]) => name);
  if (open.length > 0) {
    findings.push({
      key: 'breaker-open',
      severity: 'warning',
      title: TITLES['breaker-open'],
      detail: `Cortacircuitos abiertos: ${open.join(', ')}. Se cierran cuando una peticion posterior tiene exito.`,
    });
  }
  return findings;
}

// --- Texto de las incidencias y su marca --------------------------------------------------------------------------------

const META = /<!--\s*monitor-key:\s*([\w-]+);\s*severity:\s*(incident|warning)\s*-->/;

export function issueTitle(finding, secrets = []) {
  return redact(`[auto] ${finding.title}`, secrets);
}

/** Cuerpo de la incidencia: la marca (clave y gravedad) permite reconocerla en la siguiente ejecucion. */
export function issueBody(
  finding,
  { secrets = [], source = 'monitor.yml', schedule = ' (cada 15 minutos)' } = {}
) {
  return redact(
    [
      `<!-- monitor-key: ${finding.key}; severity: ${finding.severity} -->`,
      `**Gravedad:** ${finding.severity === 'incident' ? 'incidente' : 'aviso'}`,
      '',
      finding.detail,
      '',
      '---',
      `Abierta automaticamente por \`.github/workflows/${source}\`${schedule}. Se cierra sola cuando el problema desaparece; no la cierres a mano mientras siga ocurriendo.`,
    ].join('\n'),
    secrets
  );
}

export function commentBody(finding, reason, { secrets = [] } = {}) {
  const lead =
    reason === 'severity-changed'
      ? `La gravedad ha cambiado a **${finding.severity === 'incident' ? 'incidente' : 'aviso'}**.`
      : 'Sigue ocurriendo.';
  return redact(`${lead}\n\n${finding.detail}`, secrets);
}

export function closeBody(reason) {
  return reason === 'duplicate'
    ? 'Duplicada de otra incidencia abierta de la misma clave: se cierra.'
    : 'El problema ya no se detecta: se cierra automaticamente.';
}

/** Clave y gravedad de una incidencia abierta por el monitor, o null si no la abrio el (sin marca). */
export function parseIssueMeta(issue) {
  const m = META.exec(issue?.body ?? '');
  return m ? { key: m[1], severity: m[2] } : null;
}

// --- Reconciliacion -----------------------------------------------------------------------------------------------------

/**
 * Compara los hallazgos de esta ejecucion con las incidencias abiertas y dice que hacer, sin duplicar:
 *  - toOpen:    hallazgos sin incidencia abierta (UNA por clave).
 *  - toComment: incidencias abiertas cuyo hallazgo sigue; solo si cambio la gravedad o llevan `reminderAfterMs` sin novedad.
 *  - toClose:   incidencias de una clave sin hallazgo (`recovered`) y las repetidas de una misma clave (`duplicate`).
 * Las incidencias sin marca (hechas a mano) no se tocan.
 *
 * @param {Finding[]} findings
 * @param {{number:number, body?:string, updatedAt?:string}[]} openIssues incidencias abiertas con la etiqueta incident-auto
 * @param {{now?: number, evaluated?: Set<string>, reminderAfterMs?: number}} [opts]
 *        `evaluated`: claves que esta ejecucion pudo comprobar (ver evaluatedKeys); sin el, se asumen todas.
 */
export function reconcile(findings, openIssues, opts = {}) {
  const now = opts.now ?? Date.now();
  const remindAfter = opts.reminderAfterMs ?? THRESHOLDS.reminderAfterMs;

  const byKey = new Map();
  for (const f of findings) {
    const seen = byKey.get(f.key);
    if (!seen || (seen.severity === 'warning' && f.severity === 'incident')) byKey.set(f.key, f);
  }

  const issuesByKey = new Map();
  for (const issue of [...openIssues].sort((a, b) => a.number - b.number)) {
    const meta = parseIssueMeta(issue);
    if (!meta) continue;
    const list = issuesByKey.get(meta.key) ?? [];
    list.push({ issue, meta });
    issuesByKey.set(meta.key, list);
  }

  const toOpen = [];
  const toComment = [];
  const toClose = [];

  for (const [key, finding] of byKey) {
    const issues = issuesByKey.get(key) ?? [];
    if (issues.length === 0) {
      toOpen.push(finding);
      continue;
    }
    const [keep, ...extra] = issues;
    for (const e of extra) toClose.push({ number: e.issue.number, key, reason: 'duplicate' });
    if (keep.meta.severity !== finding.severity) {
      toComment.push({ number: keep.issue.number, finding, reason: 'severity-changed' });
    } else {
      const updated = Date.parse(keep.issue.updatedAt ?? '');
      if (Number.isFinite(updated) && now - updated >= remindAfter) {
        toComment.push({ number: keep.issue.number, finding, reason: 'reminder' });
      }
    }
  }

  for (const [key, issues] of issuesByKey) {
    if (byKey.has(key)) continue;
    if (opts.evaluated && !opts.evaluated.has(key)) continue; // no se pudo comprobar: se deja como esta
    for (const e of issues) toClose.push({ number: e.issue.number, key, reason: 'recovered' });
  }

  return { toOpen, toComment, toClose };
}
