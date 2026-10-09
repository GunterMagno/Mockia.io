import React, { useState } from 'react'
import type { BillingOverview } from '@mockia/shared'
import { openBillingPortal } from '../../../services/billingService'
import { getBackendErrorMessage } from '../../../utils/error'
import { useI18n } from '../../../i18n/I18nProvider'
import styles from './PastDueBanner.module.scss'

/**
 * Aviso de cobro fallido (billingStatus past_due). Dentro del periodo de gracia el plan de pago sigue activo y el aviso dice hasta
 * cuando; pasada la gracia el plan efectivo ya es Free y el aviso lo dice. En ambos casos el boton lleva al portal de Stripe para
 * actualizar el metodo de pago. Se usa en Facturacion y en el panel.
 */
const PastDueBanner: React.FC<{ overview: BillingOverview }> = ({ overview }) => {
  const { t, formatDate } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (overview.billingStatus !== 'past_due') return null

  const plan = t(`pricing.plans.${overview.subscribedPlan}.name`)
  const inGrace = overview.plan !== 'free' && overview.pastDueUntil !== null
  // UTC, como la fecha del correo: el mismo dia en ambos sitios
  const message = inGrace
    ? t('billing.pastDueGrace', { plan, date: formatDate(overview.pastDueUntil as string, { dateStyle: 'long', timeZone: 'UTC' }) })
    : t('billing.pastDue', { plan })

  const openPortal = async () => {
    setBusy(true)
    setError('')
    try {
      window.location.assign(await openBillingPortal())
    } catch (err) {
      setError(getBackendErrorMessage(err, t))
      setBusy(false)
    }
  }

  return (
    <div className={`${styles.banner} ${inGrace ? styles.grace : styles.expired}`} role="status" data-testid="past-due-banner">
      <p className={styles.message}>{message}</p>
      {overview.canManageBilling && (
        <button type="button" className={styles.action} onClick={() => void openPortal()} disabled={busy}>
          {busy ? t('billing.opening') : t('billing.updatePayment')}
        </button>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}

export default PastDueBanner
