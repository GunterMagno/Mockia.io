import React, { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { verifyEmailToken } from '../../services/authService'
import { getBackendErrorMessage } from '../../utils/error'
import { PATHS } from '../../routes/paths'
import { useI18n } from '../../i18n/I18nProvider'

import styles from './Auth.module.scss'

type Status = 'working' | 'done' | 'failed' | 'missing'

/**
 * Destino del enlace del correo de verificacion (/verify-email?token=...). Funciona sin sesion: el token basta.
 * Si el usuario si tiene sesion abierta, se actualiza su estado para que el aviso del panel desaparezca.
 */
const VerifyEmail: React.FC = () => {
  const { t } = useI18n()
  const { user, isLoading, markEmailVerified } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [token] = useState(() => searchParams.get('token') ?? '')
  const [status, setStatus] = useState<Status>(token ? 'working' : 'missing')
  const [message, setMessage] = useState<string | null>(null)
  const started = useRef(false)
  const noticeRef = useRef<HTMLParagraphElement>(null)

  // Un token sirve una sola vez: el efecto doble de React StrictMode no debe consumirlo dos veces
  useEffect(() => {
    if (searchParams.has('token')) setSearchParams({}, { replace: true })
    if (!token || started.current) return
    started.current = true
    verifyEmailToken(token)
      .then(() => setStatus('done'))
      .catch((err: unknown) => {
        setMessage(getBackendErrorMessage(err, t))
        setStatus('failed')
      })
    // solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // La sesion se restaura en paralelo: cuando ambas cosas han terminado, el usuario pasa a verificado
  useEffect(() => {
    if (status === 'done' && !isLoading && user) markEmailVerified()
  }, [status, isLoading, user, markEmailVerified])

  // El resultado recibe el foco: el lector de pantalla lo anuncia y el teclado queda junto a las acciones
  useEffect(() => {
    if (status !== 'working') noticeRef.current?.focus()
  }, [status])

  return (
    <main className={styles.wrapper}>
      <section className={styles.container}>
        <header className={styles.header}>
          <h1>{t('auth.verifyTitle')}</h1>
        </header>

        <article className={styles.authCard} aria-busy={status === 'working'}>
          {status === 'working' && (
            <p role="status" className={styles.notice}>
              {t('auth.verifyWorking')}
            </p>
          )}

          {status === 'done' && (
            <>
              <p ref={noticeRef} tabIndex={-1} role="status" className={styles.notice}>
                {t('auth.verifyDone')}
              </p>
              <div className={styles.actions}>
                <Link to={user ? PATHS.dashboard : PATHS.login} className={styles.linkButton}>
                  {user ? t('auth.verifyContinue') : t('auth.signIn')}
                </Link>
              </div>
            </>
          )}

          {(status === 'failed' || status === 'missing') && (
            <>
              <p ref={noticeRef} tabIndex={-1} role="alert" className={`${styles.notice} ${styles.noticeError}`}>
                {status === 'missing' ? t('auth.verifyMissingToken') : message ?? t('auth.invalidLink')}
              </p>
              <div className={styles.actions}>
                {/* Con sesion, el panel permite reenviar el correo; sin ella hay que entrar primero */}
                <Link to={user ? PATHS.dashboard : PATHS.login} className={styles.linkButton}>
                  {user ? t('auth.verifyContinue') : t('auth.signIn')}
                </Link>
              </div>
            </>
          )}
        </article>
      </section>
    </main>
  )
}

export default VerifyEmail
