import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Input } from '../../components/ui/Input/Input'
import { Button } from '../../components/ui/Button/Button'
import { api } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { getBackendErrorMessage } from '../../utils/error'
import { validateEmail, validatePassword, validateUsername } from '../../utils/validation'
import { playErrorSound } from '../../utils/audio'

import ModalErrorAlert from '../../components/ui/ModalErrorAlert/ModalErrorAlert'

import styles from './Auth.module.scss'

const Signup: React.FC = () => {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Frontend Validation
    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);
    const usernameError = validateUsername(username);
    
    if (emailError || passwordError || usernameError) {
      setError(emailError || passwordError || usernameError);
      playErrorSound();
      return;
    }

    setLoading(true)
    setError(null)
    try {
      // Call signup endpoint
      await api.post('/auth/register', { email, password, username })
      // Auto login
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
          <p>Sign Up</p>
        </header>
        
        <article className={styles.authCard}>
          <form onSubmit={onSubmit} className={styles.form}>
            <Input 
              label="Username" 
              name="username"
              autoComplete="username"
              placeholder="your_username"
              value={username} 
              onChange={(e) => setUsername(e.target.value)} 
              required
            />
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
              name="new-password"
              autoComplete="new-password"
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
              <ModalErrorAlert message={error} />
            )}
            
            <Button type="submit" isLoading={loading} className={styles.submitBtn}>
              Create Account
            </Button>
          </form>
          
          <footer className={styles.footer}>
            <span>
              <span>Already have an account? </span>
              <Link to="/login">
                Log in
              </Link>
            </span>
          </footer>
        </article>
      </section>
    </main>
  )
}

export default Signup
