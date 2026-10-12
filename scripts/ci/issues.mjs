// Gestion de incidencias de GitHub con `gh` (compartida por monitor.mjs y smoke.mjs). La decision de que abrir, comentar o
// cerrar es pura y vive en monitor-decide.mjs (reconcile); aqui solo se ejecuta.
//
// El texto de las incidencias viaja por stdin (`--body-file -`) y el token por el entorno de `gh` (GH_TOKEN): nunca en los
// argumentos, y `gh` se invoca sin shell, asi que nada de lo que lleve un hallazgo se interpreta como orden.

import { execFileSync } from 'node:child_process';
import {
  reconcile,
  issueTitle,
  issueBody,
  commentBody,
  closeBody,
  redact,
} from './monitor-decide.mjs';

export function makeGh(env, secrets) {
  const repo = env.GITHUB_REPOSITORY ? ['--repo', env.GITHUB_REPOSITORY] : [];
  return (args, input) => {
    try {
      return execFileSync('gh', [...args, ...repo], {
        input,
        encoding: 'utf8',
        env: { ...process.env, GH_TOKEN: env.GITHUB_TOKEN },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      // Por precaucion tambien se limpia el mensaje de gh aunque no deberia llevar secretos
      throw new Error(
        `gh ${args.slice(0, 2).join(' ')} fallo: ${redact(String(err.stderr || err.message).trim(), secrets)}`
      );
    }
  };
}

/**
 * Deja las incidencias de `label` al dia con los hallazgos: abre las nuevas (una por clave), comenta las que cambian de
 * gravedad o llevan mucho sin novedad, y cierra las recuperadas.
 *
 * @param {object} o
 * @param {string} o.label etiqueta de las incidencias de este flujo (`incident-auto`, `post-deploy-auto`)
 * @param {object[]} o.findings hallazgos de esta ejecucion
 * @param {Set<string>} o.evaluated claves que se pudieron comprobar
 * @param {NodeJS.ProcessEnv} o.env GITHUB_TOKEN, GITHUB_REPOSITORY y, en pruebas locales, MONITOR_DRY_RUN
 * @param {string[]} o.secrets valores que nunca deben aparecer en el texto
 * @param {{source: string, schedule: string}} o.bodyOptions pie de las incidencias
 * @returns {{opened: number, commented: number, closed: number}}
 */
export function syncIssues({ label, description, findings, evaluated, env, secrets, bodyOptions }) {
  const dryRun = env.MONITOR_DRY_RUN === '1';
  const gh = makeGh(env, secrets);
  const body = { secrets, ...bodyOptions };

  const openIssues = dryRun
    ? JSON.parse(env.MONITOR_DRY_RUN_ISSUES || '[]')
    : JSON.parse(
        gh([
          'issue',
          'list',
          '--label',
          label,
          '--state',
          'open',
          '--limit',
          '100',
          '--json',
          'number,body,updatedAt',
        ])
      );
  const plan = reconcile(findings, openIssues, { evaluated });

  const act = (what, args, input) => {
    if (dryRun) console.log(`[dry-run] ${what}${input ? `\n${redact(input, secrets)}` : ''}`);
    else gh(args, input);
  };

  if (plan.toOpen.length > 0) {
    act('gh label create', [
      'label',
      'create',
      label,
      '--color',
      'B60205',
      '--description',
      description,
      '--force',
    ]);
  }
  for (const f of plan.toOpen) {
    act(
      `abrir ${f.key}`,
      ['issue', 'create', '--title', issueTitle(f, secrets), '--label', label, '--body-file', '-'],
      issueBody(f, body)
    );
  }
  for (const c of plan.toComment) {
    if (c.reason === 'severity-changed') {
      // La marca del cuerpo lleva la gravedad: se actualiza para no repetir el aviso en cada ejecucion
      act(
        `actualizar #${c.number} (${c.finding.key})`,
        ['issue', 'edit', String(c.number), '--body-file', '-'],
        issueBody(c.finding, body)
      );
    }
    act(
      `comentar #${c.number} (${c.reason})`,
      ['issue', 'comment', String(c.number), '--body-file', '-'],
      commentBody(c.finding, c.reason, { secrets })
    );
  }
  for (const c of plan.toClose) {
    act(`cerrar #${c.number} (${c.key}, ${c.reason})`, [
      'issue',
      'close',
      String(c.number),
      '--comment',
      closeBody(c.reason),
    ]);
  }
  return {
    opened: plan.toOpen.length,
    commented: plan.toComment.length,
    closed: plan.toClose.length,
  };
}
