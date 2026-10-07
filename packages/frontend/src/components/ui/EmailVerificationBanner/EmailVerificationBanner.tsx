import React, { useState } from 'react'
import { Button } from '../Button/Button'
import { useAuth } from '../../../contexts/AuthContext'
import { resendVerificationEmail } from '../../../services/authService'
import { getBackendErrorMessage } from '../../../utils/error'
import { useI18n } from '../../../i18n/I18nProvider'

import styles from './EmailVerificationBanner.module.scss'

const DISMISSED_KEY = 'mockia_verify_banner_dismissed'

const readDismissed = (): boolean => {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Aviso del panel para cuentas con el correo sin verificar: explica por que IA y facturacion estan bloqueadas
 * (cuando el servidor lo exige) y permite reenviar el enlace. Se puede descartar durante la sesion del navegador.
 */
export const EmailVerificationBanner: React.FC = () => {
  const { t, locale } = useI18n()
  const { user, markEmailVerified } = useAuth()
  const [dismissed, setDismissed] = useState(readDismissed)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!user || user.emailVerifiedAt || dismissed) return null

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // sin almacenamiento: el aviso solo se oculta hasta recargar
    }
    setDismissed(true)
  }

  const resend = async () => {
    setSending(true)
    setError(null)
    try {
      const alreadyVerified = await resendVerificationEmail(locale)
      if (alreadyVerified) markEmailVerified()
      else setSent(true)
    } catch (err: unknown) {
      setError(getBackendErrorMessage(err, t))
    } finally {
      setSending(false)
    }
  }

  return (
    <section className={styles.banner} aria-label={t('auth.verifyTitle')}>
      <p className={styles.text}>{t('auth.verifyBannerText')}</p>
      <div className={styles.actions}>
        <Button variant="secondary" size="sm" onClick={resend} isLoading={sending} disabled={sent}>
          {t('auth.verifyBannerResend')}
        </Button>
        <button type="button" className={styles.dismiss} onClick={dismiss}>
          {t('auth.verifyBannerDismiss')}
        </button>
      </div>
      {/* Siempre en el DOM para que el lector de pantalla anuncie el cambio de texto */}
      <p className={styles.status} role="status" aria-live="polite">
        {sent ? t('auth.verifyBannerSent') : ''}
      </p>
      {error && (
        <p className={`${styles.status} ${styles.statusError}`} role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

export default EmailVerificationBanner
