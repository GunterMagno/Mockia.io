import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Input } from '../../components/ui/Input/Input'
import { Button } from '../../components/ui/Button/Button'
import { useAuth } from '../../contexts/AuthContext'
import { getBackendErrorMessage } from '../../utils/error'
import { validatePassword } from '../../utils/validation'
import { playErrorSound } from '../../utils/audio'

import styles from './Auth.module.scss'

const Login: React.FC = () => {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Frontend Validation
    const passwordError = validatePassword(password);
    
    if (!email) {
      setError('Email or Username is required');
      playErrorSound();
      return;
    }

    if (passwordError) {
      setError(passwordError);
      playErrorSound();
      return;
    }

    setLoading(true)
    setError(null)
    try {
      await login({ email, password }, rememberMe)
      navigate('/dashboard')
    } catch (err: any) {
      setError(getBackendErrorMessage(err))
      playErrorSound()
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className={styles.wrapper}>
      <section className={styles.container}>
        <header className={styles.header}>
          <p>Login</p>
        </header>
        
        <article className={styles.authCard}>
          <form onSubmit={onSubmit} className={styles.form}>
            <Input 
              label="Email Address" 
              type="email" 
              name="email"
              autoComplete="email"
              placeholder="you@email.com"
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              required
            />
            <Input 
              label="Password" 
              type="password" 
              name="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              required
            />
            
            <fieldset className={styles.options}>
              <label className={styles.rememberMe}>
                <input 
                  type="checkbox" 
                  checked={rememberMe} 
                  onChange={(e) => setRememberMe(e.target.checked)} 
                />
                <span>Remember me</span>
              </label>
            </fieldset>
            
            {error && (
              <span className={styles.error}>
                {error}
              </span>
            )}
            
            <Button type="submit" isLoading={loading} className={styles.submitBtn}>
              Sign In
            </Button>
          </form>
          
          <footer className={styles.footer}>
            <span>
              <span>Don't have an account? </span>
              <Link to="/signup">
                Create an account
              </Link>
            </span>
            <Link to="Not Found" className={styles.forgotPassword}>
              Forgot password?
            </Link>
          </footer>
        </article>
      </section>
    </main>
  )
}

export default Login
