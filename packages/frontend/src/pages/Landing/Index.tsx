import React, { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useRevealFallback } from '../../hooks/useRevealFallback'
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
const SR: Record<DiffKind, string> = { ctx: '', add: 'Added: ', del: 'Removed: ' }

const FEATURES = [
  { icon: sparkles, title: 'Instant GitHub Sync', text: 'Point to any repository. Our AI parses your types, interfaces, and schemas to generate a mirror API in seconds.' },
  { icon: codeIcon, title: 'Realistic Data', text: 'No more "Lorem Ipsum". Mockia populates your endpoints with context-aware data that looks and feels like production.' },
  { icon: terminalIcon, title: 'CLI-First Workflow', text: 'Deploy, update, and manage your mocks directly from your terminal. Built for developers who hate context switching.' },
]

const Index: React.FC = () => {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
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
              Stop waiting <span className={styles.nowrap}>for the <span className={styles.gradientText}>Backend.</span></span>
            </h1>
            <p className={styles.heroDescription}>
              Mockia uses AI to instantly generate production-ready Mock APIs
              from your GitHub repositories. Sync your schemas and start coding in seconds.
            </p>
            <nav className={styles.heroActions} aria-label="Primary">
              <button className={styles.primaryBtn} onClick={() => navigate(isAuthenticated ? '/dashboard' : '/signup')}>
                <span>{isAuthenticated ? 'Go to Dashboard' : 'Start for free'}</span>
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
            <h2 id="story-title">No more "Lorem Ipsum".</h2>
            <p>
              Point to any repository. Our AI parses your types, interfaces, and schemas to generate a
              mirror API in seconds. Mockia populates your endpoints with context-aware data that looks
              and feels like production.
            </p>
          </header>

          <figure className={styles.diff}>
            <figcaption className={styles.diffHead}>GET /users/me</figcaption>
            <pre className={styles.diffBody}>
              <code>
                {DIFF.map(([kind, text], i) => (
                  <span key={i} className={`${styles.diffLine} ${styles[kind]}`} style={{ '--i': i } as React.CSSProperties}>
                    <span className={styles.sign} aria-hidden="true">{SIGN[kind]}</span>
                    <span className="sr-only">{SR[kind]}</span>
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
          <h2 id="flow-title" data-reveal>Request in, realistic response out.</h2>
          <div className={styles.flowCards}>
            <article className={`${styles.flowCard} ${styles.reqCard}`} tabIndex={0} aria-label="Request" data-reveal>
              <h3><span className={styles.tag}>REQUEST</span></h3>
              <pre><code>
                <span className={styles.ok}>GET</span> /v1/projects/alpha/users/me{'\n'}
                <span className={styles.comment}>X-Mockia-API-Key</span>: mk_••••••••
              </code></pre>
            </article>
            <article className={`${styles.flowCard} ${styles.resCard}`} tabIndex={0} aria-label="Response" data-reveal>
              <h3><span className={styles.tag}>RESPONSE</span> <span className={styles.ok}>200 OK</span> <span className={styles.comment}>12ms</span></h3>
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
            <h2 id="builder-title">Try the endpoint builder.</h2>
            <p>Pick a method, force a status and simulate latency. Nothing leaves your browser.</p>
          </header>
          <BuilderPreview />
        </div>
      </section>

      {/* Features */}
      <section className={styles.features} aria-labelledby="features-title">
        <div className={styles.container}>
          <h2 id="features-title" data-reveal>Designed for high-speed engineering.</h2>
          <ul className={styles.featureGrid}>
            {FEATURES.map((f) => (
              <li key={f.title} className={styles.featureCard} data-reveal>
                <span className={styles.iconBox} aria-hidden="true"><img src={f.icon} alt="" /></span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Bento */}
      <section className={styles.bentoSection} aria-label="Infrastructure and collaboration">
        <div className={`${styles.container} ${styles.bentoGrid}`}>
          <article className={styles.infraCard} data-reveal>
            <p className={styles.eyebrow}>INFRASTRUCTURE</p>
            <h3>Global Edge Deployment</h3>
            <p className={styles.infraText}>Deploy your mock endpoints to over 100 edge locations worldwide for sub-10ms latency during frontend testing.</p>
            <ul className={styles.stats}>
              <li className={styles.statItem}><span className={styles.val}>100+</span><span className={styles.label}>REGIONS</span></li>
              <li className={styles.statItem}><span className={styles.val}>&lt;15ms</span><span className={styles.label}>LATENCY</span></li>
              <li className={styles.statItem}><span className={styles.val}>99.9%</span><span className={styles.label}>UPTIME</span></li>
            </ul>
          </article>

          <article className={styles.trustCard} data-reveal>
            <header className={styles.trustHeader}>
              <span className={styles.trustIcon} aria-hidden="true"><img src={shieldIcon} alt="" /></span>
              <span className={styles.badges}>
                <span className={styles.badge}>NEW</span>
                <span className={styles.badge}>V2.0</span>
              </span>
            </header>
            <h3>Team Collaboration</h3>
            <p>Share mocks with your team. Secure-by-default environment for modern engineering organizations.</p>
            <ul className={styles.securityChecklist}>
              <li>Unlimited Projects</li>
              <li>Real-time Sync</li>
              <li>RBAC Permissions</li>
            </ul>
          </article>

          <figure className={styles.quoteCard} data-reveal>
            <img className={styles.quoteDecoration} src={quoteIcon} alt="" aria-hidden="true" />
            <blockquote>
              <p>"Mockia saved us 3 weeks of backend development time."</p>
            </blockquote>
            <figcaption className={styles.author}>
              <span className={styles.avatar} aria-hidden="true" />
              <span className={styles.info}>
                <span className={styles.name}>Sarah Chen</span>
                <span className={styles.role}>Lead Engineer, Veloce Tech</span>
              </span>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* Pricing */}
      <section className={styles.pricingSection} aria-labelledby="pricing-title">
        <div className={styles.comingSoonOverlay} aria-hidden="true">
          <span className={styles.overlayText}>PRÓXIMAMENTE</span>
        </div>
        <div className={styles.container}>
          <header className={styles.pricingHeader}>
            <h2 id="pricing-title">Simple, scalable pricing.</h2>
            <p>No hidden fees. Scale as you build.</p>
          </header>
          <div className={styles.pricingGrid}>
            <article className={styles.priceCard}>
              <h3>Developer</h3>
              <p className={styles.price}><span className={styles.amount}>$0</span><span className={styles.period}>/mo</span></p>
              <ul className={styles.planFeatures}>
                <li>3 Active Projects</li>
                <li>Unlimited GitHub Syncs</li>
                <li>Basic Data Generation</li>
              </ul>
              <button className={styles.planBtn} tabIndex={-1}>Get Started</button>
            </article>
            <article className={`${styles.priceCard} ${styles.proCard}`}>
              <h3>Pro</h3>
              <p className={styles.price}><span className={styles.amount}>$19</span><span className={styles.period}>/mo</span></p>
              <ul className={styles.planFeatures}>
                <li>Everything in Developer</li>
                <li>Unlimited Projects</li>
                <li>Custom Domain Support</li>
                <li>API Latency Simulation</li>
              </ul>
              <button className={`${styles.planBtn} ${styles.primaryPlanBtn}`} tabIndex={-1}>Start Pro Trial</button>
            </article>
          </div>
        </div>
      </section>
    </div>
  )
}

export default Index
