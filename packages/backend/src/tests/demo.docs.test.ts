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
        // la fila de la tabla de variables: la variable es la primera celda (otras tablas la citan en otras columnas)
        const row = DOC.split(/\r?\n/).find((l) => l.trim().startsWith('|') && l.split('|')[1]?.trim() === `\`${name}\``);
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
      ['GET /api/demo/availability: anonimo, cacheable y fuera de los limitadores', /\/api\/demo\/availability[\s\S]*cach/],
      ['/status responde 200 con available false cuando la demo esta apagada', /available:\s*false/],
      ['limite a 0 de generaciones diarias', /DEMO_DAILY_GENERATIONS=0/],
      ['limite a 0 de generaciones por visitante', /DEMO_PER_IP_GENERATIONS=0/],
      ['el seudonimo por si solo no permite seguirte pero los logs si tienen la IP', /seud[oó]nimo por s[ií] solo/],
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
    // Solo variables reales: "- key: DEMO_X" en render.yaml y "DEMO_X:" como clave de environment en compose. Un
    // comentario que cite una variable no cuenta, y cada fichero se comprueba por separado (un reenvio parcial
    // obliga a corregir solo la linea del fichero afectado).
    const FORWARDS: Record<string, RegExp> = {
      'render.yaml': /^\s*-\s*key:\s*(?:AI_)?DEMO_[A-Z0-9_]+\s*$/m,
      'docker-compose.prod.yml': /^\s*(?:AI_)?DEMO_[A-Z0-9_]+\s*:/m,
    };

    it.each(Object.keys(FORWARDS))(
      'lo que el documento dice sobre %s es cierto hoy (cuando B7 reenvie las variables, hay que actualizarlo)',
      (file) => {
        const forwards = FORWARDS[file].test(read(file));
        const line = DOC.split(/\r?\n/).find((l) => l.trim().startsWith('- `' + file + '`'));
        expect(line).toBeDefined();
        if (forwards) expect(line).toMatch(/S[ÍI] reenv[ií]a/);
        else expect(line).toMatch(/NO reenv[ií]a/);
      },
    );

    it('un comentario que cita una variable no activa el cable trampa, una variable real si', () => {
      expect(FORWARDS['render.yaml'].test('  # DEMO_ENABLED se activa a mano\n')).toBe(false);
      expect(FORWARDS['render.yaml'].test('      - key: DEMO_ENABLED\n')).toBe(true);
      expect(FORWARDS['docker-compose.prod.yml'].test('      # DEMO_ENABLED: x\n')).toBe(false);
      expect(FORWARDS['docker-compose.prod.yml'].test('      DEMO_ENABLED: ${DEMO_ENABLED:-}\n')).toBe(true);
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

  // Las secciones con id 'demo' (Privacidad, Terminos, Cookies). Cada idioma ya tenia un "30 minutos" no relacionado
  // (el enlace de restablecimiento), asi que la caducidad se busca DENTRO de la seccion de la demo, no en el fichero.
  const demoSections = (lang: string): string[] => legal(lang).match(/id: ['"]demo['"],[\s\S]*?\n {8}\},\n/g) ?? [];

  it('Privacidad, Terminos y Cookies tienen cada uno su seccion de la demo en los tres idiomas', () => {
    for (const l of LANGS) expect(demoSections(l)).toHaveLength(3);
  });

  it('la seccion de la demo de Privacidad y la de Terminos prometen la caducidad por defecto (30 minutos)', () => {
    expect(getDemoConfig({} as NodeJS.ProcessEnv).mockTtlMinutes).toBe(30);
    const minutes: Record<string, RegExp> = { es: /30 minutos/, en: /30 minutes/, zh: /30 分钟/ };
    for (const l of LANGS) {
      const [privacy, terms] = demoSections(l);
      expect(privacy).toMatch(minutes[l]);
      expect(terms).toMatch(minutes[l]);
    }
  });

  it('la seccion de la demo de Privacidad y la de Terminos avisan de que la API generada puede reproducir lo pegado', () => {
    const phrase: Record<string, RegExp> = {
      es: /puede reproducir fragmentos de lo que pegas/,
      en: /may reproduce fragments of what you paste/,
      zh: /可能复述你粘贴内容中的片段/,
    };
    for (const l of LANGS) {
      const [privacy, terms] = demoSections(l);
      expect(privacy).toMatch(phrase[l]);
      expect(terms).toMatch(phrase[l]);
    }
  });

  it('declaran que la IP se guarda con HMAC-SHA256 y sal diaria en los tres idiomas', () => {
    for (const l of LANGS) expect(legal(l)).toContain('HMAC-SHA256');
  });

  it('B6: Privacidad y Cookies declaran el id de la demo en el almacenamiento de sesion SOLO al decidir guardar el proyecto, en los tres idiomas', () => {
    const phrases: Record<string, RegExp[]> = {
      es: [/Solo si decides guardar el proyecto/, /almacenamiento de sesión de esta pestaña/, /hasta que lo reclames o la cierres/, /estrictamente necesario/],
      en: [/Only if you decide to save the project/, /session storage of this tab/, /until you claim it or close the tab/, /strictly necessary/],
      zh: [/只有当你决定保存该项目时/, /此标签页的会话存储/, /直到你认领它或关闭该标签页/, /严格必要/],
    };
    for (const l of LANGS) {
      const [privacy, , cookies] = demoSections(l);
      for (const re of phrases[l]) {
        expect(`${l} privacidad: ${privacy}`).toMatch(re);
        expect(`${l} cookies: ${cookies}`).toMatch(re);
      }
    }
  });

  it('B6: el frontend solo toca sessionStorage en el modulo del id pendiente de la demo (y en el aviso de verificacion de siempre)', () => {
    const root = path.join(ROOT, 'packages/frontend/src');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && /sessionStorage\s*\.\s*(get|set|remove)Item/.test(fs.readFileSync(full, 'utf8'))) {
          hits.push(path.relative(root, full).split(path.sep).join('/'));
        }
      }
    };
    walk(root);
    expect(hits.sort()).toEqual(['components/ui/EmailVerificationBanner/EmailVerificationBanner.tsx', 'services/demoPending.ts']);
    // y el modulo solo escribe cuando se le pide guardar: la pagina de la demo lo llama unicamente desde el boton de guardar
    const demoPage = read('packages/frontend/src/pages/Demo/Demo.tsx');
    const writes = demoPage.match(/rememberPendingDemo\(/g) ?? [];
    expect(writes).toHaveLength(1);
  });
});
