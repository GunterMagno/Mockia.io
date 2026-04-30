import React from 'react'
import './App.css'
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import AuthProvider from './contexts/AuthContext'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import ProtectedRoute from './routes/ProtectedRoute'
import Index from './pages/Index'

const AppShell: React.FC = () => {
  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderBottom: '1px solid #e5e7eb',
    marginBottom: 12,
  }
  return (
    <div className="container">
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0 }}>🚀 Mockia.io</h1>
          <span style={{ color: '#6b7280' }}>/ Index</span>
        </div>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <button style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#0b5ed7', color: '#fff' }}>Index</button>
        </Link>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<Dashboard />} />
          </Route>
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      </main>
    </div>
  )
}

const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
