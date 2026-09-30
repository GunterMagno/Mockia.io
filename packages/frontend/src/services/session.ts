/**
 * Claves de sesion. Con "Recordarme" el token va a localStorage; sin el, a sessionStorage.
 * Cualquier lectura del token debe mirar ambos (antes el cliente HTTP solo miraba localStorage
 * y una sesion sin "Recordarme" recibia 401 en todas las llamadas).
 */
export const TOKEN_KEY = 'mockia_token'
export const USER_KEY = 'mockia_user'

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(TOKEN_KEY) || window.sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}
