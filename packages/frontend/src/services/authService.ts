import { api, refreshSession } from './api'
import { CSRF_HEADERS, clearSession, setAccessToken, type SessionUser } from './session'

export interface Credentials {
  email: string
  password: string
}

export interface LoginResult {
  user: SessionUser
  accessToken: string
}

/**
 * Inicia sesion. El backend responde con el access token en el cuerpo y pone el refresh token en la cookie HttpOnly
 * `mockia_rt`; "recordarme" solo decide si esa cookie dura 7 dias o termina con el navegador.
 */
export async function loginRequest(credentials: Credentials, remember: boolean): Promise<LoginResult> {
  const res = await api.post('/auth/login', { ...credentials, remember })
  const data = res?.data?.data
  const accessToken: unknown = data?.tokens?.accessToken
  const user: SessionUser | undefined = data?.user
  if (typeof accessToken !== 'string' || !user) throw new Error('Unexpected login response')
  setAccessToken(accessToken)
  return { user, accessToken }
}

/**
 * Recupera la sesion al cargar la app: la cookie de refresh (si existe y sigue viva) da un access token nuevo
 * y el usuario. Devuelve null si no hay sesion.
 */
export async function restoreSession(): Promise<SessionUser | null> {
  const outcome = await refreshSession()
  return outcome.status === 'ok' ? outcome.user : null
}

/**
 * Cierra la sesion: olvida el access token y pide al backend revocar la sesion y borrar la cookie.
 * El token local se borra aunque la peticion falle.
 */
export async function logoutRequest(): Promise<void> {
  clearSession()
  try {
    await api.post('/auth/logout', null, { headers: CSRF_HEADERS })
  } catch {
    // Best effort: sin red la cookie caduca sola y el refresh token queda revocado al siguiente intento
  }
}
