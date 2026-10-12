import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/**
 * Task A2: seguridad automatica del repositorio (Dependabot, CodeQL, npm audit, gitleaks) y reglas comunes a TODOS los
 * workflows de .github/workflows (tambien los que se anadan despues: el test recorre el directorio).
 *
 * Los YAML se leen con js-yaml (ya es dependencia del backend): se comprueba la estructura, no el texto.
 */

const ROOT = path.resolve(__dirname, '../../../..');
const WORKFLOWS_DIR = path.join(ROOT, '.github/workflows');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

type Obj = Record<string, any>;
const load = (rel: string): Obj => yaml.load(read(rel)) as Obj;

const workflowFiles = (): string[] =>
  fs.readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f));

/** Todos los `uses:` de un workflow (pasos de trabajos y trabajos que llaman a un workflow reutilizable). */
const usesOf = (wf: Obj): string[] => {
  const out: string[] = [];
  for (const job of Object.values<Obj>(wf.jobs ?? {})) {
    if (typeof job.uses === 'string') out.push(job.uses);
    for (const step of job.steps ?? []) if (typeof step.uses === 'string') out.push(step.uses);
  }
  return out;
};

/** Ambitos con permiso de escritura (`x: write`) de un bloque `permissions`. */
const writeScopes = (perms: unknown): string[] => {
  if (perms === 'write-all') return ['write-all'];
  if (!perms || typeof perms !== 'object') return [];
  return Object.entries(perms as Obj)
    .filter(([, v]) => v === 'write')
    .map(([k]) => k);
};

describe('Dependabot (.github/dependabot.yml)', () => {
  const cfg = (): Obj => load('.github/dependabot.yml');
  const updates = (): Obj[] => cfg().updates as Obj[];
  const dirsOf = (u: Obj): string[] => (u.directories as string[]) ?? [u.directory as string];

  it('usa la version 2 del esquema', () => {
    expect(cfg().version).toBe(2);
  });

  it('vigila npm en la raiz y en packages/* y github-actions, todos con frecuencia semanal', () => {
    const npm = updates().filter((u) => u['package-ecosystem'] === 'npm');
    const actions = updates().filter((u) => u['package-ecosystem'] === 'github-actions');
    expect(npm.length).toBeGreaterThan(0);
    expect(actions.length).toBeGreaterThan(0);
    const npmDirs = npm.flatMap(dirsOf);
    expect(npmDirs).toContain('/');
    expect(npmDirs).toContain('/packages/*');
    expect(actions.flatMap(dirsOf)).toContain('/');
    for (const u of updates()) expect(u.schedule?.interval).toBe('weekly');
  });

  it('agrupa las actualizaciones menores y de parche para no abrir un PR por paquete', () => {
    for (const u of updates()) {
      const groups = Object.values<Obj>(u.groups ?? {});
      expect(groups.length).toBeGreaterThan(0);
      const types: string[] = groups.flatMap((g) => g['update-types'] ?? []);
      expect(types).toEqual(expect.arrayContaining(['minor', 'patch']));
    }
  });

  it('limita los PR abiertos a la vez', () => {
    for (const u of updates()) {
      expect(u['open-pull-requests-limit']).toBeGreaterThan(0);
      expect(u['open-pull-requests-limit']).toBeLessThanOrEqual(10);
    }
  });
});

