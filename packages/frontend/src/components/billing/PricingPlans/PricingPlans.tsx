import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ANNUAL_DISCOUNT_PERCENT,
  BILLING_INTERVALS,
  PLANS,
  PLAN_LIMITS,
  PLAN_PRICE_USD,
  annualMonthlyEquivalentUsd,
  type BillingInterval,
  type BillingOverview,
  type PaidPlan,
  type Plan,
} from '@mockia/shared'
import { useAuth } from '../../../contexts/AuthContext'
import { htmlLangOf, useI18n } from '../../../i18n/I18nProvider'
import { PATHS } from '../../../routes/paths'
import { LEGAL_ENTITY } from '../../../pages/Legal/legalConfig'
import styles from './PricingPlans.module.scss'

type Busy = Plan | 'portal' | null

type Props = {
  /** public: landing (lleva a registro / facturacion). app: pagina de facturacion (checkout o portal). */
  mode: 'public' | 'app'
  overview?: BillingOverview | null
  /** Plan resaltado (p. ej. el elegido en la landing antes de registrarse). */
  highlight?: PaidPlan | null
  /** Intervalo preseleccionado (p. ej. el elegido en la landing); por defecto el que ya paga el usuario, o el mensual. */
  initialInterval?: BillingInterval | null
  busy?: Busy
  onCheckout?: (plan: PaidPlan, interval: BillingInterval) => void
  /** Abre el portal de Stripe; recibe el plan de la tarjeta que lo pidio (para marcarla como ocupada). */
  onPortal?: (from: Plan) => void
}

type Cta = { label: string; onClick?: () => void; disabled?: boolean; primary?: boolean }

/**
 * Correo de contacto de Enterprise: el del titular del servicio (VITE_LEGAL_EMAIL). Sin el (desarrollo) se usa un marcador
 * con dominio `.invalid` (reservado: nunca entrega correo), igual que las paginas legales muestran un marcador visible.
 */
export const ENTERPRISE_PLACEHOLDER_EMAIL = 'enterprise@mockia.invalid'

/** Suscripcion viva o impagada: cambiar de plan se hace en el portal, no con otro checkout. */
export const hasOpenSubscription = (o: BillingOverview) => o.subscribedPlan !== 'free' && o.billingStatus !== 'canceled'

/** Sin decimales cuando el importe es entero ($29); con dos si no ($24.17). */
const fractionDigits = (amount: number) => (Number.isInteger(amount) ? 0 : 2)

