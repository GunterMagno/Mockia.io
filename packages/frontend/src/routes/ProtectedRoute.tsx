import React from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { PATHS } from './paths'

/** Solo envuelve rutas que requieren cuenta. Guarda `from` para volver tras el login. */
export const ProtectedRoute: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return <p role="status" className="sessionLoading">Loading session...</p>

  return isAuthenticated ? <Outlet /> : <Navigate to={PATHS.login} replace state={{ from: location }} />
}

export default ProtectedRoute
