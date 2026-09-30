import React, { useId, useState } from 'react'
import { LOCALES, useI18n, type Locale } from '../../../i18n/I18nProvider'
import Icon from '../Icon/Icon'
import globeIcon from '../../../assets/globe.svg'
import styles from './LanguageSwitcher.module.scss'

type Props = { className?: string }

/** Selector nativo: accesible por teclado y lector de pantalla sin JS extra; cada idioma en su propio nombre. */
export const LanguageSwitcher: React.FC<Props> = ({ className = '' }) => {
  const { locale, setLocale, t } = useI18n()
  const [pending, setPending] = useState(false)
  const id = useId()

  const onChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    setPending(true)
    try {
      await setLocale(e.target.value as Locale)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={`${styles.switcher} ${className}`}>
      <label htmlFor={id} className="sr-only">{t('language.label')}</label>
      <Icon src={globeIcon} size={18} className={styles.icon} />
      <select id={id} value={locale} onChange={onChange} disabled={pending} className={styles.select} aria-busy={pending}>
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code} lang={l.htmlLang}>
            {l.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export default LanguageSwitcher
