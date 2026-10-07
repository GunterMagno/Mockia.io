/**
 * Claves de sesion. Con "Recordarme" los tokens van a localStorage; sin el, a sessionStorage.
 * Cualquier lectura del token debe mirar ambos (antes el cliente HTTP solo miraba localStorage
 * y una sesion sin "Recordarme" recibia 401 en todas las llamadas).
 *
 * El access token dura 15 min: el refresh token (rotado en cada uso) se guarda junto a el para que el cliente
 * HTTP renueve la sesion al recibir un 401. Transitorio: la tarea de cookies HttpOnly lo saca del almacenamiento web.
 */
export const TOKEN_KEY = 'mockia_token'
export const REFRESH_KEY = 'mockia_refresh'
export const USER_KEY = 'mockia_user'

/** Evento que emite el cliente HTTP cuando la sesion ya no se puede renovar (refresh revocado o caducado). */
export const SESSION_EXPIRED_EVENT = 'mockia:session-expired'

function read(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key) || window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

export function getStoredToken(): string | null {
  return read(TOKEN_KEY)
}

export function getStoredRefreshToken(): string | null {
  return read(REFRESH_KEY)
}

/**
 * Guarda un par de tokens recien rotado en el mismo almacenamiento donde ya vive la sesion
 * (localStorage si el usuario marco "Recordarme", si no sessionStorage).
 */
export function storeRotatedTokens(accessToken: string, refreshToken: string): void {
  if (typeof window === 'undefined') return
  try {
    const storage = window.localStorage.getItem(TOKEN_KEY) ? window.localStorage : window.sessionStorage
    storage.setItem(TOKEN_KEY, accessToken)
    storage.setItem(REFRESH_KEY, refreshToken)
  } catch {
    // Sin almacenamiento disponible no hay sesion persistente que actualizar
  }
}

/** Borra la sesion guardada (usuario y tokens) de ambos almacenamientos. */
export function clearStoredSession(): void {
  if (typeof window === 'undefined') return
  try {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      storage.removeItem(TOKEN_KEY)
      storage.removeItem(REFRESH_KEY)
      storage.removeItem(USER_KEY)
    }
  } catch {
    // ignorar: nada que limpiar si el almacenamiento no esta disponible
  }
}
