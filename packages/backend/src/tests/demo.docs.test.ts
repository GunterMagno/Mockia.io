import fs from 'fs';
import path from 'path';
import { getDemoConfig } from '../modules/demo/config.js';

const ROOT = path.resolve(__dirname, '../../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string): boolean => fs.existsSync(path.join(ROOT, rel));

/**
 * docs/demo.md es la guia de operacion de la demo publica. Este test la ata al codigo: las variables DEMO_* que cita
 * son exactamente las que lee getDemoConfig (y las que documentan los .env.example), los valores por defecto de su
 * tabla son los reales, las dos variables de IA de la demo (AI_DEMO_*, que NO son DEMO_*) existen, y lo que dice del
 * despliegue (render.yaml / docker-compose.prod.yml) es cierto hoy. Los textos legales tienen que coincidir con la
 * configuracion que prometen (30 minutos) y llevar el mismo numero de marcadores [[REVISAR]] en los tres idiomas.
 */

// `(?<![A-Z_])` evita que AI_DEMO_PROVIDERS / AI_DEMO_TIMEOUT_MS cuenten como DEMO_PROVIDERS / DEMO_TIMEOUT_MS
const DEMO_VAR = /(?<![A-Z0-9_])DEMO_[A-Z0-9_]*[A-Z0-9]/g;
const AI_DEMO_VAR = /(?<![A-Z0-9_])AI_DEMO_[A-Z0-9_]*[A-Z0-9]/g;

const unique = (items: string[] | null): string[] => [...new Set(items ?? [])].sort();

const DOC = exists('docs/demo.md') ? read('docs/demo.md') : '';

describe('docs/demo.md', () => {
  it('existe', () => {
    expect(exists('docs/demo.md')).toBe(true);
    expect(DOC.length).toBeGreaterThan(500);
  });

  describe('variables DEMO_*', () => {
    const inDoc = unique(DOC.match(DEMO_VAR));
    const inConfig = unique(read('packages/backend/src/modules/demo/config.ts').match(DEMO_VAR));
    const inEnvExample = unique(
      read('.env.example')
        .split(/\r?\n/)
        .filter((l) => /^#?\s*DEMO_[A-Z0-9_]+=/.test(l))
        .map((l) => l.replace(/^#?\s*/, '').split('=')[0]),
    );
    const inBackendEnvExample = unique(
      read('packages/backend/.env.example')
        .split(/\r?\n/)
        .filter((l) => /^#?\s*DEMO_[A-Z0-9_]+=/.test(l))
        .map((l) => l.replace(/^#?\s*/, '').split('=')[0]),
    );

    it('las que cita el documento son exactamente las que lee getDemoConfig (ni de mas ni de menos)', () => {
      expect(inConfig).toEqual(
        [
          'DEMO_DAILY_GENERATIONS',
          'DEMO_ENABLED',
          'DEMO_HMAC_SECRET',
          'DEMO_MAX_CONCURRENT',
          'DEMO_MOCK_TTL_MINUTES',
          'DEMO_PER_IP_GENERATIONS',
          'DEMO_POW_BITS',
        ].sort(),
      );
      expect(inDoc).toEqual(inConfig);
    });

    it('coinciden con las de los dos .env.example (raiz y backend)', () => {
      expect(inEnvExample).toEqual(inConfig);
      expect(inBackendEnvExample).toEqual(inConfig);
    });

    it('no confunde las variables de IA de la demo con DEMO_*: se citan aparte y existen en el codigo y en los .env.example', () => {
      const aiInDoc = unique(DOC.match(AI_DEMO_VAR));
      expect(aiInDoc).toEqual(['AI_DEMO_PROVIDERS', 'AI_DEMO_TIMEOUT_MS']);
      const aiSource = read('packages/backend/src/config/ai.ts');
      const rootEnv = read('.env.example');
      const backendEnv = read('packages/backend/.env.example');
      for (const name of aiInDoc) {
        expect(aiSource).toContain(`env.${name}`);
        expect(rootEnv).toMatch(new RegExp(`^#?\\s*${name}=`, 'm'));
        expect(backendEnv).toMatch(new RegExp(`^#?\\s*${name}=`, 'm'));
      }
      // y el regex de DEMO_* no los recoge por error
      expect(unique('AI_DEMO_PROVIDERS AI_DEMO_TIMEOUT_MS'.match(DEMO_VAR))).toEqual([]);
    });

    it('los valores por defecto de la tabla del documento son los reales de getDemoConfig', () => {
      const cfg = getDemoConfig({} as NodeJS.ProcessEnv);
      const defaults: Record<string, string> = {
        DEMO_ENABLED: String(cfg.enabled),
        DEMO_DAILY_GENERATIONS: String(cfg.dailyGenerations),
        DEMO_PER_IP_GENERATIONS: String(cfg.perIpGenerationsPerDay),
        DEMO_MAX_CONCURRENT: String(cfg.maxConcurrent),
        DEMO_POW_BITS: String(cfg.powBits),
        DEMO_MOCK_TTL_MINUTES: String(cfg.mockTtlMinutes),
      };
      for (const [name, value] of Object.entries(defaults)) {
        const row = DOC.split(/\r?\n/).find((l) => l.trim().startsWith('|') && l.includes(`\`${name}\``));
        expect(row).toBeDefined();
        const cells = row!.split('|').map((c) => c.trim());
        expect(cells[2]).toBe(`\`${value}\``);
      }
    });
  });

  describe('contenido operativo', () => {
    const must: Array<[string, RegExp]> = [
      ['como activarla', /DEMO_ENABLED=true/],
      ['el secreto de 32 caracteres', /32 caracteres/],
      ['como apagarla', /DEMO_ENABLED=false/],
      ['calibrar DEMO_POW_BITS con un movil de gama baja', /gama baja/i],
      ['formula del coste maximo diario', /DEMO_DAILY_GENERATIONS\s*×\s*coste por generaci[oó]n/],
      ['remite a la economia de planes para medir el coste', /docs\/economia-planes\.md/],
      ['concurrencia y limitadores por proceso con varias instancias', /por proceso/i],
      ['comprobacion de TRUST_PROXY contra la URL publica del backend', /TRUST_PROXY/],
      ['un X-Forwarded-For falsificado', /X-Forwarded-For/],
      ['medir el truncado con npm run eval antes de activarla', /npm run eval/],
      ['el presupuesto global es barato de agotar (decision de producto)', /agotar/i],
      ['el intento no se devuelve tras salir la peticion al proveedor', /no se devuelve/i],
      ['que mirar si hay abuso', /abuso/i],
      ['los logs del servidor guardan la IP en claro', /logs/i],
      ['los textos legales son un borrador con marcadores [[REVISAR]]', /\[\[REVISAR/],
    ];
    it.each(must)('cubre: %s', (_label, re) => {
      expect(DOC).toMatch(re);
    });

    it('no contiene cifras de coste inventadas (importes en dolares o euros por generacion)', () => {
      expect(DOC).not.toMatch(/\d+(?:[.,]\d+)?\s*(?:\$|€|USD|EUR)\s*(?:por|\/)\s*generaci/i);
    });
  });

  describe('estado del despliegue', () => {
    const forwards = ['render.yaml', 'docker-compose.prod.yml'].some((f) => /(?<![A-Z0-9_])(?:AI_)?DEMO_[A-Z]/.test(read(f)));

    it('lo que el documento dice sobre render.yaml y docker-compose.prod.yml es cierto hoy (cuando B7 reenvie las variables, hay que actualizarlo)', () => {
      expect(DOC).toMatch(/render\.yaml/);
      expect(DOC).toMatch(/docker-compose\.prod\.yml/);
      if (forwards) expect(DOC).not.toMatch(/NO reenv[ií]an/);
      else expect(DOC).toMatch(/NO reenv[ií]an/);
    });
  });
});

describe('textos legales de la demo', () => {
  const LANGS = ['es', 'en', 'zh'] as const;
  const legal = (lang: string): string => read(`packages/frontend/src/pages/Legal/legalContent/${lang}.ts`);

  it('los tres idiomas llevan el mismo numero de marcadores [[REVISAR]] y el de los logs esta en todos', () => {
    const counts = LANGS.map((l) => (legal(l).match(/\[\[REVISAR:/g) ?? []).length);
    expect(counts[0]).toBeGreaterThanOrEqual(1);
    expect(counts).toEqual([counts[0], counts[0], counts[0]]);
    for (const l of LANGS) expect(legal(l)).toContain('[[REVISAR: retención de logs del hosting]]');
  });

  it('prometen la misma caducidad que la configuracion por defecto (30 minutos)', () => {
    expect(getDemoConfig({} as NodeJS.ProcessEnv).mockTtlMinutes).toBe(30);
    expect(legal('es')).toMatch(/30 minutos/);
    expect(legal('en')).toMatch(/30 minutes/);
    expect(legal('zh')).toMatch(/30 分钟/);
  });

  it('declaran que la IP se guarda con HMAC-SHA256 y sal diaria en los tres idiomas', () => {
    for (const l of LANGS) expect(legal(l)).toContain('HMAC-SHA256');
  });
});
