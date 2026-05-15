import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Input } from '../components/ui/Input/Input'
import { Button } from '../components/ui/Button/Button'
import { Card } from '../components/ui/Card/Card'
import { useAuth } from '../contexts/AuthContext'
import { getBackendErrorMessage } from '../utils/error'
import { validatePassword } from '../utils/validation'
import { playErrorSound } from '../utils/audio'

import styles from './Auth.module.scss'

const Login: React.FC = () => {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
      await login({ email, password })
      navigate('/dashboard')
    } catch (err: any) {
      setError(getBackendErrorMessage(err))
      playErrorSound()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1>Mockia.io</h1>
          <p>Welcome back</p>
        </header>
        
        <Card title="Login">
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
            
            {error && (
              <div className={styles.error}>
                {error}
              </div>
            )}
            
            <Button type="submit" isLoading={loading} className={styles.submitBtn}>
              Login
            </Button>
          </form>
          
          <div className={styles.footer}>
            <span>Don't have an account? </span>
            <Link to="/signup">
              Sign up for free
            </Link>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default Login
