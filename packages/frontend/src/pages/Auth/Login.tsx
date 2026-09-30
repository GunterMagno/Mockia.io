import React, { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { Input } from '../../components/ui/Input/Input'
import { Button } from '../../components/ui/Button/Button'
import { useAuth } from '../../contexts/AuthContext'
import { getBackendErrorMessage } from '../../utils/error'
import { validatePassword } from '../../utils/validation'
import { playErrorSound } from '../../utils/audio'
import { PATHS, postLoginTarget } from '../../routes/paths'
import { useI18n } from '../../i18n/I18nProvider'

import ModalErrorAlert from '../../components/ui/ModalErrorAlert/ModalErrorAlert'

import styles from './Auth.module.scss'

const Login: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()
  const { t } = useI18n()
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
      setError(t('validation.emailOrUsernameRequired'));
      playErrorSound();
      return;
    }

    if (passwordError) {
      setError(t(passwordError));
      playErrorSound();
      return;
    }

    setLoading(true)
    setError(null)
    try {
      await login({ email, password }, rememberMe)
      navigate(postLoginTarget(location.state), { replace: true })
    } catch (err: any) {
      setError(getBackendErrorMessage(err, t))
      playErrorSound()
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className={styles.wrapper}>
      <section className={styles.container}>
        <header className={styles.header}>
          <h1>{t('auth.loginTitle')}</h1>
        </header>
        
        <article className={styles.authCard}>
          <form onSubmit={onSubmit} className={styles.form}>
            <Input 
              label={t('auth.email')}
              type="email" 
              name="email"
              autoComplete="email"
              placeholder={t('auth.emailPlaceholder')}
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              required
            />
            <Input 
              label={t('auth.password')}
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
                <span>{t('auth.rememberMe')}</span>
              </label>
            </fieldset>
            
            {error && (
              <ModalErrorAlert message={error} />
            )}
            
            <Button type="submit" isLoading={loading} className={styles.submitBtn}>
              {t('auth.signIn')}
            </Button>
          </form>
          
          <footer className={styles.footer}>
            <span>
              <span>{t('auth.noAccount')} </span>
              <Link to={PATHS.signup}>
                {t('auth.createOne')}
              </Link>
            </span>
          </footer>
        </article>
      </section>
    </main>
  )
}

export default Login
