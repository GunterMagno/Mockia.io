import React from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export const ProtectedRoute: React.FC = () => {
  const { user, accessToken } = useAuth()
  const isAuth = !!user || !!accessToken
  return isAuth ? <Outlet /> : <Navigate to="/login" replace />
}

export default ProtectedRoute
