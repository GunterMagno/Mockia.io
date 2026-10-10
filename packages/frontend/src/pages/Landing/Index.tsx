import React, { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PATHS } from '../../routes/paths'
import { useAuth } from '../../contexts/AuthContext'
import { useRevealFallback } from '../../hooks/useRevealFallback'
import { useDemoAvailable } from '../../hooks/useDemoAvailable'
import { useI18n, type MessageKey } from '../../i18n/I18nProvider'
import BuilderPreview from './BuilderPreview'
import HowItWorks from './HowItWorks'
import PricingPlans from '../../components/billing/PricingPlans/PricingPlans'
import styles from './Index.module.scss'

import arrowRight from '../../assets/arrow-right.svg'
import sparkles from '../../assets/sparkles.svg'
import codeIcon from '../../assets/code-icon.svg'
import shieldIcon from '../../assets/shield.svg'

// three.js solo se descarga cuando hay movimiento permitido y el navegador esta ocioso
const HeroScene = lazy(() => import('./HeroScene'))

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
  cancelIdleCallback?: (id: number) => void
}

function useHeroScene(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const w = window as IdleWindow
    const start = () => setOn(true)
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(start, { timeout: 1500 })
      return () => w.cancelIdleCallback?.(id)
    }
    const t = window.setTimeout(start, 400)
    return () => window.clearTimeout(t)
  }, [])
  return on
}

type DiffKind = 'ctx' | 'add' | 'del'
const DIFF: ReadonlyArray<readonly [DiffKind, string]> = [
  ['ctx', '{'],
  ['del', '  "name": "Lorem Ipsum",'],
  ['add', '  "name": "Alex Rivers",'],
  ['del', '  "role": "dolor sit amet",'],
  ['add', '  "role": "admin",'],
  ['del', '  "id": "0000",'],
  ['add', '  "id": "usr_9A2FK0",'],
  ['ctx', '}'],
]
const SIGN: Record<DiffKind, string> = { ctx: ' ', add: '+', del: '-' }
const SR: Record<DiffKind, MessageKey | null> = { ctx: null, add: 'landing.story.added', del: 'landing.story.removed' }

const FEATURES = [
  { id: 'sync', icon: sparkles },
  { id: 'data', icon: codeIcon },
] as const

