import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Input } from '../../components/ui/Input/Input'
import { Button } from '../../components/ui/Button/Button'
import ModalErrorAlert from '../../components/ui/ModalErrorAlert/ModalErrorAlert'
import { requestPasswordReset } from '../../services/authService'
import { getBackendErrorMessage } from '../../utils/error'
import { validateEmail } from '../../utils/validation'
import { playErrorSound } from '../../utils/audio'
import { PATHS } from '../../routes/paths'
import { useI18n } from '../../i18n/I18nProvider'

import styles from './Auth.module.scss'

const ForgotPassword: React.FC = () => {
  const { t, locale } = useI18n()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const noticeRef = useRef<HTMLParagraphElement>(null)

  // Al enviarse, el foco pasa al aviso: un lector de pantalla lo anuncia y el teclado no queda en un boton que ya no existe
  useEffect(() => {
    if (sent) noticeRef.current?.focus()
  }, [sent])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const emailError = validateEmail(email)
    if (emailError) {
      setError(t(emailError))
      playErrorSound()
      return
    }

    setLoading(true)
    setError(null)
    try {
      await requestPasswordReset(email.trim(), locale)
      setSent(true)
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
          <h1>{t('auth.forgotTitle')}</h1>
        </header>

        <article className={styles.authCard}>
          {sent ? (
            <>
              {/* Mismo mensaje exista o no la cuenta: el servidor responde igual */}
              <p ref={noticeRef} tabIndex={-1} role="status" className={styles.notice}>
                {t('auth.forgotSent')}
              </p>
              <div className={styles.actions}>
                <Link to={PATHS.login} className={styles.linkButton}>
                  {t('auth.backToLogin')}
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className={styles.intro}>{t('auth.forgotIntro')}</p>
              <form onSubmit={onSubmit} className={styles.form} noValidate>
                <Input
                  label={t('auth.email')}
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder={t('auth.emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />

                {error && <ModalErrorAlert message={error} />}

                <Button type="submit" isLoading={loading} className={styles.submitBtn}>
                  {t('auth.forgotSubmit')}
                </Button>
              </form>

              <footer className={styles.footer}>
                <Link to={PATHS.login}>{t('auth.backToLogin')}</Link>
              </footer>
            </>
          )}
        </article>
      </section>
    </main>
  )
}

export default ForgotPassword
