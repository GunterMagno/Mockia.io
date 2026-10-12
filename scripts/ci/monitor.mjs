// Vigilancia programada (tarea A3), ejecutada cada 15 minutos por .github/workflows/monitor.yml.
//
// Sondea `${BACKEND_URL}/api/health` y `${APP_URL}/` con hasta 3 intentos separados 30 s (un fallo aislado de red no es un
// incidente), lee `${BACKEND_URL}/api/ops/summary` si hay OPS_TOKEN, y deja las incidencias de GitHub (etiqueta
// `incident-auto`, UNA por clave) al dia: abre las nuevas, comenta las que siguen y cierra las recuperadas. La decision
// es pura y vive en monitor-decide.mjs; aqui solo hay red y `gh`.
//
// Variables de entorno (todas llegan de los secretos del repositorio, ninguna se escribe en una incidencia ni en el log):
//   BACKEND_URL, APP_URL   URL base publicas (sin barra final). Con ninguna definida el script no hace nada.
//   OPS_TOKEN              opcional; sin el solo se vigila `down`.
//   GITHUB_TOKEN           para `gh` (permiso issues: write), y GITHUB_REPOSITORY (lo pone Actions).
//   MONITOR_DRY_RUN=1      no llama a gh: imprime lo que haria. MONITOR_DRY_RUN_ISSUES: JSON de incidencias abiertas simuladas.
//   MONITOR_RETRY_DELAY_MS espera entre intentos (defecto 30000; para pruebas locales).

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decide, evaluatedKeys, errorCode, redact } from './monitor-decide.mjs';
import { syncIssues } from './issues.mjs';

export const LABEL = 'incident-auto';
const ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sondea una URL hasta `attempts` veces y se detiene en el primer exito. Devuelve un `Probe` (ver monitor-decide.mjs).
 * `fetchFn` y `sleep` se inyectan para probarlo sin red ni esperas.
 */
export async function probeWithRetries(name, url, opts = {}) {
  const {
    fetchFn = fetch,
    sleep = defaultSleep,
    attempts = ATTEMPTS,
    delayMs = 30_000,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = opts;
  const results = [];
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await sleep(delayMs);
    try {
      const res = await fetchFn(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'mockia-monitor' },
      });
      results.push({ ok: res.ok, status: res.status });
      if (res.ok) break;
    } catch (err) {
      results.push({ ok: false, error: errorCode(err) });
    }
  }
  return { name, url, results };
}

/** Lee el resumen operativo. Devuelve null (y un aviso sin secretos) si no se puede: no es un hallazgo por si mismo. */
export async function fetchSummary(backendUrl, token, fetchFn = fetch) {
  try {
    const res = await fetchFn(`${backendUrl}/api/ops/summary`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'mockia-monitor' },
    });
    if (!res.ok) {
      console.log(
        `::warning::/api/ops/summary respondio HTTP ${res.status}: solo se evalua la disponibilidad (revisa el secreto OPS_TOKEN).`
      );
      return null;
    }
    const body = await res.json();
    return body && typeof body === 'object' && body.db ? body : null;
  } catch (err) {
    console.log(
      `::warning::No se pudo leer /api/ops/summary (${errorCode(err)}): solo se evalua la disponibilidad.`
    );
    return null;
  }
}

async function run(env = process.env) {
  const backendUrl = (env.BACKEND_URL ?? '').trim().replace(/\/+$/, '');
  const appUrl = (env.APP_URL ?? '').trim().replace(/\/+$/, '');
  const token = (env.OPS_TOKEN ?? '').trim();
  const secrets = [token, env.GITHUB_TOKEN];
  const dryRun = env.MONITOR_DRY_RUN === '1';
  const delayMs = Number(env.MONITOR_RETRY_DELAY_MS ?? 30_000);

  if (!backendUrl && !appUrl) {
    console.log(
      '::notice::La vigilancia no esta configurada: define los secretos BACKEND_URL y/o APP_URL (ver docs/demo.md). No se hizo nada.'
    );
    return 0;
  }

  const probes = await Promise.all(
    [
      backendUrl && probeWithRetries('backend', `${backendUrl}/api/health`, { delayMs }),
      appUrl && probeWithRetries('app', `${appUrl}/`, { delayMs }),
    ].filter(Boolean)
  );

  // El resumen solo se pide si el backend esta vivo y hay token (sin token no existe: 404)
  const backendUp = probes.some((p) => p.name === 'backend' && p.results.some((r) => r.ok));
  const summary = token && backendUp ? await fetchSummary(backendUrl, token) : null;

  const findings = decide(probes, summary);
  const evaluated = evaluatedKeys(probes, summary);
  console.log(
    `Sondeos: ${probes.map((p) => `${p.name} ${p.results.at(-1)?.ok ? 'ok' : 'FALLA'} (${p.results.length} intento/s)`).join(', ')}; resumen: ${summary ? 'leido' : 'no disponible'}; hallazgos: ${findings.map((f) => `${f.key}/${f.severity}`).join(', ') || 'ninguno'}.`
  );

  if (!env.GITHUB_TOKEN && !dryRun) {
    console.log('::warning::Sin GITHUB_TOKEN no se pueden gestionar incidencias.');
    return 0;
  }

  const counts = syncIssues({
    label: LABEL,
    description: 'Incidencia abierta y cerrada por el monitor',
    findings,
    evaluated,
    env,
    secrets,
    bodyOptions: { source: 'monitor.yml', schedule: ' (cada 15 minutos)' },
  });
  console.log(
    `Incidencias: ${counts.opened} abiertas, ${counts.commented} comentadas, ${counts.closed} cerradas.`
  );
  return 0;
}

// Solo se ejecuta como script, no al importarlo desde las pruebas
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(
        `::error::${redact(err?.message ?? 'fallo del monitor', [process.env.OPS_TOKEN, process.env.GITHUB_TOKEN])}`
      );
      process.exitCode = 1;
    }
  );
}
