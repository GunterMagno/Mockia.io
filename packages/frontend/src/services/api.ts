import axios, { type InternalAxiosRequestConfig } from 'axios'
import {
  SESSION_EXPIRED_EVENT,
  clearStoredSession,
  getStoredRefreshToken,
  getStoredToken,
  storeRotatedTokens,
} from './session'

const baseURL = import.meta.env.VITE_API_URL ?? '/api'

// Axios instance for frontend API calls
export const api = axios.create({ baseURL })

// Rutas de auth: no llevan Bearer ni disparan el refresh automatico (un 401 en login es "credenciales invalidas")
const AUTH_ROUTES = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout']
const isAuthRoute = (url: string) => AUTH_ROUTES.some((route) => url.includes(route))

// Attach Bearer token if available, but skip login/register requests
api.interceptors.request.use((config) => {
  const token = getStoredToken()
  const url = (config.url ?? '') as string
  const skip = url.includes('/auth/login') || url.includes('/auth/register')
  if (token && config.headers && !skip) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

/**
 * Renueva el par de tokens con el refresh token guardado. Devuelve el nuevo access token o null.
 * Usa axios sin la instancia `api` para no pasar por sus interceptores (ni adjuntar el Bearer caducado).
 * Solo cierra la sesion cuando el servidor rechaza el refresh (401/400): un fallo de red o un 5xx deja la sesion
 * intacta para que el usuario pueda reintentar.
 */
async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getStoredRefreshToken()
  if (!refreshToken) return null
  try {
    const res = await axios.post(`${baseURL}/auth/refresh`, { refreshToken })
    const tokens = res.data?.data
    if (typeof tokens?.accessToken !== 'string' || typeof tokens?.refreshToken !== 'string') return null
    storeRotatedTokens(tokens.accessToken, tokens.refreshToken)
    return tokens.accessToken
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined
    if (status === 401 || status === 400) {
      clearStoredSession()
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    }
    return null
  }
}

// Single-flight: los 401 simultaneos comparten una unica llamada de refresh (el refresh token se rota en cada uso)
let refreshInFlight: Promise<string | null> | null = null
function refreshOnce(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

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
    original._retried = true
    // Otra peticion ya renovo la sesion mientras esta volaba con el token viejo: basta repetirla con el actual
    const sent = String(original.headers?.Authorization ?? '').replace(/^Bearer /, '')
    const stored = getStoredToken()
    const accessToken = stored && sent && stored !== sent ? stored : await refreshOnce()
    if (!accessToken) return Promise.reject(error)
    original.headers.Authorization = `Bearer ${accessToken}`
    return api(original)
  }
)

export default api
