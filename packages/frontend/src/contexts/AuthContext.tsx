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
  login: (credentials: Credentials) => Promise<void>
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

  // Initialize from localStorage and verify session
  useEffect(() => {
    const initAuth = async () => {
      const rawUser = localStorage.getItem(USER_KEY)
      const rawToken = localStorage.getItem(TOKEN_KEY)

      if (rawToken) {
        setAccessToken(rawToken)
        // If we have a token, we MUST verify it before finishing loading
        try {
          const res = await api.get('/auth/me')
          const u = res?.data?.user ?? null
          if (u) {
            setUser(u)
            localStorage.setItem(USER_KEY, JSON.stringify(u))
          } else {
            logout()
          }
        } catch (err) {
          console.error('Failed to verify session on startup:', err)
          logout()
        }
      } else if (rawUser) {
        // No token but user in storage? This is inconsistent state, clear it
        localStorage.removeItem(USER_KEY)
      }

      setIsLoading(false)
    }

    initAuth()
  }, [])

  const login = async (credentials: Credentials) => {
    // Call backend login via API client
    const res = await api.post('/auth/login', credentials)
    const data = res?.data as any
    // Support multiple possible payload shapes from backend
    const tokenFromServer: string | null = data?.token ?? data?.accessToken ?? data?.jwt ?? data?.data?.accessToken ?? data?.data?.token ?? data?.data?.tokens?.accessToken ?? null
    let userFromServer: User | null = data?.user ?? data?.userInfo ?? data?.data?.user ?? null

    // If backend did not return user, try to fetch current user using the token
    if (!userFromServer && tokenFromServer) {
      try {
        const meRes = await api.get('/auth/me')
        userFromServer = meRes?.data?.user ?? null
      } catch (err) {
        console.error('Failed to fetch user info with new token:', err)
        userFromServer = null
      }
    }

    // Persist
    setUser(userFromServer)
    setAccessToken(tokenFromServer)
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(userFromServer))
    } catch (err) {
      console.warn('Could not save user to localStorage (quota exceeded?):', err)
    }
    try {
      localStorage.setItem(TOKEN_KEY, tokenFromServer ?? '')
    } catch (err) {
      console.warn('Could not save token to localStorage (quota exceeded?):', err)
    }
  }

  const logout = () => {
    setUser(null)
    setAccessToken(null)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(TOKEN_KEY)
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
        <div className={styles.loadingOverlay}>
          <div className={styles.loadingContent}>
            <h2>Loading session...</h2>
            <div className="loader"></div>
          </div>
        </div>
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
