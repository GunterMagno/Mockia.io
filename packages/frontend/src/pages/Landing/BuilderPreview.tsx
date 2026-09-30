import React, { useId, useState } from 'react'
import styles from './BuilderPreview.module.scss'
import { useI18n } from '../../i18n/I18nProvider'

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const
type Method = (typeof METHODS)[number]

const STATUSES: { code: number; label: string }[] = [
  { code: 200, label: '200 OK' },
  { code: 201, label: '201 Created' },
  { code: 204, label: '204 No Content' },
  { code: 400, label: '400 Bad Request' },
  { code: 404, label: '404 Not Found' },
  { code: 500, label: '500 Internal Server Error' },
]

const BASE_URL = 'api.mockia.io/v1/projects/alpha'
const MAX_DELAY = 10000

/**
 * Vista previa interactiva del inspector de endpoints de la landing.
 * Solo estado local: no llama a ninguna API ni comparte codigo con el editor.
 */
const BuilderPreview: React.FC = () => {
  const uid = useId()
  const { t } = useI18n()
  const [method, setMethod] = useState<Method>('GET')
  const [path, setPath] = useState('/users/me')
  const [delay, setDelay] = useState(12)
  const [status, setStatus] = useState(200)

  const cleanPath = '/' + path.trim().replace(/^\/+/, '')
  const statusLabel = STATUSES.find((s) => s.code === status)?.label ?? String(status)
  const isError = status >= 400

  const onDelay = (value: string) => {
    const n = Number(value)
    setDelay(Number.isFinite(n) ? Math.min(MAX_DELAY, Math.max(0, Math.round(n))) : 0)
  }

  return (
    <div className={styles.builderWrap}>
    <div className={styles.builder}>
      <form className={styles.form} onSubmit={(e) => e.preventDefault()} aria-label={t('landing.builder.formLabel')}>
        <div className={styles.field}>
          <label htmlFor={`${uid}-method`}>{t('landing.builder.method')}</label>
          <select id={`${uid}-method`} value={method} onChange={(e) => setMethod(e.target.value as Method)}>
            {METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor={`${uid}-path`}>{t('landing.builder.path')}</label>
          <input
            id={`${uid}-path`}
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={path}
            maxLength={80}
            onChange={(e) => setPath(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor={`${uid}-delay`}>{t('landing.builder.delay')}</label>
          <input
            id={`${uid}-delay`}
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_DELAY}
            step={10}
            value={delay}
            onChange={(e) => onDelay(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor={`${uid}-status`}>{t('landing.builder.status')}</label>
          <select id={`${uid}-status`} value={status} onChange={(e) => setStatus(Number(e.target.value))}>
            {STATUSES.map((s) => (
              <option key={s.code} value={s.code}>{s.label}</option>
            ))}
          </select>
        </div>
      </form>

      <figure className={styles.preview}>
        <figcaption className={styles.previewBar}>
          <span className={`${styles.method} ${styles[method.toLowerCase()]}`}>{method}</span>
          <span className={styles.url} title={`${BASE_URL}${cleanPath}`}>{BASE_URL}{cleanPath}</span>
        </figcaption>
        <pre className={styles.body} aria-live="polite">
          <code>
            {'{'}{'\n'}
            {'  '}<span className={styles.key}>"status"</span>: <span className={isError ? styles.bad : styles.ok}>{status}</span>,{'\n'}
            {'  '}<span className={styles.key}>"latency"</span>: <span className={styles.str}>"{delay}ms"</span>{'\n'}
            {'}'}
          </code>
        </pre>
        <div className={styles.previewFoot}>
          <span className={styles.method}>{method}</span>
          <span className={isError ? styles.badge + ' ' + styles.badgeBad : styles.badge}>{statusLabel}</span>
          <span className={styles.badge}>{delay}ms</span>
        </div>
      </figure>
    </div>
    </div>
  )
}

export default BuilderPreview
