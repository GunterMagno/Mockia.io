import React, { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Input } from '../../components/ui/Input/Input'
import { Button } from '../../components/ui/Button/Button'
import ModalErrorAlert from '../../components/ui/ModalErrorAlert/ModalErrorAlert'
import { useAuth } from '../../contexts/AuthContext'
import { resetPassword } from '../../services/authService'
import { getBackendErrorMessage } from '../../utils/error'
import { validateNewPassword } from '../../utils/validation'
import { playErrorSound } from '../../utils/audio'
import { PATHS } from '../../routes/paths'
import { useI18n } from '../../i18n/I18nProvider'

import styles from './Auth.module.scss'

const ResetPassword: React.FC = () => {
  const { t } = useI18n()
  const { user, logout } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  // El token se guarda en estado y se quita de la URL: asi no queda en el historial ni viaja en un Referer
  const [token] = useState(() => searchParams.get('token') ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const noticeRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (searchParams.has('token')) setSearchParams({}, { replace: true })
    // solo al montar: el token ya esta en el estado
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (done) noticeRef.current?.focus()
  }, [done])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const passwordError = validateNewPassword(password)
    if (passwordError) {
      setError(t(passwordError))
      playErrorSound()
      return
    }
    if (password !== confirm) {
      setError(t('validation.passwordMismatch'))
      playErrorSound()
      return
    }

    setLoading(true)
    setError(null)
    try {
      await resetPassword(token, password)
      // El servidor ya cerro todas las sesiones: si este navegador tenia una abierta, se limpia tambien aqui
      if (user) void logout()
      setDone(true)
    } catch (err: any) {
      setError(getBackendErrorMessage(err, t))
      playErrorSound()
    } finally {
      setLoading(false)
    }
  }

  const invalidLinkActions = (
    <div className={styles.actions}>
      <Link to={PATHS.forgotPassword} className={styles.linkButton}>
        {t('auth.requestNewLink')}
      </Link>
    </div>
  )

  return (
    <main className={styles.wrapper}>
      <section className={styles.container}>
        <header className={styles.header}>
          <h1>{t('auth.resetTitle')}</h1>
        </header>

        <article className={styles.authCard}>
          {!token ? (
            <>
              <p role="alert" className={`${styles.notice} ${styles.noticeError}`}>
                {t('auth.resetMissingToken')}
              </p>
              {invalidLinkActions}
            </>
          ) : done ? (
            <>
              <p ref={noticeRef} tabIndex={-1} role="status" className={styles.notice}>
                {t('auth.resetDone')}
              </p>
              <div className={styles.actions}>
                <Link to={PATHS.login} className={styles.linkButton}>
                  {t('auth.signIn')}
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className={styles.intro}>{t('auth.resetIntro')}</p>
              <form onSubmit={onSubmit} className={styles.form} noValidate>
                <Input
                  label={t('auth.newPassword')}
                  type="password"
                  name="new-password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-describedby="reset-password-hint"
                  required
                  autoFocus
                />
                <p id="reset-password-hint" className={styles.hint}>
                  {t('auth.passwordHint')}
                </p>
                <Input
                  label={t('auth.confirmPassword')}
                  type="password"
                  name="confirm-password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />

                {error && <ModalErrorAlert message={error} />}

                <Button type="submit" isLoading={loading} className={styles.submitBtn}>
                  {t('auth.resetSubmit')}
                </Button>
              </form>

              <footer className={styles.footer}>
                <Link to={PATHS.forgotPassword}>{t('auth.requestNewLink')}</Link>
              </footer>
            </>
          )}
        </article>
      </section>
    </main>
  )
}

export default ResetPassword
