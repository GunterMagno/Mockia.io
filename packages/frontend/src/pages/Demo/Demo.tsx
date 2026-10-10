import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PATHS } from '../../routes/paths'
import { useI18n, type MessageKey } from '../../i18n/I18nProvider'
import {
  DEMO_TEMPLATE_IDS,
  DemoApiError,
  MAX_DEMO_TEXT_CHARS,
  callDemoMock,
  fillPath,
  generateDemo,
  getDemoStatus,
  pathParams,
  requestDemoChallenge,
  type DemoMockResponse,
  type DemoResult,
  type DemoSource,
  type DemoStatus,
  type DemoTemplateId,
} from '../../services/demoService'
import { runPow, type PowRun } from '../../workers/runPow'
import styles from './Demo.module.scss'

/**
 * Demo publica: una sola pantalla, sin cuenta. Todo el estado vive en memoria (nada en cookies, localStorage ni
 * sessionStorage); al recargar, la demo se olvida. El reto de prueba de trabajo se resuelve en un Web Worker.
 */

type SourceChoice = DemoTemplateId | 'text'
type Phase = 'idle' | 'solving' | 'sending'
type Notice = 'cancelled' | 'powTimeout' | 'powUnsupported' | 'powFailed' | null
/** Lo que se le cuenta al visitante cuando algo no sale. `until` solo existe para el cupo diario. */
type Problem = { kind: 'unavailable' | 'limit' | 'rateLimit' | 'badOutput' | 'timeout' | 'providerDown' | 'network' | 'other'; until?: Date }

const TEMPLATE_KEYS: Record<DemoTemplateId, { label: MessageKey; hint: MessageKey }> = {
  shop: { label: 'demo.source.shop', hint: 'demo.source.shopHint' },
  blog: { label: 'demo.source.blog', hint: 'demo.source.blogHint' },
  users: { label: 'demo.source.users', hint: 'demo.source.usersHint' },
}

const PROBLEM_TEXT: Record<Exclude<Problem['kind'], 'unavailable' | 'limit'>, MessageKey> = {
  rateLimit: 'demo.errors.rateLimit',
  badOutput: 'demo.errors.badOutput',
  timeout: 'demo.errors.timeout',
  providerDown: 'demo.errors.providerDown',
  network: 'demo.errors.network',
  other: 'demo.errors.other',
}

const nextUtcMidnight = (): Date => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
}

