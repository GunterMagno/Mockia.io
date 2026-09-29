import React from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export const ProtectedRoute: React.FC = () => {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return <p role="status" className="sessionLoading">Loading session...</p>

  const isAuth = !!user
  return isAuth ? <Outlet /> : <Navigate to="/login" replace state={{ from: location.pathname }} />
}

export default ProtectedRoute
