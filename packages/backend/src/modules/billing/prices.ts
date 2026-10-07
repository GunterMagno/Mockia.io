import type { BillingInterval, PaidPlan } from '@mockia/shared';

/**
 * Los cuatro Price de Stripe (Pro/Team x mensual/anual) viven en variables de entorno. Este modulo es el unico que las conoce:
 * de plan + intervalo saca el price id (checkout) y del price id saca plan + intervalo (webhook).
 */

const PRICE_ENV: Record<PaidPlan, Record<BillingInterval, string>> = {
  pro: { month: 'STRIPE_PRICE_PRO', year: 'STRIPE_PRICE_PRO_YEARLY' },
  team: { month: 'STRIPE_PRICE_TEAM', year: 'STRIPE_PRICE_TEAM_YEARLY' },
};

const PAID_PLANS: readonly PaidPlan[] = ['pro', 'team'];
const INTERVALS: readonly BillingInterval[] = ['month', 'year'];

/** Nombre de la variable de entorno con el price id de ese plan e intervalo. */
export const priceEnvName = (plan: PaidPlan, interval: BillingInterval): string => PRICE_ENV[plan][interval];

/** Price id configurado, o undefined si la variable falta o esta vacia. */
export function priceIdFor(plan: PaidPlan, interval: BillingInterval): string | undefined {
  const id = process.env[priceEnvName(plan, interval)]?.trim();
  return id || undefined;
}

/** Plan e intervalo de un price id, solo si es uno de los configurados. Un id desconocido (o vacio) no es nada. */
export function planAndIntervalOfPrice(priceId: unknown): { plan: PaidPlan; interval: BillingInterval } | undefined {
  if (typeof priceId !== 'string' || priceId === '') return undefined;
  for (const plan of PAID_PLANS) {
    for (const interval of INTERVALS) {
      if (priceIdFor(plan, interval) === priceId) return { plan, interval };
    }
  }
  return undefined;
}