const clock = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const Demo: React.FC = () => {
  const { t, formatDate, formatNumber } = useI18n()

  const [status, setStatus] = useState<DemoStatus | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [choice, setChoice] = useState<SourceChoice>('shop')
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [notice, setNotice] = useState<Notice>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [result, setResult] = useState<DemoResult | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const [selected, setSelected] = useState(0)
  const [params, setParams] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [mockResponse, setMockResponse] = useState<DemoMockResponse | null>(null)
  const [mockFailed, setMockFailed] = useState(false)

  const powRef = useRef<PowRun | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const cancelledRef = useRef(false)
  const mounted = useRef(true)

  const refreshStatus = useCallback(async () => {
    try {
      const next = await getDemoStatus()
      if (!mounted.current) return
      setStatus(next)
      setRemaining(next.remainingToday)
    } catch {
      // Sin estado fiable no se bloquea nada: el servidor decide al generar
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refreshStatus()
    return () => {
      mounted.current = false
      powRef.current?.cancel()
      abortRef.current?.abort()
    }
  }, [refreshStatus])

  // Cuenta atras de la caducidad: solo corre mientras hay un mock vivo
  const expiresAt = result ? new Date(result.expiresAt).getTime() : null
  useEffect(() => {
    if (expiresAt === null) return undefined
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [expiresAt])
  const msLeft = expiresAt === null ? null : expiresAt - now
  const expired = msLeft !== null && msLeft <= 0

  const textLength = text.length
  const tooLong = textLength > MAX_DEMO_TEXT_CHARS
  const textBlank = choice === 'text' && text.trim().length === 0
  const busy = phase !== 'idle'
  const unavailable = status?.available === false
  const outOfAttempts = remaining === 0

  // Aviso que se ve sin pulsar nada (demo apagada o cupo agotado) o el del ultimo intento fallido
  const view = useMemo<Problem | null>(() => {
    if (problem) return problem
    if (unavailable) return { kind: 'unavailable' }
    if (outOfAttempts) return { kind: 'limit', until: nextUtcMidnight() }
    return null
  }, [problem, unavailable, outOfAttempts])

  const source = (): DemoSource => (choice === 'text' ? { type: 'text', text } : { type: 'template', id: choice })

  const fail = (err: unknown) => {
    if (cancelledRef.current) return
    const kind = err instanceof DemoApiError ? err.kind : 'other'
    if (kind === 'limit') {
      const seconds = err instanceof DemoApiError ? err.retryAfterSeconds : null
      setRemaining(0)
      setProblem({ kind: 'limit', until: seconds ? new Date(Date.now() + seconds * 1000) : nextUtcMidnight() })
    } else if (kind === 'challenge') {
      setProblem({ kind: 'other' })
    } else {
      setProblem({ kind })
    }
    // El servidor sabe cuantos intentos quedan (un 502 o un 504 tambien cuentan); con el cupo agotado ya lo sabemos
    if (kind !== 'limit') void refreshStatus()
  }

  /** Un intento completo: reto nuevo -> prueba de trabajo en el worker -> envio. Un reto invalido se repite una vez. */
  const run = async (attempt: number): Promise<void> => {
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('solving')
    try {
      const challenge = await requestDemoChallenge(controller.signal)
      const pow = runPow(challenge.challenge, challenge.bits)
      powRef.current = pow
      const solved = await pow.promise
      powRef.current = null
      if ('error' in solved) {
        if (solved.error === 'aborted' || cancelledRef.current) throw new DOMException('cancelled', 'AbortError')
        setNotice(solved.error === 'timeout' ? 'powTimeout' : solved.error === 'unsupported' ? 'powUnsupported' : 'powFailed')
        setPhase('idle')
        return
      }
      setPhase('sending')
      const created = await generateDemo({ challenge: challenge.challenge, nonce: solved.nonce, source: source() }, controller.signal)
      if (!mounted.current) return
      setResult(created)
      setRemaining(created.remainingToday)
      setSelected(0)
      setParams({})
      setMockResponse(null)
      setMockFailed(false)
      if (created.remainingToday === null) void refreshStatus()
      setPhase('idle')
    } catch (err) {
      if (!mounted.current) return
      if (cancelledRef.current) {
        setNotice('cancelled')
        setPhase('idle')
        return
      }
      if (err instanceof DemoApiError && err.kind === 'challenge' && attempt === 1) return run(2)
      fail(err)
      setPhase('idle')
    }
  }

  const onGenerate = () => {
    if (busy || tooLong || textBlank || unavailable || outOfAttempts) return
    cancelledRef.current = false
    setNotice(null)
    setProblem(null)
    void run(1)
  }

  const onCancel = () => {
    cancelledRef.current = true
    powRef.current?.cancel()
    abortRef.current?.abort()
  }

  const endpoint = result?.endpoints[selected]
  const names = useMemo(() => (endpoint ? pathParams(endpoint.path) : []), [endpoint])
  const valueOf = (name: string) => params[`${selected}:${name}`] ?? '1'

  const onSend = async () => {
    if (!result || !endpoint || sending) return
    const values = Object.fromEntries(names.map((name) => [name, valueOf(name)]))
    setSending(true)
    setMockFailed(false)
    try {
      setMockResponse(await callDemoMock(result.demoId, endpoint.method, fillPath(endpoint.path, values)))
    } catch {
      setMockResponse(null)
      setMockFailed(true)
    } finally {
      if (mounted.current) setSending(false)
    }
  }

  const clockFormat = (date: Date) => formatDate(date, { hour: 'numeric', minute: '2-digit' })

  const problemBox = view && (
    <div className={styles.problem} role="alert" data-testid="demo-problem">
      {view.kind === 'unavailable' ? (
        <>
          <strong>{t('demo.errors.unavailableTitle')}</strong>
          <p>{t('demo.errors.unavailable')}</p>
        </>
      ) : view.kind === 'limit' ? (
        <p>{t('demo.errors.limit', { time: clockFormat(view.until ?? nextUtcMidnight()) })}</p>
      ) : (
        <p>{t(PROBLEM_TEXT[view.kind])}</p>
      )}
      {(view.kind === 'unavailable' || view.kind === 'limit') && (
        <Link className={styles.linkBtn} to={PATHS.signup}>
          {t('demo.cta.button')}
        </Link>
      )}
    </div>
  )

  return (
    <div className={styles.page} data-testid="demo-page">
      <div className={styles.container}>
        <header className={styles.head}>
          <span className={styles.badge}>{t('demo.badge')}</span>
          <h1>{t('demo.title')}</h1>
          <p>{t('demo.subtitle')}</p>
        </header>

        {/* Cabecera permanente: intentos de hoy y caducidad del mock actual */}
        <ul className={styles.statusBar} aria-label={t('demo.status')}>
          {remaining !== null && <li>{t('demo.attemptsLeft', { count: formatNumber(remaining) })}</li>}
          {msLeft !== null && (
            <li className={expired ? styles.expired : undefined}>
              {expired ? t('demo.expired') : t('demo.expiresIn', { time: clock(msLeft) })}
            </li>
          )}
        </ul>

        <section className={styles.panel} aria-labelledby="demo-source-title">
          <fieldset className={styles.sources} disabled={busy}>
            <legend id="demo-source-title">{t('demo.source.legend')}</legend>
            {DEMO_TEMPLATE_IDS.map((id) => (
              <label key={id} className={styles.sourceCard}>
                <input type="radio" name="demo-source" value={id} checked={choice === id} onChange={() => setChoice(id)} />
                <span className={styles.sourceBody}>
                  <strong>{t(TEMPLATE_KEYS[id].label)}</strong>
                  <span>{t(TEMPLATE_KEYS[id].hint)}</span>
                </span>
              </label>
            ))}
            <label className={styles.sourceCard}>
              <input type="radio" name="demo-source" value="text" checked={choice === 'text'} onChange={() => setChoice('text')} />
              <span className={styles.sourceBody}>
                <strong>{t('demo.source.text')}</strong>
                <span>{t('demo.source.textHint')}</span>
              </span>
            </label>
          </fieldset>

          {choice === 'text' && (
            <div className={styles.textField}>
              <label htmlFor="demo-text">{t('demo.text.label')}</label>
              <textarea
                id="demo-text"
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('demo.text.placeholder')}
                disabled={busy}
                aria-invalid={tooLong}
                aria-describedby="demo-text-counter demo-text-help"
                spellCheck={false}
              />
              <p className={`${styles.counter} ${tooLong ? styles.over : ''}`} id="demo-text-counter">
                {t('demo.text.counter', { used: formatNumber(textLength), max: formatNumber(MAX_DEMO_TEXT_CHARS) })}
              </p>
              <p id="demo-text-help" className={tooLong ? styles.fieldError : styles.hint} role={tooLong ? 'alert' : undefined}>
                {tooLong
                  ? t('demo.text.tooLong', { used: formatNumber(textLength), max: formatNumber(MAX_DEMO_TEXT_CHARS) })
                  : textBlank
                    ? t('demo.text.emptyHint')
                    : ''}
              </p>
            </div>
          )}

          <div className={styles.actions}>
            <button type="button" className={styles.primaryBtn} onClick={onGenerate} disabled={busy || tooLong || textBlank || unavailable || outOfAttempts}>
              {t('demo.generate')}
            </button>
            {phase === 'solving' && (
              <button type="button" className={styles.secondaryBtn} onClick={onCancel}>
                {t('demo.cancel')}
              </button>
            )}
          </div>

          {busy && (
            <div className={styles.progress}>
              <p role="status" aria-live="polite">
                {phase === 'solving' ? t('demo.progress.solving') : t('demo.progress.sending')}
              </p>
              <div className={styles.bar} role="progressbar" aria-label={t('demo.progress.label')}>
                <span />
              </div>
            </div>
          )}
          {notice === 'cancelled' && <p role="status" className={styles.hint}>{t('demo.cancelled')}</p>}
          {notice && notice !== 'cancelled' && (
            <p role="alert" className={styles.problem} data-testid="demo-notice">
              {t(`demo.${notice}`)}
            </p>
          )}
          {problemBox}
        </section>

        {result && (
          <section className={styles.panel} aria-labelledby="demo-result-title">
            <h2 id="demo-result-title">{t('demo.result.title')}</h2>
            <p className={styles.hint}>{t('demo.result.note', { max: status?.maxEndpoints ?? result.endpoints.length, minutes: status?.ttlMinutes ?? 30 })}</p>
            <p className={styles.baseUrl}>
              <span>{t('demo.result.baseUrl')}</span>
              <code>{result.baseUrl}</code>
            </p>

            <div className={styles.workspace}>
              <div>
                <h3>{t('demo.result.endpoints')}</h3>
                <ul className={styles.endpoints} data-testid="demo-endpoint-list">
                  {result.endpoints.map((ep, index) => (
                    <li key={`${ep.method} ${ep.path}`}>
                      <button
                        type="button"
                        className={`${styles.endpointBtn} ${index === selected ? styles.active : ''}`}
                        aria-pressed={index === selected}
                        onClick={() => {
                          setSelected(index)
                          setMockResponse(null)
                          setMockFailed(false)
                        }}
                      >
                        <span className={`${styles.method} ${styles[ep.method] ?? ''}`}>{ep.method}</span>
                        <code>{ep.path}</code>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={styles.tryPanel}>
                <h3>{t('demo.try.title')}</h3>
                {endpoint && (
                  <>
                    <p className={styles.selected}>
                      <span className={styles.hint}>{t('demo.try.selected')}</span>
                      <code>{endpoint.method} {endpoint.path}</code>
                    </p>
                    {names.map((name) => (
                      <label key={name} className={styles.param}>
                        <span>{t('demo.try.param', { name })}</span>
                        <input
                          name={`param-${name}`}
                          value={valueOf(name)}
                          onChange={(e) => setParams((prev) => ({ ...prev, [`${selected}:${name}`]: e.target.value }))}
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </label>
                    ))}
                    <button type="button" className={styles.primaryBtn} onClick={onSend} disabled={sending || expired}>
                      {sending ? t('demo.try.sending') : t('demo.try.send')}
                    </button>
                    {expired && <p className={styles.hint}>{t('demo.try.expired')}</p>}
                    {mockFailed && <p role="alert" className={styles.fieldError}>{t('demo.try.failed')}</p>}
                  </>
                )}

                {mockResponse && (
                  <div className={styles.response} data-testid="demo-response" aria-label={t('demo.try.response')} role="group">
                    <p className={styles.statusLine}>
                      <span>{t('demo.try.status')}</span>
                      <strong className={mockResponse.status < 400 ? styles.ok : styles.bad}>{mockResponse.status}</strong>
                    </p>
                    {mockResponse.headers.length > 0 && (
                      <dl className={styles.headers} aria-label={t('demo.try.headers')}>
                        {mockResponse.headers.map(([name, value]) => (
                          <React.Fragment key={name}>
                            <dt>{name}</dt>
                            <dd>{value}</dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    )}
                    <pre tabIndex={0} aria-label={t('demo.try.body')}>
                      <code>{mockResponse.text}</code>
                    </pre>
                  </div>
                )}
              </div>
            </div>

            <aside className={styles.cta}>
              <h3>{t('demo.cta.title')}</h3>
              <p>{t('demo.cta.text')}</p>
              {/* TODO(B6): conservar el demoId al registrarse cuando el backend lo soporte (reclamar el mock en la cuenta nueva) */}
              <Link className={styles.linkBtn} to={PATHS.signup}>
                {t('demo.cta.button')}
              </Link>
            </aside>
          </section>
        )}
      </div>
    </div>
  )
}

export default Demo
