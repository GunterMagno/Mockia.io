import type { PaidPlan, Plan } from './billing.js';

/**
 * Metricas del titular (GET /api/admin/metrics). Solo agregados: ni correos, ni ids de usuario, ni IPs, ni contenido.
 * Los dias van como 'YYYY-MM-DD' en UTC y la ventana siempre trae los `days` dias completos (los vacios, con 0).
 */

/** Ventanas que acepta la API. */
export const ADMIN_METRICS_DAYS = [7, 30, 90] as const;
export type AdminMetricsDays = (typeof ADMIN_METRICS_DAYS)[number];
export const ADMIN_METRICS_DEFAULT_DAYS: AdminMetricsDays = 30;

export type AdminAiScope = 'users' | 'demo' | 'byok';

export interface AdminMetrics {
  generatedAt: string;
  days: number;
  users: {
    total: number;
    verified: number;
    /** Plan que se aplica hoy (un past_due fuera de gracia o un cancelado cuentan como free). */
    byPlan: Record<Plan, number>;
    newPerDay: { day: string; count: number }[];
  };
  /** Cohorte registrada dentro de la ventana. Cada paso incluye al siguiente solo si cumple tambien el anterior. */
  funnel: { registered: number; verified: number; withProject: number; withAiGeneration: number };
  /** Estimacion desde el catalogo de precios (cuentas con billingStatus activa); NO es facturacion. */
  billing: { paying: Record<PaidPlan, number>; mrrUsdEstimate: number };
  ai: {
    perDay: {
      day: string;
      calls: number;
      errors: number;
      byScope: Record<AdminAiScope, number>;
    }[];
    tokens: { input: number; output: number };
    errorRatio: number;
    /** null sin AI_PRICES_JSON valido. */
    estimatedCostUsd: number | null;
    /** "proveedor/modelo" vistos en la ventana sin precio en AI_PRICES_JSON (suman tokens, no coste). */
    unpriced: string[];
  };
  demo: { generationsPerDay: { day: string; count: number }[] };
}
