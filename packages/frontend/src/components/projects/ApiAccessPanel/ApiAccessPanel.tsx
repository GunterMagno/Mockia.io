import React, { useId, useRef, useState } from 'react'
import type { IssuedApiKey, MockVisibility, Project } from '@mockia/shared'
import { MOCK_API_KEY_HEADER } from '@mockia/shared'
import { createApiKey, revokeApiKey, updateProject } from '../../../services/projectService'
import { Icon } from '../../ui/Icon/Icon'
import { useI18n } from '../../../i18n/I18nProvider'
import { playErrorSound } from '../../../utils/audio'
import copyIcon from '../../../assets/copy.svg'
import checkIcon from '../../../assets/check.svg'
import styles from './ApiAccessPanel.module.scss'

type Props = {
  project: Project
  /** Owner: can create, rotate and revoke the key. */
  canManageKey: boolean
  /** Owner or editor: can switch the visibility. */
  canChangeVisibility: boolean
  onUpdate: (project: Project) => void
}

type Busy = 'visibility' | 'key' | 'revoke' | null

/**
 * "API access" of a project: who can call the mock (public / API key) and the key itself.
 * The full key only exists in memory right after it is created or rotated; the server keeps just its hash.
 */
export const ApiAccessPanel: React.FC<Props> = ({ project, canManageKey, canChangeVisibility, onUpdate }) => {
  const { t } = useI18n()
  const uid = useId()
  const [busy, setBusy] = useState<Busy>(null)
  const [issued, setIssued] = useState<IssuedApiKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [live, setLive] = useState('')
  const [error, setError] = useState('')
  const keyInput = useRef<HTMLInputElement>(null)

  const visibility: MockVisibility = project.visibility === 'key' ? 'key' : 'public'
  const modeName = (v: MockVisibility) => (v === 'key' ? t('apiAccess.keyed') : t('apiAccess.public'))
  const keyDisabled = !project.hasApiKey

  const fail = (message: string) => {
    setError(message)
    setLive('')
    playErrorSound()
  }

  const changeVisibility = async (next: MockVisibility) => {
    if (next === visibility || busy) return
    setBusy('visibility')
    setError('')
    try {
      const updated = await updateProject(project.id, { visibility: next })
      onUpdate(updated)
      setLive(t('apiAccess.visibilitySaved', { mode: modeName(next) }))
    } catch {
      fail(t('apiAccess.visibilityFailed'))
    } finally {
      setBusy(null)
    }
  }

  const generate = async () => {
    setBusy('key')
    setError('')
    setCopied(false)
    setConfirmRevoke(false)
    try {
      const key = await createApiKey(project.id)
      setIssued(key)
      setLive(t('apiAccess.newKeyLive'))
      // The project DTO only carries the prefix: refresh its flags without ever holding the key in it
      onUpdate({ ...project, hasApiKey: true, apiKeyPrefix: key.prefix })
    } catch {
      fail(t('apiAccess.failed'))
    } finally {
      setBusy(null)
    }
  }

  const revoke = async () => {
    setBusy('revoke')
    setError('')
    try {
      const updated = await revokeApiKey(project.id)
      setIssued(null)
      setConfirmRevoke(false)
      onUpdate(updated)
      setLive(t('apiAccess.revokedLive'))
    } catch {
      fail(t('apiAccess.failed'))
    } finally {
      setBusy(null)
    }
  }

  const copy = async () => {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued.apiKey)
    } catch {
      keyInput.current?.select() // no clipboard permission: leave it selected so Ctrl+C works
      return
    }
    setCopied(true)
    setLive(t('apiAccess.keyCopiedLive'))
    window.setTimeout(() => setCopied(false), 2500)
  }

  return (
    <section className={styles.panel} aria-labelledby={`${uid}-title`}>
      <header className={styles.head}>
        <h4 id={`${uid}-title`}>{t('apiAccess.title')}</h4>
        <p>{t('apiAccess.intro')}</p>
      </header>

      <fieldset className={styles.modes} disabled={!canChangeVisibility || busy === 'visibility'}>
        <legend>{t('apiAccess.visibilityLegend')}</legend>
        <label className={`${styles.mode} ${visibility === 'public' ? styles.selected : ''}`}>
          <input
            type="radio"
            name={`${uid}-visibility`}
            value="public"
            checked={visibility === 'public'}
            onChange={() => void changeVisibility('public')}
            data-testid="visibility-public"
          />
          <span className={styles.modeText}>
            <strong>{t('apiAccess.public')}</strong>
            <span>{t('apiAccess.publicHint')}</span>
          </span>
        </label>
        <label className={`${styles.mode} ${visibility === 'key' ? styles.selected : ''}`}>
          <input
            type="radio"
            name={`${uid}-visibility`}
            value="key"
            checked={visibility === 'key'}
            disabled={keyDisabled && visibility !== 'key'}
            aria-describedby={keyDisabled ? `${uid}-need-key` : undefined}
            onChange={() => void changeVisibility('key')}
            data-testid="visibility-key"
          />
          <span className={styles.modeText}>
            <strong>{t('apiAccess.keyed')}</strong>
            <span>{t('apiAccess.keyedHint', { header: MOCK_API_KEY_HEADER })}</span>
            {keyDisabled && (
              <span id={`${uid}-need-key`} className={styles.needKey}>
                {t('apiAccess.keyNeededToRequire')}
              </span>
            )}
          </span>
        </label>
      </fieldset>
      {!canChangeVisibility && <p className={styles.muted}>{t('apiAccess.readOnly')}</p>}

      <section className={styles.keyBlock} aria-labelledby={`${uid}-key-title`}>
        <h4 id={`${uid}-key-title`}>{t('apiAccess.keyTitle')}</h4>

        {issued ? (
          <article className={styles.reveal} data-testid="new-api-key" role="group" aria-labelledby={`${uid}-new-title`}>
            <strong id={`${uid}-new-title`}>{t('apiAccess.newKeyTitle')}</strong>
            <p className={styles.warning}>
              <span aria-hidden="true">!</span> {t('apiAccess.newKeyWarning')}
            </p>
            <div className={styles.copyRow}>
              <input
                ref={keyInput}
                className={styles.keyField}
                readOnly
                value={issued.apiKey}
                aria-label={t('apiAccess.newKeyTitle')}
                onFocus={(e) => e.currentTarget.select()}
                data-testid="new-api-key-value"
              />
              <button type="button" className={`${styles.copyBtn} ${copied ? styles.copied : ''}`} onClick={() => void copy()} data-testid="api-key-copy">
                <Icon src={copied ? checkIcon : copyIcon} size={16} />
                {copied ? t('common.copied') : t('apiAccess.copyKey')}
              </button>
            </div>
            <button type="button" className={styles.secondaryBtn} onClick={() => setIssued(null)} data-testid="api-key-saved">
              {t('apiAccess.savedIt')}
            </button>
          </article>
        ) : (
          <p className={styles.current} data-testid="api-key-current">
            {project.hasApiKey && project.apiKeyPrefix
              ? t('apiAccess.currentKey', { prefix: project.apiKeyPrefix })
              : t('apiAccess.noKey')}
          </p>
        )}

        <p className={styles.muted}>{t('apiAccess.storedHashed')}</p>

        {visibility === 'key' && !project.hasApiKey && (
          <p className={`${styles.note} ${styles.noteWarn}`}>{t('apiAccess.lockedNote')}</p>
        )}

        {canManageKey ? (
          <div className={styles.actions}>
            <button type="button" className={styles.primaryBtn} onClick={() => void generate()} disabled={busy !== null} data-testid="api-key-generate">
              {busy === 'key' ? t('apiAccess.working') : project.hasApiKey ? t('apiAccess.rotate') : t('apiAccess.generate')}
            </button>
            {project.hasApiKey && !confirmRevoke && (
              <button type="button" className={styles.dangerBtn} onClick={() => setConfirmRevoke(true)} disabled={busy !== null} data-testid="api-key-revoke">
                {t('apiAccess.revoke')}
              </button>
            )}
            {project.hasApiKey && <p className={styles.muted}>{t('apiAccess.rotateWarning')}</p>}
            {confirmRevoke && (
              <div className={styles.confirm} role="group" aria-label={t('apiAccess.revokeConfirm')}>
                <span>
                  <strong>{t('apiAccess.revokeConfirm')}</strong> {t('apiAccess.revokeConfirmText')}
                </span>
                <button type="button" className={styles.dangerSolidBtn} onClick={() => void revoke()} disabled={busy !== null} data-testid="api-key-revoke-confirm">
                  {busy === 'revoke' ? t('apiAccess.working') : t('apiAccess.revokeYes')}
                </button>
                <button type="button" className={styles.secondaryBtn} onClick={() => setConfirmRevoke(false)} disabled={busy !== null}>
                  {t('common.cancel')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className={styles.muted}>{t('apiAccess.ownerOnly')}</p>
        )}
      </section>

      <p className={styles.srOnly} role="status" aria-live="polite" data-testid="api-access-live">
        {live}
      </p>
      {error && (
        <p className={`${styles.note} ${styles.noteError}`} role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
