import React, { useId, useMemo, useState } from 'react'
import { generateSnippets, MOCK_API_KEY_HEADER, type CodeSnippets } from '@mockia/shared'
import type { EndpointData } from '../../../services/endpointService'
import { Input } from '../../ui/Input/Input'
import { useI18n } from '../../../i18n/I18nProvider'

export interface EndpointInspectorProps {
  endpoint: EndpointData
  onChangeMeta: (updates: Partial<EndpointData>) => void
  readOnly?: boolean
  /** URL publica base del mock (sin el path del endpoint). */
  mockBaseUrl?: string
  /** El proyecto exige clave de API: los fragmentos incluyen la cabecera con un marcador (nunca la clave real). */
  apiKeyRequired?: boolean
}

const LANGS: Array<{ key: keyof CodeSnippets; label: string }> = [
  { key: 'curl', label: 'cURL' },
  { key: 'fetch', label: 'fetch' },
  { key: 'axios', label: 'axios' },
  { key: 'python', label: 'Python' },
]

import styles from './EndpointInspector.module.scss'

export const EndpointInspector: React.FC<EndpointInspectorProps> = ({ endpoint, onChangeMeta, readOnly, mockBaseUrl, apiKeyRequired }) => {
  const { t } = useI18n()
  const uid = useId()
  const [lang, setLang] = useState<keyof CodeSnippets>('curl')
  const [copied, setCopied] = useState(false)
  const snippets = useMemo(
    () => (mockBaseUrl && mockBaseUrl !== '...'
      ? generateSnippets({
          method: endpoint.method,
          url: `${mockBaseUrl}${endpoint.path}`,
          headers: apiKeyRequired ? { [MOCK_API_KEY_HEADER]: t('inspector.keyPlaceholder') } : undefined,
        })
      : null),
    [mockBaseUrl, endpoint.method, endpoint.path, apiKeyRequired, t],
  )
  const copy = () => {
    if (!snippets) return
    navigator.clipboard.writeText(snippets[lang]).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  return (
    <section className={styles.inspector}>
      <header className={styles.header}>
        <h3>{t('inspector.title')}</h3>
      </header>

      <fieldset className={styles.fieldset} disabled={readOnly}>
        <article className={styles.field}>
          <label className={styles.label} htmlFor={`${uid}-method`}>
            {t('inspector.method')}
          </label>
          <select
            id={`${uid}-method`}
            value={endpoint.method} 
            onChange={(e) => onChangeMeta({ method: e.target.value })}
            className={styles.select}
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
            <option value="PATCH">PATCH</option>
          </select>
        </article>

        <Input 
          label={t('inspector.path')}
          value={endpoint.path} 
          onChange={(e) => onChangeMeta({ path: e.target.value })} 
        />

        <Input 
          label={t('inspector.description')}
          value={endpoint.description} 
          onChange={(e) => onChangeMeta({ description: e.target.value })} 
        />

        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 'var(--spacing-3) 0 var(--spacing-2) 0' }} />

        <header className={styles.header}>
          <h4 style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('inspector.simulation')}
          </h4>
        </header>

        <Input 
          label={t('inspector.delay')}
          type="number"
          min={0}
          max={10000}
          placeholder="0"
          value={endpoint.delay_ms || ''} 
          onChange={(e) => onChangeMeta({ delay_ms: Math.max(0, parseInt(e.target.value)) || 0 })} 
        />

        <article className={styles.field}>
          <label className={styles.label} htmlFor={`${uid}-status`}>
            {t('inspector.forceStatus')}
          </label>
          <select
            id={`${uid}-status`}
            value={endpoint.force_status_code || 0} 
            onChange={(e) => onChangeMeta({ force_status_code: parseInt(e.target.value) || 0 })}
            className={styles.select}
          >
            <option value="0">{t('inspector.none')}</option>
            <optgroup label={t('inspector.group2xx')}>
              <option value="200">200 OK</option>
              <option value="201">201 Created</option>
              <option value="204">204 No Content</option>
            </optgroup>
            <optgroup label={t('inspector.group4xx')}>
              <option value="400">400 Bad Request</option>
              <option value="401">401 Unauthorized</option>
              <option value="403">403 Forbidden</option>
              <option value="404">404 Not Found</option>
              <option value="409">409 Conflict</option>
            </optgroup>
            <optgroup label={t('inspector.group5xx')}>
              <option value="500">500 Internal Server Error</option>
              <option value="503">503 Service Unavailable</option>
            </optgroup>
          </select>
        </article>

      </fieldset>

      {snippets && (
        <section className={styles.snippets} aria-label={t('inspector.snippets')}>
          <header className={styles.snippetsHeader}>
            <div role="tablist" className={styles.tabs} aria-label={t('inspector.snippets')}>
              {LANGS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={lang === key}
                  className={`${styles.tab} ${lang === key ? styles.tabActive : ''}`}
                  onClick={() => setLang(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className={styles.copyBtn} onClick={copy}>
              {copied ? t('common.copied') : t('common.copy')}
            </button>
          </header>
          <pre className={styles.code}><code>{snippets[lang]}</code></pre>
        </section>
      )}
    </section>
  )
}

export default EndpointInspector
