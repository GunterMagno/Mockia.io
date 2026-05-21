import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import styles from './Index.module.scss'

// Import assets
import arrowRight from '../../assets/arrow-right.svg'
import sparkles from '../../assets/sparkles.svg'
import codeIcon from '../../assets/code-icon.svg'
import terminalIcon from '../../assets/terminal.svg'
import shieldIcon from '../../assets/shield.svg'
import quoteIcon from '../../assets/quote.svg'

const Index: React.FC = () => {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()

  return (
    <main className={styles.landing}>
      {/* Hero Section */}
      <section className={styles.hero}>
        <article className={styles.container}>
          <article className={styles.hero}>
            <header className={styles.heroContent}>
              <h1>Stop waiting <span className={styles.nowrap}>for the <span className={styles.gradientText}>Backend.</span></span></h1>
              <p className={styles.heroDescription}>
                Mockia uses AI to instantly generate production-ready Mock APIs 
                from your GitHub repositories. Sync your schemas and start coding in seconds.
              </p>
              <nav className={styles.heroActions}>
                {isAuthenticated ? (
                  <button className={styles.primaryBtn} onClick={() => navigate('/dashboard')}>
                    <span>Go to Dashboard</span> <img src={arrowRight} alt="Dashboard icon" />
                  </button>
                ) : (
                  <button className={styles.primaryBtn} onClick={() => navigate('/signup')}>
                    <span>Start for free</span> <img src={arrowRight} alt="Signup icon" />
                  </button>
                )}
              </nav>
            </header>

            <figure className={styles.codeWindow}>
              <figcaption className={styles.windowHeader}>
                <span className={styles.dots}>
                  <span></span><span></span><span></span>
                </span>
                <span className={styles.addressBar}>api.mockia.io/v1/projects/alpha/users</span>
                <span></span>
              </figcaption>
              <article className={styles.windowContent}>
                <pre>
                  <code>
                    <span className={styles.comment}>// GET /users/me</span><br/>
                    {'{'}<br/>
                    {'  '}<span className={styles.key}>"status"</span>: <span className={styles.number}>200</span>,<br/>
                    {'  '}<span className={styles.key}>"data"</span>: {'{'}<br/>
                    {'    '}<span className={styles.key}>"id"</span>: <span className={styles.string}>"usr_9A2FK0"</span>,<br/>
                    {'    '}<span className={styles.key}>"name"</span>: <span className={styles.string}>"Alex Rivers"</span>,<br/>
                    {'    '}<span className={styles.key}>"role"</span>: <span className={styles.string}>"admin"</span>,<br/>
                    {'    '}<span className={styles.key}>"permissions"</span>: [<br/>
                    {'      '}<span className={styles.string}>"read:repo"</span>,<br/>
                    {'      '}<span className={styles.string}>"write:mock"</span><br/>
                    {'    '}]<br/>
                    {'  '}{'}'},<br/>
                    {'  '}<span className={styles.key}>"latency"</span>: <span className={styles.string}>"12ms"</span><br/>
                    {'}'}
                  </code>
                </pre>
              </article>
              <footer className={styles.windowFooter}>
                <span className={styles.status}>GET</span>
                <span className={styles.status}>200 OK</span>
              </footer>
            </figure>
          </article>
        </article>
      </section>

      {/* Features Grid */}
      <section className={styles.features}>
        <article className={styles.container}>
          <h2>Designed for high-speed engineering.</h2>
          <article className={styles.featureGrid}>
            <article className={styles.featureCard}>
              <figure className={styles.iconBox}><img src={sparkles} alt="Instant GitHub Sync icon" /></figure>
              <h3>Instant GitHub Sync</h3>
              <p>Point to any repository. Our AI parses your types, interfaces, and schemas to generate a mirror API in seconds.</p>
            </article>
            <article className={styles.featureCard}>
              <figure className={styles.iconBox}><img src={codeIcon} alt="Realistic Data icon" /></figure>
              <h3>Realistic Data</h3>
              <p>No more "Lorem Ipsum". Mockia populates your endpoints with context-aware data that looks and feels like production.</p>
            </article>
            <article className={styles.featureCard}>
              <figure className={styles.iconBox}><img src={terminalIcon} alt="CLI-First Workflow icon" /></figure>
              <h3>CLI-First Workflow</h3>
              <p>Deploy, update, and manage your mocks directly from your terminal. Built for developers who hate context switching.</p>
            </article>
          </article>
        </article>
      </section>

      {/* Bento Layout Section */}
      <section className={styles.bentoSection}>
        <article className={styles.container}>
          <article className={styles.bentoGrid}>
            <article className={styles.infraCard}>
              <h6>INFRASTRUCTURE</h6>
              <h3>Global Edge Deployment</h3>
              <p>Deploy your mock endpoints to over 100 edge locations worldwide for sub-10ms latency during frontend testing.</p>
              
              <article className={styles.stats}>
                <article className={styles.statItem}>
                  <span className={styles.val}>100+</span>
                  <span className={styles.label}>REGIONS</span>
                </article>
                <article className={styles.statItem}>
                  <span className={styles.val}>&lt;15ms</span>
                  <span className={styles.label}>LATENCY</span>
                </article>
                <article className={styles.statItem}>
                  <span className={styles.val}>99.9%</span>
                  <span className={styles.label}>UPTIME</span>
                </article>
              </article>
            </article>

            <article className={styles.trustCard}>
              <header className={styles.trustHeader}>
                <figure className={styles.icon}><img src={shieldIcon} alt="Trust icon" /></figure>
                <nav className={styles.badges}>
                  <span className={styles.badge}>NEW</span>
                  <span className={styles.badge}>V2.0</span>
                </nav>
              </header>
              <h3>Team Collaboration</h3>
              <p>Share mocks with your team. Secure-by-default environment for modern engineering organizations.</p>
              <article className={styles.securityChecklist}>
                <span className={styles.checkItem}>✓ Unlimited Projects</span>
                <span className={styles.checkItem}>✓ Real-time Sync</span>
                <span className={styles.checkItem}>✓ RBAC Permissions</span>
              </article>
            </article>

            <article className={styles.quoteCard}>
              <figure className={styles.quoteDecoration}><img src={quoteIcon} alt="Quote icon" /></figure>
              <article className={styles.quoteContent}>
                <h2>"Mockia saved us 3 weeks of backend development time."</h2>
                <footer className={styles.author}>
                  <figure className={styles.avatar}></figure>
                  <article className={styles.info}>
                    <span className={styles.name}>Sarah Chen</span>
                    <span className={styles.role}>Lead Engineer, Veloce Tech</span>
                  </article>
                </footer>
              </article>
            </article>
          </article>
        </article>
      </section>

      {/* Pricing Section */}
      <section className={styles.pricingSection}>
        <article className={styles.comingSoonOverlay}>
          <span className={styles.overlayText}>PRÓXIMAMENTE</span>
        </article>
        
        <article className={styles.container}>
          <header className={styles.pricingHeader}>
            <h2>Simple, scalable pricing.</h2>
            <p>No hidden fees. Scale as you build.</p>
          </header>

          <article className={styles.pricingGrid}>
            {/* Developer Plan */}
            <article className={styles.priceCard}>
              <h3>Developer</h3>
              <header className={styles.price}>
                <span className={styles.amount}>$0</span>
                <span className={styles.period}>/mo</span>
              </header>
              <ul className={styles.planFeatures}>
                <li>✓ 3 Active Projects</li>
                <li>✓ Unlimited GitHub Syncs</li>
                <li>✓ Basic Data Generation</li>
              </ul>
              <button className={styles.planBtn}>Get Started</button>
            </article>

            {/* Pro Plan */}
            <article className={`${styles.priceCard} ${styles.proCard}`}>
              <h3>Pro</h3>
              <header className={styles.price}>
                <span className={styles.amount}>$19</span>
                <span className={styles.period}>/mo</span>
              </header>
              <ul className={styles.planFeatures}>
                <li>✓ Everything in Developer</li>
                <li>✓ Unlimited Projects</li>
                <li>✓ Custom Domain Support</li>
                <li>✓ API Latency Simulation</li>
              </ul>
              <button className={`${styles.planBtn} ${styles.primaryPlanBtn}`}>Start Pro Trial</button>
            </article>
          </article>
        </article>
      </section>
    </main>
  )
}

export default Index
