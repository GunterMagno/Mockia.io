import React, { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PATHS } from '../../routes/paths'
import { useAuth } from '../../contexts/AuthContext'
import { useRevealFallback } from '../../hooks/useRevealFallback'
import { useI18n, type MessageKey } from '../../i18n/I18nProvider'
import BuilderPreview from './BuilderPreview'
import styles from './Index.module.scss'

import arrowRight from '../../assets/arrow-right.svg'
import sparkles from '../../assets/sparkles.svg'
import codeIcon from '../../assets/code-icon.svg'
import terminalIcon from '../../assets/terminal.svg'
import shieldIcon from '../../assets/shield.svg'
import quoteIcon from '../../assets/quote.svg'

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
  { id: 'cli', icon: terminalIcon },
] as const

const Index: React.FC = () => {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const { t, tl, rich } = useI18n()
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
            <nav className={styles.heroActions} aria-label={t('landing.hero.actions')}>
              <button className={styles.primaryBtn} onClick={() => navigate(isAuthenticated ? PATHS.dashboard : PATHS.signup)}>
                <span>{isAuthenticated ? t('landing.hero.ctaDashboard') : t('landing.hero.ctaStart')}</span>
                <img src={arrowRight} alt="" />
              </button>
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

      {/* Bento */}
      <section className={styles.bentoSection} aria-label={t('landing.bento.label')}>
        <div className={`${styles.container} ${styles.bentoGrid}`}>
          <article className={styles.infraCard} data-reveal>
            <p className={styles.eyebrow}>{t('landing.bento.eyebrow')}</p>
            <h3>{t('landing.bento.infraTitle')}</h3>
            <p className={styles.infraText}>{t('landing.bento.infraText')}</p>
            <ul className={styles.stats}>
              <li className={styles.statItem}><span className={styles.val}>100+</span><span className={styles.label}>{t('landing.bento.regions')}</span></li>
              <li className={styles.statItem}><span className={styles.val}>&lt;15ms</span><span className={styles.label}>{t('landing.bento.latency')}</span></li>
              <li className={styles.statItem}><span className={styles.val}>99.9%</span><span className={styles.label}>{t('landing.bento.uptime')}</span></li>
            </ul>
          </article>

          <article className={styles.trustCard} data-reveal>
            <header className={styles.trustHeader}>
              <span className={styles.trustIcon} aria-hidden="true"><img src={shieldIcon} alt="" /></span>
              <span className={styles.badges}>
                <span className={styles.badge}>{t('landing.bento.badgeNew')}</span>
                <span className={styles.badge}>V2.0</span>
              </span>
            </header>
            <h3>{t('landing.bento.teamTitle')}</h3>
            <p>{t('landing.bento.teamText')}</p>
            <ul className={styles.securityChecklist}>
              <li>{t('landing.bento.unlimitedProjects')}</li>
              <li>{t('landing.bento.realtimeSync')}</li>
              <li>{t('landing.bento.rbac')}</li>
            </ul>
          </article>

          <figure className={styles.quoteCard} data-reveal>
            <img className={styles.quoteDecoration} src={quoteIcon} alt="" aria-hidden="true" />
            <blockquote>
              <p>{t('landing.bento.quote')}</p>
            </blockquote>
            <figcaption className={styles.author}>
              <span className={styles.avatar} aria-hidden="true" />
              <span className={styles.info}>
                <span className={styles.name}>Sarah Chen</span>
                <span className={styles.role}>{t('landing.bento.quoteRole')}</span>
              </span>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* Pricing */}
      <section className={styles.pricingSection} aria-labelledby="pricing-title">
        <div className={styles.comingSoonOverlay} aria-hidden="true">
          <span className={styles.overlayText}>{t('landing.pricing.comingSoon')}</span>
        </div>
        <div className={styles.container}>
          <header className={styles.pricingHeader}>
            <h2 id="pricing-title">{t('landing.pricing.title')}</h2>
            <p>{t('landing.pricing.subtitle')}</p>
          </header>
          <div className={styles.pricingGrid}>
            <article className={styles.priceCard}>
              <h3>{t('landing.pricing.developer')}</h3>
              <p className={styles.price}><span className={styles.amount}>$0</span><span className={styles.period}>{t('landing.pricing.perMonth')}</span></p>
              <ul className={styles.planFeatures}>
                {tl('landing.pricing.devFeatures').map((f) => <li key={f}>{f}</li>)}
              </ul>
              <button className={styles.planBtn} tabIndex={-1}>{t('landing.pricing.getStarted')}</button>
            </article>
            <article className={`${styles.priceCard} ${styles.proCard}`}>
              <h3>{t('landing.pricing.pro')}</h3>
              <p className={styles.price}><span className={styles.amount}>$19</span><span className={styles.period}>{t('landing.pricing.perMonth')}</span></p>
              <ul className={styles.planFeatures}>
                {tl('landing.pricing.proFeatures').map((f) => <li key={f}>{f}</li>)}
              </ul>
              <button className={`${styles.planBtn} ${styles.primaryPlanBtn}`} tabIndex={-1}>{t('landing.pricing.startTrial')}</button>
            </article>
          </div>
        </div>
      </section>
    </div>
  )
}

export default Index
