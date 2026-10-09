import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { isBillingInterval, type BillingInterval, type BillingOverview, type PaidPlan, type Plan } from '@mockia/shared'
import Layout from '../../layouts/Layout'
import PricingPlans, { hasOpenSubscription } from '../../components/billing/PricingPlans/PricingPlans'
import PastDueBanner from '../../components/billing/PastDueBanner/PastDueBanner'
import ModalErrorAlert from '../../components/ui/ModalErrorAlert/ModalErrorAlert'
import { getBillingOverview, openBillingPortal, startCheckout } from '../../services/billingService'
import { getBackendErrorMessage } from '../../utils/error'
import { useI18n } from '../../i18n/I18nProvider'
import styles from './Billing.module.scss'

const POLL_MS = 2000
const POLL_TRIES = 15

type Activation = 'waiting' | 'done' | 'timeout' | null
type Busy = Plan | 'portal' | null

const asPaidPlan = (v: string | null): PaidPlan | null => (v === 'pro' || v === 'team' ? v : null)

/** Barra de uso accesible: el valor va en aria-valuenow/valuetext, el color no es la unica pista (texto al lado). */
const UsageMeter: React.FC<{ label: string; used: number; limit: number | null; format: (n: number) => string }> = ({
  label,
  used,
  limit,
  format,
}) => {
  const { t } = useI18n()
  const ratio = limit ? Math.min(used / limit, 1) : 0
  const level = limit === null ? 'ok' : used >= limit ? 'full' : ratio >= 0.8 ? 'warn' : 'ok'
  const text = limit === null ? `${format(used)} · ${t('billing.unlimited')}` : t('billing.usageOf', { used: format(used), limit: format(limit) })
  return (
    <div className={styles.meter}>
      <div className={styles.meterHead}>
        <span className={styles.meterLabel}>{label}</span>
        <span className={styles.meterValue}>{text}</span>
      </div>
      <div
        className={`${styles.track} ${styles[level]}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit ?? undefined}
        aria-valuenow={used}
        aria-valuetext={text}
      >
        <span className={styles.fill} style={{ width: `${limit === null ? 100 : ratio * 100}%` }} />
      </div>
    </div>
  )
}

const Billing: React.FC = () => {
  const { t, formatDate, formatNumber } = useI18n()
  const [params] = useSearchParams()
  const checkout = params.get('checkout')
  const upgrade = asPaidPlan(params.get('upgrade'))
  const intervalParam = params.get('interval')
  // Intervalo elegido en la landing antes de registrarse
  const upgradeInterval = isBillingInterval(intervalParam) ? intervalParam : null

  const [overview, setOverview] = useState<BillingOverview | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [actionError, setActionError] = useState('')
  const [activation, setActivation] = useState<Activation>(checkout === 'success' ? 'waiting' : null)
  const plansRef = useRef<HTMLElement>(null)

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      const data = await getBillingOverview()
      setOverview(data)
      return data
    } catch {
      setLoadError(true)
      return null
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Vuelta de Stripe: el webhook puede tardar unos segundos en activar el plan.
  // Sondeo encadenado (no depende de `overview`, asi cada respuesta no reinicia el contador).
  useEffect(() => {
    if (activation !== 'waiting') return
    let tries = 0
    let stopped = false
    let timer = 0
    const tick = async () => {
      const data = await load()
      if (stopped) return
      if (data && data.plan !== 'free') return setActivation('done')
      tries += 1
      if (tries >= POLL_TRIES) return setActivation('timeout')
      timer = window.setTimeout(tick, POLL_MS)
    }
    timer = window.setTimeout(tick, POLL_MS)
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [activation, load])

  // Si la primera carga ya trae el plan activo, no hace falta esperar al sondeo
  useEffect(() => {
    if (activation === 'waiting' && overview && overview.plan !== 'free') setActivation('done')
  }, [activation, overview])

  // Plan elegido en la landing antes de registrarse: llevar la vista a los planes
  useEffect(() => {
    if (upgrade && overview) plansRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [upgrade, overview])

  const goCheckout = async (plan: PaidPlan, interval: BillingInterval) => {
    setBusy(plan)
    setActionError('')
    try {
      window.location.assign(await startCheckout(plan, interval))
    } catch (err) {
      setActionError(getBackendErrorMessage(err, t))
      setBusy(null)
    }
  }

  const goPortal = async (from: Busy = 'portal') => {
    setBusy(from)
    setActionError('')
    try {
      window.location.assign(await openBillingPortal())
    } catch (err) {
      setActionError(getBackendErrorMessage(err, t))
      setBusy(null)
    }
  }

  const planName = (plan: Plan) => t(`pricing.plans.${plan}.name`)
  // Tras cancelar, el usuario esta en Free y Free esta activo: "Cancelado" junto a Free confundia
  const shownStatus = overview?.billingStatus === 'canceled' ? 'active' : overview?.billingStatus ?? 'active'
  // UTC: the counter restarts at 00:00 UTC on the 1st and Stripe periods end at UTC instants (same as the emails)
  const date = (iso: string) => formatDate(iso, { dateStyle: 'long', timeZone: 'UTC' })
  const count = (n: number) => formatNumber(n)

  return (
    <Layout>
      <header className={styles.pageHead}>
        <h1>{t('billing.title')}</h1>
        <p>{t('billing.subtitle')}</p>
      </header>

      {activation && (
        <p className={`${styles.notice} ${activation === 'done' ? styles.success : ''}`} role="status">
          {activation === 'waiting' && t('billing.checkout.success')}
          {activation === 'done' && overview && t('billing.checkout.activated', { plan: planName(overview.plan) })}
          {activation === 'timeout' && t('billing.checkout.pending')}
        </p>
      )}
      {checkout === 'cancel' && (
        <p className={styles.notice} role="status">
          {t('billing.checkout.cancel')}
        </p>
      )}

      {!overview && !loadError && (
        <p className={styles.loading} role="status">
          {t('billing.loading')}
        </p>
      )}

      {loadError && !overview && (
        <div className={styles.loadError}>
          <ModalErrorAlert message={t('billing.loadFailed')} />
          <button type="button" className={styles.secondaryBtn} onClick={() => void load()}>
            {t('billing.retry')}
          </button>
        </div>
      )}

      {overview && (
        <>
          <PastDueBanner overview={overview} />
          {overview.cancelAtPeriodEnd && overview.currentPeriodEnd && overview.billingStatus === 'active' && (
            <p className={`${styles.notice} ${styles.warn}`} role="status">
              {t('billing.cancelScheduled', { plan: planName(overview.subscribedPlan), date: date(overview.currentPeriodEnd) })}
            </p>
          )}

          <section className={styles.summary} aria-label={t('billing.currentPlan')}>
            <article className={styles.planPanel}>
              <p className={styles.eyebrow}>{t('billing.currentPlan')}</p>
              <div className={styles.planLine}>
                <h2>{planName(overview.plan)}</h2>
                <span className={`${styles.status} ${styles[shownStatus]}`}>{t(`billing.status.${shownStatus}`)}</span>
              </div>
              {overview.interval && overview.subscribedPlan !== 'free' && overview.billingStatus !== 'canceled' && (
                <p className={styles.muted} data-testid="billing-interval">
                  {overview.interval === 'year' ? t('pricing.billedYearlyShort') : t('pricing.billedMonthly')}
                </p>
              )}
              {overview.subscribedPlan !== 'free' && overview.currentPeriodEnd && overview.billingStatus === 'active' && (
                <p className={styles.muted}>
                  {overview.cancelAtPeriodEnd
                    ? t('billing.endsOn', { date: date(overview.currentPeriodEnd) })
                    : t('billing.renews', { date: date(overview.currentPeriodEnd) })}
                </p>
              )}
              {overview.canManageBilling && (
                <button type="button" className={styles.secondaryBtn} onClick={() => void goPortal()} disabled={busy !== null}>
                  {busy === 'portal' ? t('billing.opening') : t('billing.manage')}
                </button>
              )}
              {!overview.canManageBilling && !overview.checkoutAvailable.pro && !overview.checkoutAvailable.team && (
                <p className={styles.muted}>{t('billing.paymentsOff')}</p>
              )}
            </article>

            <article className={styles.usagePanel}>
              <h2 className={styles.panelTitle}>{t('billing.usageTitle')}</h2>
              <UsageMeter
                label={t('billing.projectsLabel')}
                used={overview.usage.activeProjects}
                limit={overview.limits.maxActiveProjects}
                format={count}
              />
              <UsageMeter
                label={t('billing.requestsLabel')}
                used={overview.usage.monthlyRequests}
                limit={overview.limits.maxMonthlyRequests}
                format={count}
              />
              <p className={styles.muted}>{t('billing.resetsOn', { date: date(overview.usage.periodResetAt) })}</p>
              {overview.limits.maxActiveProjects !== null && overview.usage.activeProjects > overview.limits.maxActiveProjects && (
                <p className={`${styles.notice} ${styles.warn}`}>{t('billing.overLimit')}</p>
              )}
            </article>
          </section>

          <ModalErrorAlert message={actionError} />

          <section className={styles.plans} ref={plansRef} aria-labelledby="billing-plans-title">
            <h2 id="billing-plans-title" className={styles.panelTitle}>
              {t('billing.plansTitle')}
            </h2>
            <PricingPlans
              mode="app"
              overview={overview}
              highlight={upgrade && !hasOpenSubscription(overview) && overview.plan !== upgrade ? upgrade : null}
              initialInterval={upgradeInterval}
              busy={busy}
              onCheckout={(plan, interval) => void goCheckout(plan, interval)}
              onPortal={(from) => void goPortal(from)}
            />
            <p className={styles.muted}>{t('pricing.note')}</p>
          </section>
        </>
      )}
    </Layout>
  )
}

export default Billing
