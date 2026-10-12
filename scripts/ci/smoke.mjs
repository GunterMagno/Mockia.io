// Comprobacion automatica tras desplegar (tarea A4), ejecutada por .github/workflows/post-deploy.yml en cada push a main.
//
//  1. Espera (hasta 10 min) a que `${BACKEND_URL}/api/health` informe del commit de este push. Si el servidor no expone
//     commit, salta la espera y lo anota.
//  2. Comprueba cabeceras de seguridad, CORS cerrado para un origen ajeno y (con OPS_TOKEN) si `X-Forwarded-For` es
//     falsificable llamando DIRECTAMENTE al backend con dos valores distintos.
//  3. Deja las incidencias `post-deploy-auto` al dia (una por problema; se cierran cuando un despliegue posterior pasa).
//
// Las comprobaciones son puras y estan en smoke-checks.mjs. Variables de entorno (de los secretos del repositorio):
//   BACKEND_URL     URL publica del backend, sin barra final. Sin ella el script no hace nada.
//   OPS_TOKEN       opcional; sin el no se comprueba TRUST_PROXY.
//   EXPECTED_SHA    commit que debe servir el backend (github.sha en main; vacio = no se compara).
//   GITHUB_TOKEN, GITHUB_REPOSITORY   para gestionar incidencias.
//   SMOKE_WAIT_MS (600000), SMOKE_POLL_MS (20000)   plazo y periodo de la espera (para pruebas locales).
//   MONITOR_DRY_RUN=1   no llama a gh, imprime lo que haria.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { commitMatches, evaluateSmoke, FOREIGN_ORIGIN } from './smoke-checks.mjs';
import { errorCode, redact } from './monitor-decide.mjs';
import { syncIssues } from './issues.mjs';

export const LABEL = 'post-deploy-auto';
const REQUEST_TIMEOUT_MS = 15_000;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Una lectura de /api/health.
 * @returns {Promise<{reachable: boolean, status: number|null, body: object|null, headers: Headers|object}>}
 */
export async function getHealth(backendUrl, { fetchFn = fetch } = {}) {
  try {
    const res = await fetchFn(`${backendUrl}/api/health`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'User-Agent': 'mockia-smoke' },
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* no era JSON: el cuerpo queda en null */
    }
    return { reachable: res.ok, status: res.status, body, headers: res.headers };
  } catch {
    return { reachable: false, status: null, body: null, headers: {} };
  }
}

/**
 * Espera a que el backend sirva `sha`. Sondea cada `pollMs` hasta `timeoutMs`.
 * @param {string} sha commit esperado ('' = no se compara)
 * @param {{getHealth: () => Promise<object>, sleep?: Function, timeoutMs?: number, pollMs?: number}} opts
 * @returns {Promise<{state: 'match'|'no-commit'|'timeout', health: object}>}
 *          `no-commit`: no hay SHA esperado o el servidor no expone commit (no hay nada que esperar).
 */
export async function waitForCommit(sha, opts) {
  const { getHealth: read, sleep = defaultSleep, timeoutMs = 600_000, pollMs = 20_000 } = opts;
  if (!sha) return { state: 'no-commit', health: await read() };
  const polls = Math.floor(timeoutMs / pollMs);
  let health;
  for (let i = 0; i <= polls; i += 1) {
    health = await read();
    if (health.reachable) {
      const state = commitMatches(health.body, sha);
      if (state === 'match') return { state: 'match', health };
      if (state === 'unknown') return { state: 'no-commit', health };
    }
    if (i < polls) await sleep(pollMs);
  }
  return { state: 'timeout', health };
}

/** Respuesta del backend a una peticion con un origen ajeno; null si la peticion falla (no se evalua). */
async function foreignOriginRequest(backendUrl, method) {
  try {
    const res = await fetch(`${backendUrl}/api/projects`, {
      method,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Origin: FOREIGN_ORIGIN,
        'User-Agent': 'mockia-smoke',
        ...(method === 'OPTIONS' ? { 'Access-Control-Request-Method': 'GET' } : {}),
      },
    });
    return { method, headers: res.headers };
  } catch {
    return null;
  }
}

