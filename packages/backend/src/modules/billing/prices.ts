import type { BillingInterval, PaidPlan } from '@mockia/shared';

/**
 * Los seis Price de Stripe (Starter/Pro/Team x mensual/anual) viven en variables de entorno. Este modulo es el unico que las conoce:
 * de plan + intervalo saca el price id (checkout) y del price id saca plan + intervalo (webhook).
 */

const PRICE_ENV: Record<PaidPlan, Record<BillingInterval, string>> = {
  starter: { month: 'STRIPE_PRICE_STARTER_MONTHLY', year: 'STRIPE_PRICE_STARTER_YEARLY' },
  pro: { month: 'STRIPE_PRICE_PRO', year: 'STRIPE_PRICE_PRO_YEARLY' },
  team: { month: 'STRIPE_PRICE_TEAM', year: 'STRIPE_PRICE_TEAM_YEARLY' },
};

const PAID_PLANS: readonly PaidPlan[] = ['starter', 'pro', 'team'];
const INTERVALS: readonly BillingInterval[] = ['month', 'year'];

/** Nombre de la variable de entorno con el price id de ese plan e intervalo. */
export const priceEnvName = (plan: PaidPlan, interval: BillingInterval): string =>
  PRICE_ENV[plan][interval];

/** Price id configurado, o undefined si la variable falta o esta vacia. */
export function priceIdFor(plan: PaidPlan, interval: BillingInterval): string | undefined {
  const id = process.env[priceEnvName(plan, interval)]?.trim();
  return id || undefined;
}

/**
 * Grupos de variables STRIPE_PRICE_* que tienen el MISMO price id (ignorando espacios; las vacias no cuentan). Cada grupo
 * lista los nombres de las variables, nunca el valor. Un id repetido es siempre un error de configuracion: del id no se
 * puede deducir ni el plan ni el intervalo.
 */
export function duplicatePriceEnvGroups(env: NodeJS.ProcessEnv = process.env): string[][] {
  const byValue = new Map<string, string[]>();
  for (const plan of PAID_PLANS) {
    for (const interval of INTERVALS) {
      const name = priceEnvName(plan, interval);
      const value = env[name]?.trim();
      if (!value) continue;
      byValue.set(value, [...(byValue.get(value) ?? []), name]);
    }
  }
  return [...byValue.values()].filter((names) => names.length > 1);
}

const reportedAmbiguous = new Set<string>();

/**
 * Plan e intervalo de un price id, solo si es uno de los configurados. Un id desconocido (o vacio) no es nada.
 * Un id que esas variables comparten (dos o mas) tampoco: antes ganaba la primera (Starter) en silencio, y un cliente de
 * Pro podia quedar como Starter. assertProdConfig impide arrancar asi en produccion; aqui se rechaza y se avisa (una vez).
 */
export function planAndIntervalOfPrice(
  priceId: unknown
): { plan: PaidPlan; interval: BillingInterval } | undefined {
  if (typeof priceId !== 'string' || priceId === '') return undefined;
  const matches: Array<{ plan: PaidPlan; interval: BillingInterval }> = [];
  for (const plan of PAID_PLANS) {
    for (const interval of INTERVALS) {
      if (priceIdFor(plan, interval) === priceId) matches.push({ plan, interval });
    }
  }
  if (matches.length > 1) {
    const names = matches.map((m) => priceEnvName(m.plan, m.interval));
    const key = names.join(',');
    if (!reportedAmbiguous.has(key)) {
      reportedAmbiguous.add(key);
      console.error(
        `[Billing] ${names.join(' and ')} share the same Stripe price id; it cannot be mapped to a plan, so it grants none. Give each variable its own Price.`
      );
    }
    return undefined;
  }
  return matches[0];
}
