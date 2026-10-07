import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../../../i18n/I18nProvider'
import { PATHS } from '../../../routes/paths'
import styles from './CookieBanner.module.scss'

/** localStorage key that remembers the notice was dismissed (also listed in the Cookies page). */
export const COOKIE_NOTICE_KEY = 'mockia_cookie_notice_dismissed'

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(COOKIE_NOTICE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Informational, non-blocking notice: Mockia only uses strictly necessary cookies and storage (session, language), which
 * need no consent (LSSI art. 22.2), so there is nothing to accept or reject and no tracking to switch on. It is shown
 * because the project prefers to be transparent. If analytics are ever added this must become a real consent banner with
 * "Accept" and "Reject" of equal weight (AEPD criteria).
 */
const CookieBanner: React.FC = () => {
  const { t, rich } = useI18n()
  const [dismissed, setDismissed] = useState(wasDismissed)

  if (dismissed) return null

  const dismiss = () => {
    try {
      window.localStorage.setItem(COOKIE_NOTICE_KEY, '1')
    } catch {
      // storage unavailable: hidden for this visit only
    }
    setDismissed(true)
  }

  return (
    <section className={styles.banner} role="region" aria-label={t('cookieNotice.label')} data-cookie-notice>
      <p className={styles.text}>
        {rich('cookieNotice.text', {
          more: (chunk) => <Link to={PATHS.cookies}>{chunk}</Link>,
        })}
      </p>
      <button type="button" className={styles.ok} onClick={dismiss}>
        {t('cookieNotice.ok')}
      </button>
    </section>
  )
}

export default CookieBanner
