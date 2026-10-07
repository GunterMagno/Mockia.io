import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { SESSION_EXPIRED_EVENT, purgeLegacyStorage, type SessionUser } from '../services/session'
import { loginRequest, logoutRequest, restoreSession, type Credentials } from '../services/authService'

type User = SessionUser

/**
 * Interface representing the globally managed authentication context state.
 * The access token is not exposed: it lives in memory inside services/session.ts and the HTTP client attaches it.
 */
type AuthContextType = {
  /** Currently authenticated user details or null */
  user: User | null
  /**
   * Action to authenticate user credentials
   * @param credentials - email and password payload
   * @param rememberMe - the session cookie lasts 7 days instead of ending with the browser session
   */
  login: (credentials: Credentials, rememberMe?: boolean) => Promise<void>
  /** Logs out: the local session is cleared at once; the promise resolves when the server revoked it (best effort) */
  logout: () => Promise<void>
  /** Checks if the user session is active */
  isAuthenticated: boolean
  /** True while the session is being restored from the refresh cookie at startup */
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)


/**
 * Global authentication state provider.
 * On load it restores the session through POST /auth/refresh (the HttpOnly cookie is the only thing that survives a reload).
 */
export const AuthProvider: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  // Always starts loading: whether a session exists is only known after the refresh call answers
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Tokens and user left by older versions in web storage are never used again
    purgeLegacyStorage()
    restoreSession()
      .then((restored) => setUser(restored))
      .finally(() => setIsLoading(false))
  }, [])

  // El cliente HTTP avisa cuando la cookie de refresh ya no sirve (revocada, caducada o reutilizada)
  useEffect(() => {
    const onExpired = () => setUser(null)
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [])

  /** Authenticates: the access token stays in memory, the refresh token arrives in the HttpOnly cookie. */
  const login = async (credentials: Credentials, rememberMe: boolean = false) => {
    const { user: loggedIn } = await loginRequest(credentials, rememberMe)
    setUser(loggedIn)
  }

  /** Resets the active session and asks the server to revoke it and clear the cookie. */
  const logout = () => {
    setUser(null)
    return logoutRequest()
  }

  const value = useMemo<AuthContextType>( () => ({
    user,
    login,
    logout,
    isAuthenticated: !!user,
    isLoading,
  }), [user, isLoading] )

  return (
    <AuthContext.Provider value={value}>
      {/* No bloquea el arbol: el home publico se ve al instante; ProtectedRoute espera a isLoading */}
      {children}
    </AuthContext.Provider>
  )
}

/**
 * Hook to consume the global authentication context
 * @returns {AuthContextType} Authentication state and controls
 */
export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}

export default AuthProvider