describe('security.yml', () => {
  const wf = (): Obj => load('.github/workflows/security.yml');
  const steps = (job: string): Obj[] => wf().jobs[job].steps as Obj[];
  const runs = (job: string): string =>
    steps(job)
      .map((s) => String(s.run ?? ''))
      .join('\n');

  it('se ejecuta en push a main, en pull request y por cron semanal', () => {
    const on = wf().on as Obj;
    expect(on.push.branches).toContain('main');
    expect(on).toHaveProperty('pull_request');
    const crons = (on.schedule as Obj[]).map((s) => s.cron as string);
    expect(crons).toHaveLength(1);
    // minuto hora dia-mes mes dia-semana: un dia concreto de la semana, no "todos los dias"
    expect(crons[0]).toMatch(/^\S+ \S+ \* \* [0-6]$/);
  });

  it('define exactamente los trabajos codeql, npm-audit y gitleaks', () => {
    expect(Object.keys(wf().jobs).sort()).toEqual(['codeql', 'gitleaks', 'npm-audit']);
  });

  it('CodeQL analiza JavaScript/TypeScript con init + analyze de github/codeql-action', () => {
    const uses = steps('codeql').map((s) => String(s.uses ?? ''));
    expect(uses.some((u) => /^github\/codeql-action\/init@v\d+$/.test(u))).toBe(true);
    expect(uses.some((u) => /^github\/codeql-action\/analyze@v\d+$/.test(u))).toBe(true);
    const init = steps('codeql').find((s) => String(s.uses).includes('codeql-action/init')) as Obj;
    expect(init.with.languages).toBe('javascript-typescript');
  });

  it('npm audit solo mira dependencias de produccion y falla con hallazgos altos o criticos', () => {
    expect(runs('npm-audit')).toContain('npm audit --omit=dev --audit-level=high');
  });

  it('gitleaks escanea el historial (checkout completo) con un binario de version fijada', () => {
    const checkout = steps('gitleaks').find((s) =>
      String(s.uses).includes('actions/checkout')
    ) as Obj;
    expect(checkout.with['fetch-depth']).toBe(0);
    const script = runs('gitleaks');
    expect(script).toMatch(/gitleaks[_ ]v?8\.\d+\.\d+|GITLEAKS_VERSION/);
    expect(script).toMatch(/sha256sum/); // el binario se verifica antes de ejecutarlo
    expect(script).toMatch(/gitleaks git/);
    expect(script).toMatch(/--redact/); // nunca imprime el secreto encontrado
  });

  it('los permisos son minimos: contents: read en el workflow y security-events: write solo en CodeQL', () => {
    expect(wf().permissions).toEqual({ contents: 'read' });
    for (const [name, job] of Object.entries<Obj>(wf().jobs)) {
      const w = writeScopes(job.permissions);
      expect(w).toEqual(name === 'codeql' ? ['security-events'] : []);
    }
  });

  it('nada de la entrada del evento (titulo de PR, rama...) se interpola directamente en un script', () => {
    for (const job of Object.keys(wf().jobs)) {
      expect(runs(job)).not.toMatch(/\$\{\{\s*github\.(event|head_ref)/);
    }
  });
});

describe('todos los workflows de .github/workflows', () => {
  it('hay al menos ci.yml y security.yml', () => {
    expect(workflowFiles()).toEqual(expect.arrayContaining(['ci.yml', 'security.yml']));
  });

  it.each(workflowFiles())('%s es YAML valido con disparadores y trabajos', (file) => {
    const wf = load(`.github/workflows/${file}`);
    expect(wf.on).toBeTruthy();
    expect(Object.keys(wf.jobs ?? {}).length).toBeGreaterThan(0);
  });

  it.each(workflowFiles())('%s no usa pull_request_target', (file) => {
    const wf = load(`.github/workflows/${file}`);
    const on = wf.on;
    const triggers = typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {});
    expect(triggers).not.toContain('pull_request_target');
    // ni siquiera como texto (p. ej. un workflow_run que lo simule queda fuera de este test, pero esto lo atrapa)
    expect(read(`.github/workflows/${file}`)).not.toMatch(/^\s*pull_request_target\s*:/m);
  });

  it.each(workflowFiles())(
    '%s fija todo `uses:` a una version mayor concreta (o a un SHA), nunca a una rama',
    (file) => {
      const wf = load(`.github/workflows/${file}`);
      for (const ref of usesOf(wf)) {
        if (ref.startsWith('./')) continue; // acciones del propio repositorio
        expect(ref).toMatch(/^[\w.-]+\/[\w./-]+@(v\d+(\.\d+){0,2}|[0-9a-f]{40})$/);
        expect(ref).not.toMatch(/@(main|master|latest|develop|HEAD)$/i);
      }
    }
  );

  it.each(workflowFiles())(
    '%s declara permisos minimos: contents: read arriba y escrituras solo donde se justifican',
    (file) => {
      const wf = load(`.github/workflows/${file}`);
      // Sin bloque `permissions` el GITHUB_TOKEN toma el valor por defecto del repositorio (a menudo lectura y escritura).
      expect(wf.permissions).toBeDefined();
      expect(writeScopes(wf.permissions)).toEqual([]);
      const allowed = new Set(['issues', 'security-events']);
      for (const [name, job] of Object.entries<Obj>(wf.jobs)) {
        for (const scope of writeScopes(job.permissions)) {
          expect(allowed.has(scope)).toBe(true);
          // security-events: write solo lo necesita CodeQL (subir resultados al panel de seguridad)
          if (scope === 'security-events') expect([file, name]).toEqual(['security.yml', 'codeql']);
        }
      }
    }
  );
});
