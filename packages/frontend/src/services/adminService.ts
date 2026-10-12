import { api } from './api';
import type { AdminMetrics, AdminMetricsDays } from '@mockia/shared';

export type { AdminMetrics, AdminMetricsDays };

type Envelope<T> = { data: T };

/** Si el usuario autenticado es el titular (lista ADMIN_EMAILS del servidor). Nunca revela quienes lo son. */
export const getAdminStatus = async (): Promise<boolean> => {
  const res = await api.get<Envelope<{ isAdmin: boolean }>>('/admin/me');
  return res.data.data.isAdmin === true;
};

/** Metricas agregadas de los ultimos `days` dias (solo el titular; para el resto la API contesta 403). */
export const getAdminMetrics = async (days: AdminMetricsDays): Promise<AdminMetrics> => {
  const res = await api.get<Envelope<AdminMetrics>>('/admin/metrics', { params: { days } });
  const data = res.data?.data;
  // Una respuesta 200 con otra forma (servidor antiguo, proxy) no debe tumbar la pantalla: se trata como un fallo
  if (
    !data?.users?.newPerDay ||
    !data.ai?.perDay ||
    !data.demo?.generationsPerDay ||
    !data.funnel
  ) {
    throw new Error('Unexpected metrics response');
  }
  return data;
};
