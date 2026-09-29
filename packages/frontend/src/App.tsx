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
import { PATHS, isKnownPath, isProtectedPath } from './routes/paths'

const AppShell: React.FC = () => {
  const location = useLocation();
  const path = location.pathname;
  
  const isProtectedRoute = isProtectedPath(path);
  const is404 = !isKnownPath(path);

  const showHeader = true; 
  const showFooter = !isProtectedRoute && !is404;  

  return (
    <section className="appShell">
      {showHeader && <Header />}
      <main className="mainContent">
        <Routes>
          <Route path={PATHS.home} element={<Index />} />
          <Route path={PATHS.login} element={<Login />} />
          <Route path={PATHS.signup} element={<Signup />} />
          <Route path={PATHS.terms} element={<Terms />} />
          <Route path={PATHS.privacy} element={<Privacy />} />
          <Route element={<ProtectedRoute />}>
            <Route path={PATHS.dashboard} element={<Dashboard />} />
            <Route path={PATHS.editorPattern} element={<MockEditor />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
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
