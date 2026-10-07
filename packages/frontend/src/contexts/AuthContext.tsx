import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

/**
 * Lightweight User type interface matching the backend schema
 */
interface User {
  id: string
  email: string
  username: string
  createdAt?: string
  updatedAt?: string
}
import { api } from '../services/api'
import {
  TOKEN_KEY,
  REFRESH_KEY,
  USER_KEY,
  SESSION_EXPIRED_EVENT,
  clearStoredSession,
  getStoredRefreshToken,
} from '../services/session'

type Credentials = { email: string; password: string }

/**
 * Interface representing the globally managed authentication context state
 */
type AuthContextType = {
  /** Currently authenticated user details or null */
  user: User | null
  /** Session JWT access token */
  accessToken: string | null
  /**
   * Action to authenticate user credentials
   * @param credentials - email and password payload
   * @param rememberMe - determines if local or session storage should be used
   */
  login: (credentials: Credentials, rememberMe?: boolean) => Promise<void>
  /** Logs out user, clearing local and session states */
  logout: () => void
  /** Checks if the user session is active */
  isAuthenticated: boolean
  /** Represents startup verification loading state */
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)


/**
 * Global authentication state provider.
 * Intercepts, verifies and stores active JWT user sessions on application load.
 */
export const AuthProvider: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  // Solo hay carga si hay sesion guardada que verificar; sin token el home carga al instante
  const [isLoading, setIsLoading] = useState(
    () => !!(localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY))
  )

  // Initialize from storage and verify session
  useEffect(() => {
    const initAuth = async () => {
      // Check both storages
      let rawToken = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY)
      let rawUser = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY)

      if (rawToken) {
        setAccessToken(rawToken)
        try {
          const res = await api.get('/auth/me')
          const u = res?.data?.user ?? null
          if (u) {
            setUser(u)
            // Sync current storage
            const storage = localStorage.getItem(TOKEN_KEY) ? localStorage : sessionStorage
            storage.setItem(USER_KEY, JSON.stringify(u))
          } else {
            logout()
          }
        } catch (err) {
          console.error('Failed to verify session on startup:', err)
          logout()
        }
      } else if (rawUser) {
        localStorage.removeItem(USER_KEY)
        sessionStorage.removeItem(USER_KEY)
      }

      setIsLoading(false)
    }

    initAuth()
  }, [])

  // El cliente HTTP avisa cuando el refresh token ya no sirve (revocado, caducado o reutilizado)
  useEffect(() => {
    const onExpired = () => {
      setUser(null)
      setAccessToken(null)
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [])

  /**
   * Performs authentication request and handles session storage binding
   */
  const login = async (credentials: Credentials, rememberMe: boolean = false) => {
    const res = await api.post('/auth/login', credentials)
    const data = res?.data as any
    const tokenFromServer: string | null = data?.token ?? data?.accessToken ?? data?.jwt ?? data?.data?.accessToken ?? data?.data?.token ?? data?.data?.tokens?.accessToken ?? null
    const refreshFromServer: string | null = data?.data?.tokens?.refreshToken ?? null
    let userFromServer: User | null = data?.user ?? data?.userInfo ?? data?.data?.user ?? null

    if (!userFromServer && tokenFromServer) {
      try {
        const meRes = await api.get('/auth/me')
        userFromServer = meRes?.data?.user ?? null
      } catch (err) {
        console.error('Failed to fetch user info with new token:', err)
        userFromServer = null
      }
    }

    setUser(userFromServer)
    setAccessToken(tokenFromServer)

    const storage = rememberMe ? localStorage : sessionStorage
    
    // Clear other storage to avoid conflicts
    const otherStorage = rememberMe ? sessionStorage : localStorage
    otherStorage.removeItem(USER_KEY)
    otherStorage.removeItem(TOKEN_KEY)
    otherStorage.removeItem(REFRESH_KEY)

    try {
      storage.setItem(USER_KEY, JSON.stringify(userFromServer))
      storage.setItem(TOKEN_KEY, tokenFromServer ?? '')
      if (refreshFromServer) storage.setItem(REFRESH_KEY, refreshFromServer)
      else storage.removeItem(REFRESH_KEY)
    } catch (err) {
      console.warn('Could not save auth data to storage:', err)
    }
  }

  /**
   * Resets active session and destroys stored tokens.
   * Also revokes the refresh token on the server (best effort: the local session is cleared either way).
   */
  const logout = () => {
    const refreshToken = getStoredRefreshToken()
    if (refreshToken) {
      api.post('/auth/logout', { refreshToken }).catch(() => {})
    }
    setUser(null)
    setAccessToken(null)
    clearStoredSession()
  }

  const value = useMemo<AuthContextType>( () => ({
    user,
    accessToken,
    login,
    logout,
    isAuthenticated: !!user,
    isLoading,
  }), [user, accessToken, isLoading] )

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