const Index: React.FC = () => {
  const navigate = useNavigate()
  const { isAuthenticated, isLoading } = useAuth()
  const { t, rich } = useI18n()
  const demoAvailable = useDemoAvailable() === true
  const rootRef = useRef<HTMLElement>(null)
  const sceneOn = useHeroScene()
  useRevealFallback(rootRef)

  return (
    <div className={styles.landing} ref={rootRef as React.RefObject<HTMLDivElement>}>
      <div className={styles.progress} aria-hidden="true" />

      {/* Hero */}
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroBackdrop} aria-hidden="true">
          {sceneOn && (
            <Suspense fallback={null}>
              <HeroScene />
            </Suspense>
          )}
        </div>
        <div className={`${styles.container} ${styles.heroGrid}`}>
          <header className={styles.heroContent}>
            <h1 id="hero-title">
              {rich('landing.hero.title', { em: (chunk) => <em className={styles.gradientText}>{chunk}</em> })}
            </h1>
            <p className={styles.heroDescription}>{t('landing.hero.description')}</p>
            {/* Anonimos (o aun sin saberlo): se reserva el hueco del boton secundario para que su llegada no mueva la pagina */}
            <nav className={`${styles.heroActions} ${!isAuthenticated || isLoading ? styles.reserveDemo : ''}`} aria-label={t('landing.hero.actions')}>
              <button className={styles.primaryBtn} onClick={() => navigate(isAuthenticated ? PATHS.dashboard : PATHS.signup)}>
                <span>{isAuthenticated ? t('landing.hero.ctaDashboard') : t('landing.hero.ctaStart')}</span>
                <img src={arrowRight} alt="" />
              </button>
              {/* Solo para visitantes anonimos y si el servidor dice que la demo esta disponible (fail closed) */}
              {!isAuthenticated && demoAvailable && (
                <Link className={styles.secondaryBtn} to={PATHS.demo}>
                  {t('landing.hero.ctaDemo')}
                </Link>
              )}
            </nav>
          </header>

          <figure className={styles.codeWindow}>
            <figcaption className={styles.windowHeader}>
              <span className={styles.dots} aria-hidden="true"><span /><span /><span /></span>
              <span className={styles.addressBar}>api.mockia.io/v1/projects/alpha/users</span>
            </figcaption>
            <div className={styles.windowContent}>
              <pre>
                <code>
                  <span className={styles.comment}>{'// GET /users/me'}</span>{'\n'}
                  {'{'}{'\n'}
                  {'  '}<span className={styles.key}>"status"</span>: <span className={styles.number}>200</span>,{'\n'}
                  {'  '}<span className={styles.key}>"data"</span>: {'{'}{'\n'}
                  {'    '}<span className={styles.key}>"id"</span>: <span className={styles.string}>"usr_9A2FK0"</span>,{'\n'}
                  {'    '}<span className={styles.key}>"name"</span>: <span className={styles.string}>"Alex Rivers"</span>,{'\n'}
                  {'    '}<span className={styles.key}>"role"</span>: <span className={styles.string}>"admin"</span>,{'\n'}
                  {'    '}<span className={styles.key}>"permissions"</span>: [{'\n'}
                  {'      '}<span className={styles.string}>"read:repo"</span>,{'\n'}
                  {'      '}<span className={styles.string}>"write:mock"</span>{'\n'}
                  {'    '}]{'\n'}
                  {'  '}{'}'},{'\n'}
                  {'  '}<span className={styles.key}>"latency"</span>: <span className={styles.string}>"12ms"</span>{'\n'}
                  {'}'}
                </code>
              </pre>
            </div>
            <footer className={styles.windowFooter}>
              <span className={styles.status}>GET</span>
              <span className={styles.status}>200 OK</span>
            </footer>
          </figure>
        </div>
      </section>

      <HowItWorks />

      {/* Story: el diff se revela con el scroll */}
      <section className={styles.story} aria-labelledby="story-title">
        <div className={`${styles.container} ${styles.storyGrid}`}>
          <header className={styles.storyText} data-reveal>
            <h2 id="story-title">{t('landing.story.title')}</h2>
            <p>{t('landing.story.text')}</p>
          </header>

          <figure className={styles.diff}>
            <figcaption className={styles.diffHead}>GET /users/me</figcaption>
            <pre className={styles.diffBody}>
              <code>
                {DIFF.map(([kind, text], i) => (
                  <span key={i} className={`${styles.diffLine} ${styles[kind]}`} style={{ '--i': i } as React.CSSProperties}>
                    <span className={styles.sign} aria-hidden="true">{SIGN[kind]}</span>
                    {SR[kind] && <span className="sr-only">{t(SR[kind]!)}</span>}
                    {text}
                  </span>
                ))}
              </code>
            </pre>
          </figure>
        </div>
      </section>

      {/* Tarjetas request / response */}
      <section className={styles.flow} aria-labelledby="flow-title">
        <div className={styles.container}>
          <h2 id="flow-title" data-reveal>{t('landing.flow.title')}</h2>
          <div className={styles.flowCards}>
            <article className={`${styles.flowCard} ${styles.reqCard}`} tabIndex={0} aria-label={t('landing.flow.request')} data-reveal>
              <h3><span className={styles.tag}>{t('landing.flow.request')}</span></h3>
              <pre><code>
                <span className={styles.ok}>GET</span> /v1/projects/alpha/users/me{'\n'}
                <span className={styles.comment}>X-Mockia-API-Key</span>: mk_••••••••
              </code></pre>
            </article>
            <article className={`${styles.flowCard} ${styles.resCard}`} tabIndex={0} aria-label={t('landing.flow.response')} data-reveal>
              <h3><span className={styles.tag}>{t('landing.flow.response')}</span> <span className={styles.ok}>200 OK</span> <span className={styles.comment}>12ms</span></h3>
              <pre><code>
                {'{ '}<span className={styles.key}>"id"</span>: <span className={styles.string}>"usr_9A2FK0"</span>,{'\n'}
                {'  '}<span className={styles.key}>"name"</span>: <span className={styles.string}>"Alex Rivers"</span>,{'\n'}
                {'  '}<span className={styles.key}>"role"</span>: <span className={styles.string}>"admin"</span> {'}'}
              </code></pre>
            </article>
          </div>
        </div>
      </section>

      {/* Builder interactivo */}
      <section className={styles.builder} aria-labelledby="builder-title">
        <div className={styles.container}>
          <header className={styles.sectionHead} data-reveal>
            <h2 id="builder-title">{t('landing.builder.title')}</h2>
            <p>{t('landing.builder.text')}</p>
          </header>
          <BuilderPreview />
        </div>
      </section>

      {/* Features */}
      <section className={styles.features} aria-labelledby="features-title">
        <div className={styles.container}>
          <h2 id="features-title" data-reveal>{t('landing.features.title')}</h2>
          <ul className={styles.featureGrid}>
            {FEATURES.map((f) => (
              <li key={f.id} className={styles.featureCard} data-reveal>
                <span className={styles.iconBox} aria-hidden="true"><img src={f.icon} alt="" /></span>
                <h3>{t(`landing.features.${f.id}.title`)}</h3>
                <p>{t(`landing.features.${f.id}.text`)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Equipos. Antes era un "bento" con cifras (regiones, latencia, disponibilidad) y una cita que no eran reales: se quitaron */}
      <section className={styles.bentoSection} aria-labelledby="team-title">
        <div className={styles.container}>
          <article className={styles.trustCard} data-reveal>
            <div className={styles.trustBody}>
              <span className={styles.trustIcon} aria-hidden="true"><img src={shieldIcon} alt="" /></span>
              <h2 id="team-title">{t('landing.bento.teamTitle')}</h2>
              <p>{t('landing.bento.teamText')}</p>
            </div>
            <ul className={styles.securityChecklist}>
              <li>{t('landing.bento.unlimitedProjects')}</li>
              <li>{t('landing.bento.autoSync')}</li>
              <li>{t('landing.bento.rbac')}</li>
            </ul>
          </article>
        </div>
      </section>

      {/* Pricing */}
      <section className={styles.pricingSection} aria-labelledby="pricing-title">
        <div className={styles.container}>
          <header className={styles.pricingHeader} data-reveal>
            <h2 id="pricing-title">{t('pricing.title')}</h2>
            <p>{t('pricing.subtitle')}</p>
          </header>
          <PricingPlans mode="public" />
          <p className={styles.pricingNote}>{t('pricing.note')}</p>
        </div>
      </section>
    </div>
  )
}

export default Index
