import React from 'react'
import './App.css'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import AuthProvider from './contexts/AuthContext'
import Login from './pages/Auth/Login'
import Signup from './pages/Auth/Signup'
import Dashboard from './pages/Dashboard/Dashboard'
import ProtectedRoute from './routes/ProtectedRoute'
import Index from './pages/Landing/Index'
import MockEditor from './pages/MockEditor/MockEditor'
import Header from './components/ui/Header/Header'
import Footer from './components/ui/Footer/Footer'
import Terms from './pages/Legal/Terms'
import Privacy from './pages/Legal/Privacy'
import NotFound from './pages/NotFound/NotFound'
import AmbientBackground from './components/ui/AmbientBackground/AmbientBackground'

const AppShell: React.FC = () => {
  const location = useLocation();
  const path = location.pathname;
  
  const validPaths = ['/', '/login', '/signup', '/terms', '/privacy', '/dashboard'];
  const isProtectedRoute = path === '/dashboard' || path.startsWith('/editor/');
  const is404 = !validPaths.includes(path) && !path.startsWith('/editor/');

  const showHeader = true; 
  const showFooter = !isProtectedRoute && !is404;  

  return (
    <section className="appShell">
      <AmbientBackground />
      {showHeader && <Header />}
      <main className="mainContent">
        {/* key por ruta: cada cambio de seccion entra con el mismo fundido, sin corte seco */}
        <div className="routeFade" key={path}>
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
          <Route path="*" element={<NotFound />} />
        </Routes>
        </div>
      </main>
      {showFooter && <Footer />}
    </section>
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
