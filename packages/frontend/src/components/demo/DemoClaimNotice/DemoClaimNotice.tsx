import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useI18n } from '../../../i18n/I18nProvider'
import { PATHS } from '../../../routes/paths'
import { claimDemo } from '../../../services/demoClaimService'
import { clearPendingDemo, readPendingDemo } from '../../../services/demoPending'
import type { Project } from '../../../services/projectService'
import { planName } from '../../../utils/error'
import styles from './DemoClaimNotice.module.scss'

type State =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'verify' }
  | { kind: 'done'; title: string; slug: string }
  | { kind: 'planLimit'; plan: string | null; limit: number | null }
  | { kind: 'gone' }
  | { kind: 'rateLimit' }
  | { kind: 'error' }

/** Con el correo sin verificar se vuelve a probar al volver a la pestana, pero no mas de una vez cada tanto. */
const RETRY_AFTER_FOCUS_MS = 5_000

/**
 * Reclama la demo que el visitante decidio conservar antes de registrarse (su id esta en sessionStorage, ver
 * services/demoPending.ts). Vive en el panel, que es adonde llevan el registro, el inicio de sesion y el enlace de
 * verificacion. El servidor decide si hace falta el correo verificado: aqui solo se interpreta su respuesta.
 *   - hecho: el proyecto aparece en el panel y se borra el id pendiente;
 *   - correo sin verificar: se avisa y se reintenta al verificar o al volver a la pestana (el id sigue pendiente);
 *   - limite del plan: se explica con enlace a los planes y se puede reintentar (el id sigue pendiente, la demo tambien);
 *   - la demo ya no existe: se avisa y se borra el id.
 * No renderiza nada si no hay demo pendiente.
 */
const DemoClaimNotice: React.FC<{ onClaimed?: (project: Project) => void }> = ({ onClaimed }) => {
  const { t } = useI18n()
  const { user } = useAuth()
  const [state, setState] = useState<State>({ kind: 'idle' })
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const lastTry = useRef(0)
  const onClaimedRef = useRef(onClaimed)
  onClaimedRef.current = onClaimed

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const attempt = useCallback(async () => {
    const demoId = readPendingDemo()
    if (!demoId || inFlight.current) return
    inFlight.current = true
    lastTry.current = Date.now()
    setState({ kind: 'saving' })
    const outcome = await claimDemo(demoId)
    inFlight.current = false
    if (outcome.kind === 'done') {
      clearPendingDemo()
      onClaimedRef.current?.(outcome.project)
    } else if (outcome.kind === 'gone') {
      clearPendingDemo()
    }
    if (!mounted.current) return
    switch (outcome.kind) {
      case 'done':
        setState({ kind: 'done', title: outcome.project.title, slug: outcome.project.slug })
        break
      case 'planLimit':
        setState({ kind: 'planLimit', plan: outcome.plan, limit: outcome.limit })
        break
      default:
        setState({ kind: outcome.kind })
    }
  }, [])

  // Con sesion y una demo pendiente se intenta; si el correo se verifica mientras tanto (cambia el usuario) se vuelve a intentar
  const userId = user?.id
  const verifiedAt = user?.emailVerifiedAt
  useEffect(() => {
    if (userId && readPendingDemo()) void attempt()
  }, [userId, verifiedAt, attempt])

  // Esperando la verificacion: el enlace del correo suele abrirse en OTRA pestana, asi que al volver a esta se reintenta
  const waiting = state.kind === 'verify'
  useEffect(() => {
    if (!waiting) return undefined
    const retry = () => {
      if (document.visibilityState === 'hidden' || Date.now() - lastTry.current < RETRY_AFTER_FOCUS_MS) return
      void attempt()
    }
    window.addEventListener('focus', retry)
    document.addEventListener('visibilitychange', retry)
    return () => {
      window.removeEventListener('focus', retry)
      document.removeEventListener('visibilitychange', retry)
    }
  }, [waiting, attempt])

  if (state.kind === 'idle') return null

  const problem = state.kind === 'planLimit' || state.kind === 'gone' || state.kind === 'rateLimit' || state.kind === 'error'
  const tone = state.kind === 'done' ? styles.success : problem ? styles.problem : styles.info

  return (
    <div className={`${styles.notice} ${tone}`} role={problem ? 'alert' : 'status'} data-testid="demo-claim" data-state={state.kind}>
      {state.kind === 'saving' && <p className={styles.message}>{t('demo.claim.saving')}</p>}
      {state.kind === 'verify' && <p className={styles.message}>{t('demo.claim.waiting')}</p>}
      {state.kind === 'done' && (
        <>
          <p className={styles.message}>{t('demo.claim.done', { title: state.title })}</p>
          <Link className={styles.action} to={PATHS.editor(state.slug)}>
            {t('demo.claim.open')}
          </Link>
        </>
      )}
      {state.kind === 'planLimit' && (
        <>
          <p className={styles.message}>{t('demo.claim.planLimit', { plan: planName(state.plan, t), limit: state.limit ?? '' })}</p>
          <div className={styles.actions}>
            <Link className={styles.action} to={PATHS.billing}>
              {t('demo.claim.plans')}
            </Link>
            <button type="button" className={styles.action} onClick={() => void attempt()}>
              {t('demo.claim.retry')}
            </button>
          </div>
        </>
      )}
      {state.kind === 'gone' && (
        <>
          <p className={styles.message}>{t('demo.claim.gone')}</p>
          <Link className={styles.action} to={PATHS.demo}>
            {t('demo.claim.newDemo')}
          </Link>
        </>
      )}
      {(state.kind === 'rateLimit' || state.kind === 'error') && (
        <>
          <p className={styles.message}>{t(state.kind === 'rateLimit' ? 'demo.claim.rateLimit' : 'demo.claim.error')}</p>
          <button type="button" className={styles.action} onClick={() => void attempt()}>
            {t('demo.claim.retry')}
          </button>
        </>
      )}
    </div>
  )
}

export default DemoClaimNotice
