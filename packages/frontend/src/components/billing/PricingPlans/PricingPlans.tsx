import React from 'react'
import { useNavigate } from 'react-router-dom'
import { PLANS, PLAN_LIMITS, PLAN_PRICE_USD, type BillingOverview, type PaidPlan, type Plan } from '@mockia/shared'
import { useAuth } from '../../../contexts/AuthContext'
import { htmlLangOf, useI18n } from '../../../i18n/I18nProvider'
import { PATHS } from '../../../routes/paths'
import styles from './PricingPlans.module.scss'

type Busy = Plan | 'portal' | null

type Props = {
  /** public: landing (lleva a registro / facturacion). app: pagina de facturacion (checkout o portal). */
  mode: 'public' | 'app'
  overview?: BillingOverview | null
  /** Plan resaltado (p. ej. el elegido en la landing antes de registrarse). */
  highlight?: PaidPlan | null
  busy?: Busy
  onCheckout?: (plan: PaidPlan) => void
  /** Abre el portal de Stripe; recibe el plan de la tarjeta que lo pidio (para marcarla como ocupada). */
  onPortal?: (from: Plan) => void
}

type Cta = { label: string; onClick?: () => void; disabled?: boolean; primary?: boolean }

/** Suscripcion viva o impagada: cambiar de plan se hace en el portal, no con otro checkout. */
export const hasOpenSubscription = (o: BillingOverview) => o.subscribedPlan !== 'free' && o.billingStatus !== 'canceled'

export const PricingPlans: React.FC<Props> = ({ mode, overview, highlight, busy = null, onCheckout, onPortal }) => {
  const { t, formatNumber, locale } = useI18n()

  // Importe grande y simbolo pequeno, en el orden de cada idioma ("$29", "29 US$", "US$29")
  const price = (amount: number) =>
    new Intl.NumberFormat(htmlLangOf(locale), { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
      .formatToParts(amount)
      .filter((part) => part.type !== 'literal') // el hueco lo pone el gap del flex, no un espacio a tamano grande
      .map((part, i) =>
        part.type === 'currency' ? (
          <span key={i} className={styles.currency}>{part.value}</span>
        ) : (
          <span key={i}>{part.value}</span>
        )
      )
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()

  const planName = (plan: Plan) => t(`pricing.plans.${plan}.name`)
  const requests = (plan: Plan) => t('pricing.features.requests', { n: formatNumber(PLAN_LIMITS[plan].maxMonthlyRequests, { notation: 'compact' }) })
  const projects = (plan: Plan) => {
    const max = PLAN_LIMITS[plan].maxActiveProjects
    return Number.isFinite(max) ? t('pricing.features.projects', { count: max }) : t('pricing.features.unlimitedProjects')
  }

  const features: Record<Plan, string[]> = {
    free: [projects('free'), requests('free'), t('pricing.features.aiAndGithub'), t('pricing.features.emailSupport')],
    pro: [t('pricing.features.everythingFree'), projects('pro'), requests('pro'), t('pricing.features.cancelAnytime')],
    team: [t('pricing.features.everythingPro'), projects('team'), requests('team'), t('pricing.features.prioritySupport')],
  }

  const publicCta = (plan: Plan): Cta => {
    if (plan === 'free') {
      return isAuthenticated
        ? { label: t('pricing.cta.dashboard'), onClick: () => navigate(PATHS.dashboard) }
        : { label: t('pricing.cta.free'), onClick: () => navigate(PATHS.signup) }
    }
    const target = { pathname: PATHS.billing, search: `?upgrade=${plan}` }
    return {
      label: t('pricing.cta.choose', { plan: planName(plan) }),
      primary: plan === 'pro',
      // Sin cuenta: registro y despues vuelve a facturacion con el plan elegido
      onClick: () => (isAuthenticated ? navigate(target) : navigate(PATHS.signup, { state: { from: target } })),
    }
  }

  const appCta = (plan: Plan, o: BillingOverview): Cta => {
    const open = hasOpenSubscription(o)
    if (plan === o.plan && !(plan === 'free' && open)) return { label: t('pricing.cta.current'), disabled: true }
    if (plan === 'free') {
      return { label: t('pricing.cta.downgrade'), onClick: () => onPortal?.(plan), disabled: !o.canManageBilling }
    }
    if (open) {
      return { label: t('pricing.cta.switchPlan', { plan: planName(plan) }), onClick: () => onPortal?.(plan), disabled: !o.canManageBilling, primary: true }
    }
    if (!o.checkoutAvailable[plan]) return { label: t('pricing.cta.unavailable'), disabled: true }
    return { label: t('pricing.cta.upgrade', { plan: planName(plan) }), onClick: () => onCheckout?.(plan), primary: true }
  }

  return (
    <ul className={styles.grid}>
      {PLANS.map((plan) => {
        const cta = mode === 'app' && overview ? appCta(plan, overview) : publicCta(plan)
        const isBusy = busy === plan
        const isCurrent = mode === 'app' && overview?.plan === plan
        return (
          <li
            key={plan}
            className={[
              styles.card,
              plan === 'pro' ? styles.recommended : '',
              highlight === plan ? styles.highlight : '',
              isCurrent ? styles.current : '',
            ].join(' ')}
            aria-current={isCurrent ? 'true' : undefined}
          >
            <header className={styles.head}>
              <h3>{planName(plan)}</h3>
              {plan === 'pro' && <span className={styles.badge}>{t('pricing.recommended')}</span>}
            </header>
            <p className={styles.tagline}>{t(`pricing.plans.${plan}.tagline`)}</p>
            <p className={styles.price}>
              <span className={styles.amount}>{price(PLAN_PRICE_USD[plan])}</span>
              <span className={styles.period}>{t('pricing.perMonth')}</span>
            </p>
            <ul className={styles.features}>
              {features[plan].map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <button
              type="button"
              className={`${styles.cta} ${cta.primary ? styles.primary : ''}`}
              onClick={cta.onClick}
              disabled={cta.disabled || busy !== null}
              aria-busy={isBusy || undefined}
            >
              {isBusy ? t('billing.redirecting') : cta.label}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export default PricingPlans
