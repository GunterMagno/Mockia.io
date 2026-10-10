import fs from 'fs';
import path from 'path';
import { PLANS, PLAN_LIMITS, PLAN_PRICE_USD, ANNUAL_MONTHS_CHARGED, type Plan } from '@mockia/shared';

const ROOT = path.resolve(__dirname, '../../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const doc = read('docs/economia-planes.md');

type Row = Record<string, string>;

/** Primera tabla Markdown que tenga la cabecera dada: filas como {cabecera: celda}. */
const parseTable = (markdown: string, firstHeader: string): Row[] => {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().startsWith('|') && l.split('|')[1]?.trim() === firstHeader);
  if (start < 0) throw new Error(`No hay tabla que empiece por "${firstHeader}"`);
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
  const headers = cells(lines[start]);
  const rows: Row[] = [];
  for (let i = start + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const row = cells(lines[i]);
    rows.push(Object.fromEntries(headers.map((h, idx) => [h, row[idx] ?? ''])));
  }
  return rows;
};

/** "10.000" -> 10000; "1.000.000" -> 1000000; "Ilimitados" -> Infinity. */
const toNumber = (cell: string): number => {
  if (/ilimitad/i.test(cell)) return Infinity;
  const n = Number(cell.replace(/[^\d,]/g, '').replace(/\./g, '').replace(',', '.'));
  if (Number.isNaN(n)) throw new Error(`Celda no numerica: "${cell}"`);
  return n;
};
const usd = (cell: string): number => toNumber(cell.replace(/USD|\$/g, ''));

const NAMES: Record<Plan, string> = { free: 'Free', starter: 'Starter', pro: 'Pro', team: 'Team' };

describe('docs/economia-planes.md', () => {
  const rows = parseTable(doc, 'Plan');
  const rowOf = (plan: Plan): Row => {
    const row = rows.find((r) => r['Plan'] === NAMES[plan]);
    if (!row) throw new Error(`Falta la fila del plan ${NAMES[plan]}`);
    return row;
  };

  it('tiene una fila por cada plan del catalogo y ninguna mas', () => {
    expect(rows.map((r) => r['Plan']).sort()).toEqual(PLANS.map((p) => NAMES[p]).sort());
  });

  it.each(PLANS.map((p) => [p]))('el precio mensual y el anual de %s coinciden con PLAN_PRICE_USD', (plan) => {
    const row = rowOf(plan);
    expect(usd(row['Precio mensual (USD)'])).toBe(PLAN_PRICE_USD[plan].monthly);
    expect(usd(row['Precio anual (USD)'])).toBe(PLAN_PRICE_USD[plan].annual);
  });

  it.each(PLANS.map((p) => [p]))('los limites de %s coinciden con PLAN_LIMITS', (plan) => {
    const row = rowOf(plan);
    const limits = PLAN_LIMITS[plan];
    expect(toNumber(row['Proyectos activos'])).toBe(limits.maxActiveProjects);
    expect(toNumber(row['Peticiones al mes'])).toBe(limits.maxMonthlyRequests);
    expect(toNumber(row['Generaciones de IA al mes'])).toBe(limits.maxMonthlyAiGenerations);
  });

  it('las celdas de coste real y de margen no llevan ninguna cifra inventada: dicen que estan pendientes de medir', () => {
    for (const plan of PLANS) {
      const row = rowOf(plan);
      for (const header of ['Coste de IA en el peor caso', 'Margen estimado']) {
        // Free no cobra: su margen es el coste que asume el titular, pero tampoco se inventa
        expect(row[header]).toMatch(/pendiente de medir/i);
        expect(row[header]).not.toMatch(/\d/);
      }
    }
  });

  it('el documento explica el pago anual con los meses que cobra el catalogo', () => {
    expect(doc).toContain(`${ANNUAL_MONTHS_CHARGED} meses`);
  });

  it('incluye la formula del margen, el procedimiento para medir el coste y la regla del peor caso con Starter', () => {
    expect(doc).toMatch(/margen\s*=\s*precio\s*[−-]\s*comisi[oó]n de Stripe\s*[−-]\s*\(generaciones\s*[×x]\s*coste por generaci[oó]n\)\s*[−-]\s*hosting prorrateado/i);
    expect(doc).toContain('npm run eval');
    expect(doc).toMatch(/peor caso/i);
    expect(doc).toMatch(/Starter/);
    expect(doc).toMatch(/IVA/);
    expect(doc).toMatch(/verifica en tu pa[ií]s/i);
  });

  it('explica cuando se devuelve y cuando NO se devuelve una generacion gastada (ruling B3-R3: un usuario no puede provocar fallos para gastar IA gratis)', () => {
    expect(doc).toMatch(/Qué cuenta como una generación gastada/);
    expect(doc).toMatch(/No se devuelve/);
    expect(doc).toMatch(/salida cortada por longitud/);
    expect(doc).toMatch(/tiempo de espera/);
    expect(doc).toMatch(/error HTTP explícito/);
    expect(doc).toMatch(/intentos fallidos/);
  });

  it('recoge el gasto fijo diario de la demo (DEMO_DAILY_GENERATIONS × coste por generación), sin cifras', () => {
    expect(doc).toMatch(/DEMO_DAILY_GENERATIONS\s*×\s*coste por generación/);
    expect(doc).toContain('docs/demo.md');
    const section = doc.slice(doc.indexOf('## Gasto fijo de la demo pública'), doc.indexOf('## Cómo reajustar un valor'));
    expect(section.length).toBeGreaterThan(200);
    expect(section).not.toMatch(/\d+(?:[.,]\d+)?\s*(?:\$|€|USD|EUR)/);
  });

  it('el procedimiento de reajuste nombra la constante del catalogo y los Price de Stripe', () => {
    expect(doc).toContain('maxMonthlyAiGenerations');
    expect(doc).toContain('packages/shared/src/billing.ts');
    expect(doc).toMatch(/Price de Stripe/);
  });

  it('docs/pagos.md enlaza al documento y aclara que quien pago en USD sigue en USD', () => {
    const pagos = read('docs/pagos.md');
    expect(pagos).toContain('economia-planes.md');
    expect(pagos).toMatch(/ya pag[oó] en USD/i);
  });

  it('evals/README.md explica como obtener los tokens por generacion', () => {
    const readme = read('packages/backend/evals/README.md');
    expect(readme).toMatch(/coste por generaci[oó]n/i);
    expect(readme).toContain('economia-planes.md');
  });
});
