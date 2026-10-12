// Comprobaciones PURAS de la verificacion tras desplegar (tarea A4). smoke.mjs hace las peticiones; aqui se decide si lo
// observado esta bien. Se prueban en smoke-checks.test.mjs con tablas de casos.
//
// Un `Finding` tiene la misma forma que en monitor-decide.mjs ({ key, severity, title, detail }) para reutilizar su
// reconciliacion de incidencias.

/** Origen que nunca estara en CORS_ORIGIN: `.invalid` esta reservado (RFC 2606) y no resuelve. */
export const FOREIGN_ORIGIN = 'https://mockia-smoke-check.invalid';

/** Cabecera de un objeto Headers de fetch o de un objeto plano (sin distinguir mayusculas), recortada; undefined si no esta. */
function header(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name)?.trim() ?? undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : String(headers[key]).trim();
}

/**
 * Compara el commit que informa `/api/health` con el esperado.
 * @returns {'match'|'mismatch'|'unknown'} `unknown`: el servidor no expone commit (o no hay SHA esperado), no se puede decir.
 */
export function commitMatches(health, sha) {
  const served = typeof health?.commit === 'string' ? health.commit.trim().toLowerCase() : '';
  const expected = typeof sha === 'string' ? sha.trim().toLowerCase() : '';
  if (!served || !expected) return 'unknown';
  if (served === expected) return 'match';
  // Algunas plataformas dan el SHA corto: vale si es un prefijo de al menos 7 caracteres
  return served.length >= 7 && expected.startsWith(served) ? 'match' : 'mismatch';
}

/**
 * Cabeceras de seguridad de helmet que faltan en una respuesta del backend.
 * @param {Headers|Record<string,string>|undefined} headers
 * @param {{https?: boolean}} [opts] HSTS solo se exige por https
 * @returns {string[]} nombres de lo que falta (vacio = todo bien)
 */
export function securityHeaders(headers, { https = true } = {}) {
  const missing = [];
  if (header(headers, 'x-content-type-options')?.toLowerCase() !== 'nosniff')
    missing.push('x-content-type-options');
  if (https && !header(headers, 'strict-transport-security'))
    missing.push('strict-transport-security');
  const framing =
    header(headers, 'x-frame-options') ||
    /frame-ancestors/i.test(header(headers, 'content-security-policy') ?? '');
  if (!framing) missing.push('x-frame-options|content-security-policy');
  return missing;
}

/**
 * ¿Rechaza el backend un origen ajeno? Cerrado = la respuesta no le concede acceso: ni `*`, ni su propio origen, ni `null`.
 * @param {Headers|Record<string,string>|undefined} headers respuesta a una peticion con `Origin: FOREIGN_ORIGIN`
 */
export function corsClosed(headers) {
  const allowed = header(headers, 'access-control-allow-origin');
  if (allowed === undefined) return true;
  return !['*', FOREIGN_ORIGIN, 'null'].includes(allowed);
}

/**
 * ¿Se puede falsificar la IP con `X-Forwarded-For`? Recibe los seudonimos (`caller.pseudonym` de /api/ops/summary) de dos
 * peticiones DIRECTAS al backend con cabeceras distintas: si difieren, la cabecera cambia la IP que ve el servidor.
 * @returns {boolean|'unknown'} `'unknown'` si falta alguno (sin DEMO_HMAC_SECRET el seudonimo es null): no se puede decidir
 */
export function ipSpoofable(pseudonymA, pseudonymB) {
  if (!pseudonymA || !pseudonymB) return 'unknown';
  return pseudonymA !== pseudonymB;
}

const short = (sha) => String(sha ?? '').slice(0, 7);

