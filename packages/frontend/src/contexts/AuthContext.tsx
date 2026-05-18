import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
// Local lightweight User type (will be replaced by @mockia/shared in a proper build)
interface User {
  id: string
  email: string
  username: string
  createdAt?: string
  updatedAt?: string
}
import { api } from '../services/api'

type Credentials = { email: string; password: string }

type AuthContextType = {
  user: User | null
  accessToken: string | null
  login: (credentials: Credentials, rememberMe?: boolean) => Promise<void>
  logout: () => void
  isAuthenticated: boolean
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const TOKEN_KEY = 'mockia_token'
const USER_KEY = 'mockia_user'

import styles from './AuthContext.module.scss'

export const AuthProvider: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

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

  const login = async (credentials: Credentials, rememberMe: boolean = false) => {
    console.log('[AuthContext] login method called for:', credentials.email)
    try {
      const res = await api.post('/auth/login', credentials)
      const data = res?.data as any
      console.log('[AuthContext] POST /auth/login resolved successfully. Response keys:', Object.keys(res ?? {}), 'data keys:', Object.keys(data ?? {}))
      
      const tokenFromServer: string | null = data?.token ?? data?.accessToken ?? data?.jwt ?? data?.data?.accessToken ?? data?.data?.token ?? data?.data?.tokens?.accessToken ?? null
      let userFromServer: User | null = data?.user ?? data?.userInfo ?? data?.data?.user ?? null

      console.log('[AuthContext] Extracted tokens/user - Token present:', !!tokenFromServer, 'User:', JSON.stringify(userFromServer))

      if (!userFromServer && tokenFromServer) {
        try {
          console.log('[AuthContext] User data not in response, making /auth/me call...')
          const meRes = await api.get('/auth/me')
          userFromServer = meRes?.data?.user ?? null
          console.log('[AuthContext] /auth/me resolved, user:', JSON.stringify(userFromServer))
        } catch (err) {
          console.error('[AuthContext] Failed to fetch user info with new token:', err)
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

      try {
        console.log('[AuthContext] Saving to storage (rememberMe:', rememberMe, ')')
        storage.setItem(USER_KEY, JSON.stringify(userFromServer))
        storage.setItem(TOKEN_KEY, tokenFromServer ?? '')
        console.log('[AuthContext] LocalStorage token read check:', storage.getItem(TOKEN_KEY) ? 'Exists' : 'Empty')
      } catch (err) {
        console.warn('[AuthContext] Could not save auth data to storage:', err)
      }
    } catch (err: any) {
      console.error('[AuthContext] Axios error during /auth/login request:', err?.message || err, err?.response?.data || '(no response data)')
      throw err
    }
  }

  const logout = () => {
    setUser(null)
    setAccessToken(null)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(USER_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
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
      {isLoading ? (
        <section className={styles.loadingOverlay}>
          <article className={styles.loadingContent}>
            <h2>Loading session...</h2>
            <span className="loader"></span>
          </article>
        </section>
      ) : children}
    </AuthContext.Provider>
  )
}

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}

export default AuthProvider