/** `caller.pseudonym` de /api/ops/summary para una peticion DIRECTA con ese X-Forwarded-For; null si no se puede leer. */
async function pseudonymFor(backendUrl, token, forwardedFor) {
  try {
    const res = await fetch(`${backendUrl}/api/ops/summary`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Forwarded-For': forwardedFor,
        'User-Agent': 'mockia-smoke',
      },
    });
    if (!res.ok) return null;
    const pseudonym = (await res.json())?.caller?.pseudonym;
    return typeof pseudonym === 'string' && pseudonym ? pseudonym : null;
  } catch {
    return null;
  }
}

async function run(env = process.env) {
  const backendUrl = (env.BACKEND_URL ?? '').trim().replace(/\/+$/, '');
  const token = (env.OPS_TOKEN ?? '').trim();
  const sha = (env.EXPECTED_SHA ?? '').trim();
  const secrets = [token, env.GITHUB_TOKEN];
  const dryRun = env.MONITOR_DRY_RUN === '1';

  if (!backendUrl) {
    console.log(
      '::notice::La comprobacion tras desplegar no esta configurada: define el secreto BACKEND_URL (y OPS_TOKEN para comprobar TRUST_PROXY; ver docs/demo.md). No se hizo nada.'
    );
    return 0;
  }

  const waited = await waitForCommit(sha, {
    getHealth: () => getHealth(backendUrl),
    timeoutMs: Number(env.SMOKE_WAIT_MS ?? 600_000),
    pollMs: Number(env.SMOKE_POLL_MS ?? 20_000),
  });
  console.log(`Espera del commit: ${waited.state}.`);

  const reachable = waited.health.reachable;
  const cors = reachable
    ? (
        await Promise.all([
          foreignOriginRequest(backendUrl, 'GET'),
          foreignOriginRequest(backendUrl, 'OPTIONS'),
        ])
      ).filter(Boolean)
    : [];
  // Dos peticiones directas con X-Forwarded-For distintos, una detras de otra (no en paralelo)
  let pseudonyms = null;
  if (reachable && token) {
    const a = await pseudonymFor(backendUrl, token, '203.0.113.7');
    const b = await pseudonymFor(backendUrl, token, '203.0.113.8');
    pseudonyms = [a, b];
  }

  const { findings, evaluated, notes } = evaluateSmoke({
    sha,
    https: new URL(backendUrl).protocol === 'https:',
    health: waited.health,
    cors,
    pseudonyms,
  });
  for (const note of notes) console.log(`::notice::${redact(note, secrets)}`);
  if (!token) console.log('::notice::OPS_TOKEN no esta definido: no se comprueba TRUST_PROXY.');
  console.log(
    `Hallazgos: ${findings.map((f) => `${f.key}/${f.severity}`).join(', ') || 'ninguno'}; comprobado: ${[...evaluated].join(', ')}.`
  );

  if (!env.GITHUB_TOKEN && !dryRun) {
    console.log('::warning::Sin GITHUB_TOKEN no se pueden gestionar incidencias.');
  } else {
    const counts = syncIssues({
      label: LABEL,
      description: 'Incidencia abierta y cerrada por la comprobacion tras desplegar',
      findings,
      evaluated,
      env,
      secrets,
      bodyOptions: { source: 'post-deploy.yml', schedule: ' (tras cada push a main)' },
    });
    console.log(
      `Incidencias: ${counts.opened} abiertas, ${counts.commented} comentadas, ${counts.closed} cerradas.`
    );
  }
  // Un fallo critico deja la ejecucion en rojo ademas de abrir la incidencia; un aviso (TRUST_PROXY) no
  return findings.some((f) => f.severity === 'incident') ? 1 : 0;
}

// Solo se ejecuta como script, no al importarlo desde las pruebas
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(
        `::error::${redact(`${errorCode(err)}: ${err?.message ?? 'fallo de la comprobacion'}`, [process.env.OPS_TOKEN, process.env.GITHUB_TOKEN])}`
      );
      process.exitCode = 1;
    }
  );
}
