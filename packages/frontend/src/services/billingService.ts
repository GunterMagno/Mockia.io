import { api } from './api'
import type { BillingInterval, BillingOverview, PaidPlan } from '@mockia/shared'

export type { BillingInterval, BillingOverview, PaidPlan }

type Envelope<T> = { data: T }

/** Plan, limites y uso del mes del usuario actual. */
export const getBillingOverview = async (): Promise<BillingOverview> => {
  const res = await api.get<Envelope<BillingOverview>>('/billing/me')
  return res.data.data
}

/** Crea una sesion de Stripe Checkout y devuelve la URL a la que redirigir. */
export const startCheckout = async (plan: PaidPlan, interval: BillingInterval = 'month'): Promise<string> => {
  const res = await api.post<Envelope<{ id: string; url: string }>>('/billing/checkout', { plan, interval })
  return res.data.data.url
}

/** Abre el portal de cliente de Stripe (tarjeta, facturas, cambio de plan, cancelacion). */
export const openBillingPortal = async (): Promise<string> => {
  const res = await api.post<Envelope<{ url: string }>>('/billing/portal')
  return res.data.data.url
}
