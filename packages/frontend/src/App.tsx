import React from 'react'
import './App.css'
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import AuthProvider from './contexts/AuthContext'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import ProtectedRoute from './routes/ProtectedRoute'
import Index from './pages/Index'
import MockEditor from './pages/MockEditor'

const AppShell: React.FC = () => {
  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 'var(--spacing-2) var(--spacing-3)',
    borderBottom: '1px solid var(--border)',
    marginBottom: 'var(--spacing-3)',
  }
  return (
    <div className="container">
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
          <h1 style={{ margin: 0 }}>🚀 Mockia.io</h1>
        <span style={{ color: 'var(--muted)' }}>/ Index</span>
        </div>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <button style={{ padding: 'var(--spacing-2) var(--spacing-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-primary)', background: 'var(--color-primary)', color: 'var(--color-white)' }}>Index</button>
        </Link>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/editor/:id" element={<MockEditor />} />
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
