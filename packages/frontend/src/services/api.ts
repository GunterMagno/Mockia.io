import axios, { type InternalAxiosRequestConfig } from 'axios'
import {
  CSRF_HEADERS,
  SESSION_EXPIRED_EVENT,
  clearSession,
  getAccessToken,
  getSessionUserId,
  setAccessToken,
  setSessionUserId,
  type SessionUser,
} from './session'

const baseURL = import.meta.env.VITE_API_URL ?? '/api'

// Axios instance for frontend API calls. withCredentials: el navegador envia la cookie HttpOnly del refresh token
export const api = axios.create({ baseURL, withCredentials: true })

// Rutas de auth: no llevan Bearer ni disparan el refresh automatico (un 401 en login es "credenciales invalidas")
const AUTH_ROUTES = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout']
const isAuthRoute = (url: string) => AUTH_ROUTES.some((route) => url.includes(route))

// Attach Bearer token if available, but skip login/register requests
api.interceptors.request.use((config) => {
  const token = getAccessToken()
  const url = (config.url ?? '') as string
  const skip = url.includes('/auth/login') || url.includes('/auth/register')
  if (token && config.headers && !skip) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

/** Resultado de pedir una sesion nueva al backend con la cookie de refresh. */
export type RefreshOutcome =
  | { status: 'ok'; accessToken: string; user: SessionUser | null }
  /** El servidor dijo que no hay sesion valida (sin cookie, caducada, revocada o reutilizada). */
  | { status: 'rejected' }
  /** Fallo de red o 5xx: no se sabe si la sesion sigue viva, no se toca nada. */
  | { status: 'failed' }

/**
 * POST /auth/refresh con la cookie HttpOnly (y la cabecera anti-CSRF). Guarda el access token nuevo en memoria.
 * Usa axios sin la instancia `api` para no pasar por sus interceptores (ni adjuntar el Bearer caducado).
 */
async function requestRefresh(): Promise<RefreshOutcome> {
  try {
    const res = await axios.post(`${baseURL}/auth/refresh`, null, { withCredentials: true, headers: CSRF_HEADERS })
    const data = res.data?.data
    if (typeof data?.accessToken !== 'string') return { status: 'failed' }
    const user: SessionUser | null = data.user ?? null
    const currentId = getSessionUserId()
    // La cookie pertenece a OTRA cuenta (p. ej. plantada por un formulario de otro sitio): no se cambia de usuario
    // en silencio. Se cierra la sesion (y se pide al backend borrar esa cookie) y la app vuelve al login.
    if (currentId && user?.id && user.id !== currentId) {
      clearSession()
      axios.post(`${baseURL}/auth/logout`, null, { withCredentials: true, headers: CSRF_HEADERS }).catch(() => undefined)
      return { status: 'rejected' }
    }
    setAccessToken(data.accessToken)
    if (user?.id) setSessionUserId(user.id)
    return { status: 'ok', accessToken: data.accessToken, user }
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined
    if (status === 401 || status === 400 || status === 403) {
      clearSession()
      return { status: 'rejected' }
    }
    return { status: 'failed' }
  }
}

// Single-flight: las peticiones simultaneas (arranque, varios 401) comparten una unica llamada de refresh,
// porque el refresh token se rota en cada uso
let refreshInFlight: Promise<RefreshOutcome> | null = null
export function refreshSession(): Promise<RefreshOutcome> {
  if (!refreshInFlight) {
    refreshInFlight = requestRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

// Mensaje con el que el backend rechaza una contrasena incorrecta en DELETE /users/me (no es un 401 de sesion)
const WRONG_PASSWORD_MESSAGE = 'Incorrect password'

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean }

// Check for HTML responses (SPA fallback) when JSON is expected
api.interceptors.response.use(
  (response) => {
    const contentType = response.headers['content-type'] || ''
    if (
      contentType.includes('text/html') ||
      (typeof response.data === 'string' && response.data.trim().startsWith('<!DOCTYPE html>'))
    ) {
      return Promise.reject({
        message: 'Backend server is unreachable or misconfigured (received HTML instead of JSON).',
        code: 'ERR_SPA_FALLBACK',
        response,
      })
    }
    return response
  },
  async (error) => {
    const original = error?.config as RetriableConfig | undefined
    const status = error?.response?.status
    // Un 401 en una ruta protegida: renovar la sesion una vez y repetir la peticion original una sola vez
    if (status !== 401 || !original || original._retried || isAuthRoute(original.url ?? '')) {
      return Promise.reject(error)
    }
    // Contrasena incorrecta al borrar la cuenta: el 401 no es de sesion, renovar y repetir solo gastaria un intento mas
    if (error.response?.data?.error?.message === WRONG_PASSWORD_MESSAGE) return Promise.reject(error)
    original._retried = true
    // Otra peticion ya renovo la sesion mientras esta volaba con el token viejo: basta repetirla con el actual
    const sent = String(original.headers?.Authorization ?? '').replace(/^Bearer /, '')
    const current = getAccessToken()
    let accessToken: string | null = current && sent && current !== sent ? current : null
    if (!accessToken) {
      const outcome = await refreshSession()
      if (outcome.status === 'rejected') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
      accessToken = outcome.status === 'ok' ? outcome.accessToken : null
    }
    if (!accessToken) return Promise.reject(error)
    original.headers.Authorization = `Bearer ${accessToken}`
    return api(original)
  }
)

export default api