/**
 * De lo observado a los hallazgos.
 * @param {object} o
 * @param {string} o.sha commit esperado ('' si no se compara)
 * @param {boolean} o.https el backend se sirve por https
 * @param {{reachable:boolean,status:number|null,body:object|null,headers:object}} o.health ultima respuesta de /api/health
 * @param {{method:string, headers:object}[]} o.cors respuestas a peticiones con un origen ajeno
 * @param {[string|null,string|null]|null} o.pseudonyms seudonimos de dos peticiones con X-Forwarded-For distintos, o null
 * @returns {{findings: object[], evaluated: Set<string>, notes: string[]}}
 *          `evaluated`: claves comprobadas de verdad (las demas no se cierran ni se abren); `notes`: lo que no se pudo comprobar.
 */
export function evaluateSmoke({ sha, https, health, cors, pseudonyms }) {
  const findings = [];
  const evaluated = new Set();
  const notes = [];

  if (!health.reachable) {
    evaluated.add('deploy-commit');
    findings.push({
      key: 'deploy-commit',
      severity: 'incident',
      title: 'El despliegue no responde',
      detail:
        'El backend no respondio a /api/health en todo el plazo de espera posterior al push a main.',
    });
    return { findings, evaluated, notes };
  }

  const commit = commitMatches(health.body, sha);
  if (commit === 'mismatch') {
    evaluated.add('deploy-commit');
    findings.push({
      key: 'deploy-commit',
      severity: 'incident',
      title: 'El despliegue no sirve este commit',
      detail: `Tras esperar, /api/health sigue informando del commit ${short(health.body?.commit)} y no de ${short(sha)}. El despliegue no ha terminado, ha fallado, o la plataforma no despliega este push.`,
    });
  } else if (commit === 'match') {
    evaluated.add('deploy-commit');
  } else {
    notes.push(
      sha
        ? 'El servidor no expone commit en /api/health (define RENDER_GIT_COMMIT o GIT_COMMIT): no se pudo verificar que sea esta version.'
        : 'No hay commit esperado (ejecucion manual fuera de main): no se compara la version.'
    );
  }

  const missing = securityHeaders(health.headers, { https });
  evaluated.add('security-headers');
  if (missing.length > 0) {
    findings.push({
      key: 'security-headers',
      severity: 'incident',
      title: 'Faltan cabeceras de seguridad',
      detail: `En /api/health faltan: ${missing.join(', ')}. ¿Se ha quitado helmet() o hay un proxy que las elimina?`,
    });
  }

  if (cors.length > 0) {
    evaluated.add('cors-open');
    const open = cors.filter((c) => !corsClosed(c.headers)).map((c) => c.method);
    if (open.length > 0) {
      findings.push({
        key: 'cors-open',
        severity: 'incident',
        title: 'CORS abierto a origenes ajenos',
        detail: `El backend concede acceso a un origen ajeno (${FOREIGN_ORIGIN}) en /api/projects (${open.join(', ')}). Revisa CORS_ORIGIN: no debe ser "*" ni incluir origenes que no sean tuyos.`,
      });
    }
  }

  const spoof = pseudonyms ? ipSpoofable(pseudonyms[0], pseudonyms[1]) : 'unknown';
  if (spoof === 'unknown') {
    notes.push(
      'No se pudo comprobar si X-Forwarded-For es falsificable (hace falta OPS_TOKEN y DEMO_HMAC_SECRET): hazlo a mano con docs/demo.md, "Comprobar TRUST_PROXY con el resumen".'
    );
  } else {
    evaluated.add('ip-spoofable');
    if (spoof) {
      findings.push({
        key: 'ip-spoofable',
        severity: 'warning',
        title: 'X-Forwarded-For se puede falsificar (TRUST_PROXY)',
        detail:
          'Dos peticiones directas a /api/ops/summary con X-Forwarded-For distintos dieron seudonimos distintos: quien llama puede elegir su "IP" y anular los cupos por visitante de la demo. TRUST_PROXY cuenta mas saltos de los que hay delante del backend. Guia y consecuencias: docs/demo.md, "Comprobar TRUST_PROXY con el resumen" (y 8.2 de docs/08_despliegue.md).',
      });
    }
  }

  return { findings, evaluated, notes };
}
