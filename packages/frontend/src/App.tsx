import React from 'react'
import './App.css'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import AuthProvider from './contexts/AuthContext'
import LocaleSync from './components/LocaleSync'
import Login from './pages/Auth/Login'
import Signup from './pages/Auth/Signup'
import ForgotPassword from './pages/Auth/ForgotPassword'
import ResetPassword from './pages/Auth/ResetPassword'
import VerifyEmail from './pages/Auth/VerifyEmail'
import Dashboard from './pages/Dashboard/Dashboard'
import Billing from './pages/Billing/Billing'
import ProtectedRoute from './routes/ProtectedRoute'
import Index from './pages/Landing/Index'
import MockEditor from './pages/MockEditor/MockEditor'
import Header from './components/ui/Header/Header'
import Footer from './components/ui/Footer/Footer'
import Terms from './pages/Legal/Terms'
import Privacy from './pages/Legal/Privacy'
import NotFound from './pages/NotFound/NotFound'
import AmbientBackground from './components/ui/AmbientBackground/AmbientBackground'
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
      <AmbientBackground />
      {showHeader && <Header />}
      <main className="mainContent">
        {/* key por ruta: cada cambio de seccion entra con el mismo fundido, sin corte seco */}
        <div className="routeFade" key={path}>
        <Routes>
          <Route path={PATHS.home} element={<Index />} />
          <Route path={PATHS.login} element={<Login />} />
          <Route path={PATHS.signup} element={<Signup />} />
          <Route path={PATHS.forgotPassword} element={<ForgotPassword />} />
          <Route path={PATHS.resetPassword} element={<ResetPassword />} />
          <Route path={PATHS.verifyEmail} element={<VerifyEmail />} />
          <Route path={PATHS.terms} element={<Terms />} />
          <Route path={PATHS.privacy} element={<Privacy />} />
          <Route element={<ProtectedRoute />}>
            <Route path={PATHS.dashboard} element={<Dashboard />} />
            <Route path={PATHS.billing} element={<Billing />} />
            <Route path={PATHS.editorPattern} element={<MockEditor />} />
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
      <LocaleSync />
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