export const PricingPlans: React.FC<Props> = ({ mode, overview, highlight, initialInterval, busy = null, onCheckout, onPortal }) => {
  const { t, formatNumber, locale } = useI18n()
  const [interval, setInterval] = useState<BillingInterval>(
    initialInterval ?? (mode === 'app' && overview?.interval ? overview.interval : 'month')
  )

  const currency = (amount: number) =>
    new Intl.NumberFormat(htmlLangOf(locale), {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: fractionDigits(amount),
      maximumFractionDigits: fractionDigits(amount),
    })

  // Importe grande y simbolo pequeno, en el orden de cada idioma ("$29", "29 US$", "US$29")
  const price = (amount: number) => {
    const nodes: Array<{ kind: 'currency' | 'number'; value: string }> = []
    for (const part of currency(amount).formatToParts(amount)) {
      if (part.type === 'literal') continue // el hueco lo pone el gap del flex, no un espacio a tamano grande
      const kind = part.type === 'currency' ? 'currency' : 'number'
      const last = nodes[nodes.length - 1]
      if (kind === 'number' && last?.kind === 'number') last.value += part.value // "24" + "." + "17" es un solo importe
      else nodes.push({ kind, value: part.value })
    }
    return nodes.map((n, i) => (
      <span key={i} className={n.kind === 'currency' ? styles.currency : undefined}>
        {n.value}
      </span>
    ))
  }
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()

  const planName = (plan: Plan) => t(`pricing.plans.${plan}.name`)
  const requests = (plan: Plan) => t('pricing.features.requests', { n: formatNumber(PLAN_LIMITS[plan].maxMonthlyRequests, { notation: 'compact' }) })
  const projects = (plan: Plan) => {
    const max = PLAN_LIMITS[plan].maxActiveProjects
    return Number.isFinite(max) ? t('pricing.features.projects', { count: max }) : t('pricing.features.unlimitedProjects')
  }

  const features: Record<Plan, string[]> = {
    // No support line on Free: the Terms make no support commitment for it (ruling R15)
    free: [projects('free'), requests('free'), t('pricing.features.aiAndGithub')],
    starter: [t('pricing.features.everythingFree'), projects('starter'), requests('starter'), t('pricing.features.cancelAnytime')],
    pro: [t('pricing.features.everythingFree'), projects('pro'), requests('pro'), t('pricing.features.cancelAnytime')],
    team: [t('pricing.features.everythingPro'), projects('team'), requests('team'), t('pricing.features.prioritySupport')],
  }

  const publicCta = (plan: Plan): Cta => {
    if (plan === 'free') {
      return isAuthenticated
        ? { label: t('pricing.cta.dashboard'), onClick: () => navigate(PATHS.dashboard) }
        : { label: t('pricing.cta.free'), onClick: () => navigate(PATHS.signup) }
    }
    // El intervalo elegido viaja con el plan: tras registrarse (o si ya hay sesion) la facturacion lo recibe y lo preselecciona
    const target = { pathname: PATHS.billing, search: `?upgrade=${plan}${interval === 'year' ? '&interval=year' : ''}` }
    return {
      label: t('pricing.cta.choose', { plan: planName(plan) }),
      primary: plan === 'pro',
      // Sin cuenta: registro y despues vuelve a facturacion con el plan elegido
      onClick: () => (isAuthenticated ? navigate(target) : navigate(PATHS.signup, { state: { from: target } })),
    }
  }

  const appCta = (plan: Plan, o: BillingOverview): Cta => {
    const open = hasOpenSubscription(o)
    // Mismo plan pero otro intervalo del que paga: se cambia en el portal
    if (open && o.interval && plan === o.subscribedPlan && plan !== 'free' && interval !== o.interval) {
      return {
        label: t('pricing.cta.switchInterval', { interval: t(`pricing.interval.${interval}Adj`) }),
        onClick: () => onPortal?.(plan),
        disabled: !o.canManageBilling,
        primary: true,
      }
    }
    if (plan === o.plan && !(plan === 'free' && open)) return { label: t('pricing.cta.current'), disabled: true }
    if (plan === 'free') {
      return { label: t('pricing.cta.downgrade'), onClick: () => onPortal?.(plan), disabled: !o.canManageBilling }
    }
    if (open) {
      return { label: t('pricing.cta.switchPlan', { plan: planName(plan) }), onClick: () => onPortal?.(plan), disabled: !o.canManageBilling, primary: true }
    }
    const available = interval === 'year' ? o.yearlyCheckoutAvailable[plan] : o.checkoutAvailable[plan]
    if (!available) return { label: t('pricing.cta.unavailable'), disabled: true }
    return { label: t('pricing.cta.upgrade', { plan: planName(plan) }), onClick: () => onCheckout?.(plan, interval), primary: true }
  }

  const contactEmail = LEGAL_ENTITY.email || ENTERPRISE_PLACEHOLDER_EMAIL
  const enterpriseHref = `mailto:${contactEmail}?subject=${encodeURIComponent(t('pricing.enterprise.mailSubject'))}`
  const savePercent = formatNumber(ANNUAL_DISCOUNT_PERCENT / 100, { style: 'percent', maximumFractionDigits: 0 })

  return (
    <div className={styles.wrap}>
      <div className={styles.toggle} role="group" aria-label={t('pricing.interval.label')}>
        {BILLING_INTERVALS.map((value) => (
          <button
            key={value}
            type="button"
            className={`${styles.toggleBtn} ${interval === value ? styles.toggleOn : ''}`}
            aria-pressed={interval === value}
            onClick={() => setInterval(value)}
          >
            {t(`pricing.interval.${value}`)}
            {value === 'year' && <span className={styles.saveTag}>{t('pricing.save', { percent: savePercent })}</span>}
          </button>
        ))}
      </div>

      <ul className={styles.grid}>
        {PLANS.map((plan) => {
          const cta = mode === 'app' && overview ? appCta(plan, overview) : publicCta(plan)
          const isBusy = busy === plan
          const isCurrent = mode === 'app' && overview?.plan === plan
          const yearly = interval === 'year' && plan !== 'free'
          const shown = yearly ? annualMonthlyEquivalentUsd(plan) : PLAN_PRICE_USD[plan].monthly
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
                <span className={styles.amount} data-testid={`price-${plan}`}>
                  {price(shown)}
                </span>
                <span className={styles.period}>{t('pricing.perMonth')}</span>
              </p>
              <p className={styles.billed} data-testid={`billed-${plan}`}>
                {plan === 'free'
                  ? null
                  : yearly
                    ? t('pricing.billedYearly', { amount: currency(PLAN_PRICE_USD[plan].annual).format(PLAN_PRICE_USD[plan].annual) })
                    : t('pricing.billedMonthly')}
                {yearly && <span className={styles.saveTag}>{t('pricing.save', { percent: savePercent })}</span>}
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

        {/* Enterprise: sin precio ni checkout, se habla con el titular */}
        <li className={styles.card} data-testid="plan-enterprise">
          <header className={styles.head}>
            <h3>{t('pricing.enterprise.name')}</h3>
          </header>
          <p className={styles.tagline}>{t('pricing.enterprise.tagline')}</p>
          <p className={styles.price}>
            <span className={styles.custom}>{t('pricing.enterprise.price')}</span>
          </p>
          <p className={styles.billed} aria-hidden="true" />
          <ul className={styles.features}>
            <li>{t('pricing.enterprise.limits')}</li>
            <li>{t('pricing.enterprise.invoicing')}</li>
            <li>{t('pricing.enterprise.support')}</li>
            <li>{t('pricing.enterprise.onRequest')}</li>
          </ul>
          <a className={styles.cta} href={enterpriseHref}>
            {t('pricing.enterprise.cta')}
          </a>
        </li>
      </ul>
    </div>
  )
}

export default PricingPlans
