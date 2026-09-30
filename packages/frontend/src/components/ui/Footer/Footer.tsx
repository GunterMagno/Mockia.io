import React from 'react'
import { Link } from 'react-router-dom'
import { PATHS } from '../../../routes/paths'
import { useI18n } from '../../../i18n/I18nProvider'
import styles from './Footer.module.scss'

export const Footer: React.FC = () => {
  const { t } = useI18n()

  return (
    <footer className={styles.footer}>
      <section className={styles.container}>
        <p className={styles.tagline}>{t('footer.tagline', { year: new Date().getFullYear() })}</p>
        <nav className={styles.links} aria-label={t('footer.links')}>
          <a 
            href="https://github.com/GunterMagno/Mockia.io/tree/main/docs" 
            className={styles.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('footer.documentation')}
          </a>
          <Link to={PATHS.terms} className={styles.link}>{t('footer.terms')}</Link>
          <Link to={PATHS.privacy} className={styles.link}>{t('footer.privacy')}</Link>
          <a 
            href="/api/docs" 
            className={styles.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('footer.apiDocs')}
          </a>
        </nav>
      </section>
    </footer>
  )
}

export default Footer
