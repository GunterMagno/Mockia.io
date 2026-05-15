import React from 'react'
import './App.css'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import AuthProvider from './contexts/AuthContext'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import ProtectedRoute from './routes/ProtectedRoute'
import Index from './pages/Index'
import MockEditor from './pages/MockEditor'
import Header from './components/ui/Header/Header'
import Footer from './components/ui/Footer/Footer'
import Terms from './pages/Terms'
import Privacy from './pages/Privacy'

const AppShell: React.FC = () => {
  const location = useLocation();
  const path = location.pathname;
  
  const showFooter = path === '/' || path === '/terms' || path === '/privacy';

  return (
    <div className="appShell">
      <Header />
      <main className="mainContent">
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/editor/:id" element={<MockEditor />} />
          </Route>
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      </main>
      {showFooter && <Footer />}
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
