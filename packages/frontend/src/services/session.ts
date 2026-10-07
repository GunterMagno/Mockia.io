/**
 * Estado de sesion del cliente.
 *
 * El access token (15 min) vive SOLO en una variable de este modulo: no se guarda en localStorage ni en
 * sessionStorage, asi un XSS no puede leerlo del almacenamiento web. El refresh token ni siquiera pasa por JavaScript:
 * viaja en la cookie HttpOnly `mockia_rt` que pone el backend. Al cargar la app se recupera la sesion con
 * POST /auth/refresh (ver authService.restoreSession).
 */

/** Usuario de la sesion tal como lo devuelve el backend. */
export interface SessionUser {
  id: string
  email: string
  username: string
  /** ISO date de la verificacion del correo; ausente o null = sin verificar. */
  emailVerifiedAt?: string | null
  createdAt?: string
  updatedAt?: string
}

/** Evento que emite el cliente HTTP cuando la sesion ya no se puede renovar (cookie revocada, caducada o ausente). */
export const SESSION_EXPIRED_EVENT = 'mockia:session-expired'

/** Cabecera anti-CSRF que exigen /auth/refresh y /auth/logout (el backend rechaza con 403 cualquier otro valor). */
export const CSRF_HEADERS = { 'X-Requested-With': 'mockia' } as const

let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function clearSession(): void {
  accessToken = null
}

/** Claves que usaban las versiones anteriores para guardar la sesion en el almacenamiento web. */
const LEGACY_KEYS = ['mockia_token', 'mockia_refresh', 'mockia_user'] as const

/**
 * Migracion de una sola vez: borra de localStorage y sessionStorage los tokens y el usuario que guardaban versiones
 * anteriores (no se reutilizan: el refresh token antiguo ya no se acepta y el nuevo vive en una cookie HttpOnly).
 */
export function purgeLegacyStorage(): void {
  if (typeof window === 'undefined') return
  for (const storage of ['localStorage', 'sessionStorage'] as const) {
    try {
      for (const key of LEGACY_KEYS) window[storage].removeItem(key)
    } catch {
      // almacenamiento no disponible: no hay nada que borrar
    }
  }
}
