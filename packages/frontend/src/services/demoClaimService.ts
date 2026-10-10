import axios from 'axios'
import { api } from './api'
import type { Project } from './projectService'

/**
 * Reclamar una demo: POST /demo/:demoId/claim con la sesion del usuario. Convierte el mock efimero en un proyecto de
 * su cuenta (no consume cuota de IA). El resultado se normaliza para que la interfaz decida el mensaje.
 */
export type ClaimOutcome =
  | { kind: 'done'; project: Project }
  /** 403 EMAIL_NOT_VERIFIED: el servidor exige el correo verificado; la demo sigue disponible. */
  | { kind: 'verify' }
  /** 402 PLAN_LIMIT_REACHED: la cuenta esta en su limite de proyectos; la demo sigue disponible. */
  | { kind: 'planLimit'; plan: string | null; limit: number | null }
  /** 404: vencio, no existe o ya se reclamo (el servidor no distingue). */
  | { kind: 'gone' }
  /** 429: demasiados intentos. */
  | { kind: 'rateLimit' }
  | { kind: 'error' }

export async function claimDemo(demoId: string): Promise<ClaimOutcome> {
  try {
    const res = await api.post<{ data: Project }>(`/demo/${encodeURIComponent(demoId)}/claim`)
    return { kind: 'done', project: res.data.data }
  } catch (err) {
    if (!axios.isAxiosError(err) || !err.response) return { kind: 'error' }
    const { status, data } = err.response
    const code = (data as { error?: { code?: string } } | undefined)?.error?.code
    const details = (data as { error?: { details?: { plan?: unknown; limit?: unknown } } } | undefined)?.error?.details
    if (status === 402 && code === 'PLAN_LIMIT_REACHED') {
      return {
        kind: 'planLimit',
        plan: typeof details?.plan === 'string' ? details.plan : null,
        limit: typeof details?.limit === 'number' ? details.limit : null,
      }
    }
    if (status === 403 && code === 'EMAIL_NOT_VERIFIED') return { kind: 'verify' }
    if (status === 404) return { kind: 'gone' }
    if (status === 429) return { kind: 'rateLimit' }
    return { kind: 'error' }
  }
}
