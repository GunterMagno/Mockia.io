/**
 * Catalogo de planes: fuente unica para backend (limites que se aplican) y frontend (lo que se anuncia).
 * Cambiar un precio aqui NO cambia lo que cobra Stripe: el importe real vive en los Price de Stripe
 * (STRIPE_PRICE_PRO / STRIPE_PRICE_TEAM). Mantener ambos alineados.
 */

export type Plan = 'free' | 'pro' | 'team';
export type PaidPlan = Exclude<Plan, 'free'>;
export type BillingStatus = 'active' | 'past_due' | 'canceled';

export interface PlanLimits {
  /** Proyectos no archivados que puede tener el propietario. Infinity = ilimitado. */
  maxActiveProjects: number;
  /** Peticiones a los mocks publicos por mes natural (UTC). Infinity = ilimitado. */
  maxMonthlyRequests: number;
}

export const PLANS: readonly Plan[] = ['free', 'pro', 'team'];

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { maxActiveProjects: 5, maxMonthlyRequests: 10_000 },
  pro: { maxActiveProjects: 50, maxMonthlyRequests: 1_000_000 },
  team: { maxActiveProjects: Infinity, maxMonthlyRequests: 10_000_000 },
};

/** Precio mensual anunciado en USD (sin impuestos). */
export const PLAN_PRICE_USD: Record<Plan, number> = {
  free: 0,
  pro: 29,
  team: 99,
};

/** Limites serializables a JSON: null = ilimitado (JSON no admite Infinity). */
export interface PlanLimitsDTO {
  maxActiveProjects: number | null;
  maxMonthlyRequests: number | null;
}

export const toLimitsDTO = (limits: PlanLimits): PlanLimitsDTO => ({
  maxActiveProjects: Number.isFinite(limits.maxActiveProjects) ? limits.maxActiveProjects : null,
  maxMonthlyRequests: Number.isFinite(limits.maxMonthlyRequests) ? limits.maxMonthlyRequests : null,
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
  /** Fin del periodo de facturacion actual (ISO), si hay suscripcion. */
  currentPeriodEnd: string | null;
  limits: PlanLimitsDTO;
  usage: {
    activeProjects: number;
    monthlyRequests: number;
    /** Primer instante (ISO, UTC) del proximo mes: cuando se reinicia el contador de peticiones. */
    periodResetAt: string;
  };
  /** Hay cliente de Stripe y el portal esta disponible (gestionar pago, cambiar de plan, cancelar). */
  canManageBilling: boolean;
  /** Stripe configurado para contratar cada plan de pago. */
  checkoutAvailable: Record<PaidPlan, boolean>;
}
