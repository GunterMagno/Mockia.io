/**
 * Catalogo de planes: fuente unica para backend (limites que se aplican) y frontend (lo que se anuncia).
 * Cambiar un precio aqui NO cambia lo que cobra Stripe: el importe real vive en los Price de Stripe
 * (STRIPE_PRICE_STARTER_MONTHLY / STRIPE_PRICE_PRO / STRIPE_PRICE_TEAM y sus variantes anuales). Mantener ambos alineados.
 */

export type Plan = 'free' | 'starter' | 'pro' | 'team';
export type PaidPlan = Exclude<Plan, 'free'>;
export type BillingStatus = 'active' | 'past_due' | 'canceled';

export interface PlanLimits {
  /** Proyectos no archivados que puede tener el propietario. Infinity = ilimitado. */
  maxActiveProjects: number;
  /** Peticiones a los mocks publicos por mes natural (UTC). Infinity = ilimitado. */
  maxMonthlyRequests: number;
  /** Generaciones de IA por mes natural (UTC). Lo aplica el servidor antes de llamar al LLM. */
  maxMonthlyAiGenerations: number;
}

/** De menor a mayor: el orden en que se anuncian y se comparan los planes. */
export const PLANS: readonly Plan[] = ['free', 'starter', 'pro', 'team'];

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { maxActiveProjects: 5, maxMonthlyRequests: 10_000, maxMonthlyAiGenerations: 5 },
  starter: { maxActiveProjects: 15, maxMonthlyRequests: 100_000, maxMonthlyAiGenerations: 40 },
  pro: { maxActiveProjects: 50, maxMonthlyRequests: 1_000_000, maxMonthlyAiGenerations: 300 },
  team: { maxActiveProjects: Infinity, maxMonthlyRequests: 10_000_000, maxMonthlyAiGenerations: 1500 },
};

/**
 * Dias que se conserva el plan de pago tras el primer cobro fallido (estado past_due) antes de pasar a Free.
 * Es lo que prometen los Terminos (seccion de pagos): mantener sincronizado con ellos.
 */
export const PAST_DUE_GRACE_DAYS = 7;

/** Intervalo de facturacion de una suscripcion (mismos valores que Stripe: price.recurring.interval). */
export type BillingInterval = 'month' | 'year';
export const BILLING_INTERVALS: readonly BillingInterval[] = ['month', 'year'];

export const isBillingInterval = (value: unknown): value is BillingInterval => value === 'month' || value === 'year';

/** Meses que se pagan al contratar un ano: 10 (dos meses gratis). */
export const ANNUAL_MONTHS_CHARGED = 10;

export interface PlanPrice {
  /** Lo que se cobra cada mes con facturacion mensual. */
  monthly: number;
  /** Lo que se cobra una vez al ano con facturacion anual. */
  annual: number;
}

const priceOf = (monthly: number): PlanPrice => ({ monthly, annual: monthly * ANNUAL_MONTHS_CHARGED });

/** Precios anunciados en USD (sin impuestos). Free no tiene precio. */
export const PLAN_PRICE_USD: Record<Plan, PlanPrice> = {
  free: { monthly: 0, annual: 0 },
  starter: priceOf(5),
  pro: priceOf(29),
  team: priceOf(99),
};

/** Importe que se cobra en cada renovacion del intervalo dado. */
export const planPriceUsd = (plan: Plan, interval: BillingInterval): number =>
  interval === 'year' ? PLAN_PRICE_USD[plan].annual : PLAN_PRICE_USD[plan].monthly;

/** Lo que cuesta cada mes con facturacion anual (anual / 12), para mostrarlo junto al precio. */
export const annualMonthlyEquivalentUsd = (plan: Plan): number => PLAN_PRICE_USD[plan].annual / 12;

/** Ahorro de pagar un ano frente a doce meses, en % redondeado al entero mas cercano (0 si el plan no tiene precio). */
export const annualDiscountPercent = (plan: Plan): number => {
  const { monthly, annual } = PLAN_PRICE_USD[plan];
  return monthly > 0 ? Math.round((1 - annual / (monthly * 12)) * 100) : 0;
};

/** Descuento anual que se anuncia (igual para Starter, Pro y Team, porque todos son 10 meses). */
export const ANNUAL_DISCOUNT_PERCENT = annualDiscountPercent('pro');

/** Limites serializables a JSON: null = ilimitado (JSON no admite Infinity). */
export interface PlanLimitsDTO {
  maxActiveProjects: number | null;
  maxMonthlyRequests: number | null;
  maxMonthlyAiGenerations: number | null;
}

export const toLimitsDTO = (limits: PlanLimits): PlanLimitsDTO => ({
  maxActiveProjects: Number.isFinite(limits.maxActiveProjects) ? limits.maxActiveProjects : null,
  maxMonthlyRequests: Number.isFinite(limits.maxMonthlyRequests) ? limits.maxMonthlyRequests : null,
  maxMonthlyAiGenerations: Number.isFinite(limits.maxMonthlyAiGenerations) ? limits.maxMonthlyAiGenerations : null,
});

/** Respuesta de GET /api/billing/me */
export interface BillingOverview {
  /** Plan que se aplica ahora (un plan de pago impagado o cancelado cuenta como free). */
  plan: Plan;
  /** Plan contratado en Stripe, aunque no este activo. */
  subscribedPlan: Plan;
  billingStatus: BillingStatus;
  /** La suscripcion termina al final del periodo actual (cancelada desde el portal). */
  cancelAtPeriodEnd: boolean;
  /** Intervalo de facturacion de la suscripcion de pago viva (deducido del price de Stripe); null si no hay o no se conoce. */
  interval: BillingInterval | null;
  /** Fin del periodo de facturacion actual (ISO), si hay suscripcion. */
  currentPeriodEnd: string | null;
  /**
   * Fin del periodo de gracia (ISO) cuando billingStatus es past_due y se conoce el primer cobro fallido; null en el resto.
   * Hasta esa fecha `plan` sigue siendo el de pago; pasada, `plan` es free (y esta fecha queda como dato informativo).
   */
  pastDueUntil: string | null;
  limits: PlanLimitsDTO;
  usage: {
    activeProjects: number;
    monthlyRequests: number;
    /** Primer instante (ISO, UTC) del proximo mes: cuando se reinicia el contador de peticiones. */
    periodResetAt: string;
  };
  /** Hay cliente de Stripe y el portal esta disponible (gestionar pago, cambiar de plan, cancelar). */
  canManageBilling: boolean;
  /** Stripe configurado para contratar cada plan de pago con facturacion mensual. */
  checkoutAvailable: Record<PaidPlan, boolean>;
  /** Stripe configurado para contratar cada plan de pago con facturacion anual (falta el price *_YEARLY si es false). */
  yearlyCheckoutAvailable: Record<PaidPlan, boolean>;
}
