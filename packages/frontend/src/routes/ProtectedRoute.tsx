import React from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export const ProtectedRoute: React.FC = () => {
  const { user, isLoading } = useAuth()
  
  if (isLoading) return null // Or a full page loader

  const isAuth = !!user
  return isAuth ? <Outlet /> : <Navigate to="/login" replace />
}

export default ProtectedRoute
