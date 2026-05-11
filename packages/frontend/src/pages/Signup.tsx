import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Input } from '../components/ui/Input/Input'
import { Button } from '../components/ui/Button/Button'
import { Card } from '../components/ui/Card/Card'
import { api } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { getBackendErrorMessage } from '../utils/error'

import styles from './Auth.module.scss'

const Signup: React.FC = () => {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      // Call signup endpoint
      await api.post('/auth/register', { email, password, username })
      // Auto login
      await login({ email, password })
      navigate('/dashboard')
    } catch (err: any) {
      setError(getBackendErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1>Mockia.io</h1>
          <p>Create your free account</p>
        </header>
        
        <Card title="Register">
          <form onSubmit={onSubmit} className={styles.form}>
            <Input 
              label="Username" 
              placeholder="your_username"
              value={username} 
              onChange={(e) => setUsername(e.target.value)} 
              required
            />
            <Input 
              label="Email Address" 
              type="email" 
              placeholder="you@email.com"
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              required
            />
            <Input 
              label="Password" 
              type="password" 
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
              Get Started
            </Button>
          </form>
          
          <div className={styles.footer}>
            <span>Already have an account? </span>
            <Link to="/login">
              Log in
            </Link>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default Signup
