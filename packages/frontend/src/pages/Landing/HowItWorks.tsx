import React, { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import styles from './HowItWorks.module.scss'

/**
 * Animacion "como funciona" (public/como-funciona/index.html) incrustada en un iframe del mismo origen.
 * El iframe avisa de su altura (cambia con el ancho) y aqui se le manda el idioma activo sin recargarlo.
 */
const HowItWorks: React.FC = () => {
  const { t, locale } = useI18n()
  const frame = useRef<HTMLIFrameElement>(null)
  const firstLocale = useRef(locale)
  const [height, setHeight] = useState(540)

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return
      if (e.data?.type === 'mockia-explainer-height' && Number.isFinite(e.data.height)) setHeight(e.data.height)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // The iframe is lazy: a message posted before its document loads goes to the empty initial frame and is lost (e.g. the
  // account's saved language applied at boot). It is posted on every change AND again when the document loads.
  const localeRef = useRef(locale)
  localeRef.current = locale
  const sendLocale = () =>
    frame.current?.contentWindow?.postMessage({ type: 'mockia-explainer-lang', lang: localeRef.current }, window.location.origin)

  useEffect(() => {
    sendLocale()
  }, [locale])

  return (
    <section className={styles.how} aria-labelledby="how-title">
      <div className={styles.container}>
        <header className={styles.head} data-reveal>
          <h2 id="how-title">{t('landing.how.title')}</h2>
          <p>{t('landing.how.text')}</p>
        </header>
        <iframe
          ref={frame}
          className={styles.frame}
          style={{ height }}
          title={t('landing.how.frameTitle')}
          src={`/como-funciona/index.html?embed=1&lang=${firstLocale.current}`}
          loading="lazy"
          onLoad={sendLocale}
        />
      </div>
    </section>
  )
}

export default HowItWorks
