import React, { useEffect, useId, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useI18n } from '../../../i18n/I18nProvider'
import { exportMyData, deleteMyAccount, getProfile, setAiTrainingConsent } from '../../../services/userService'
import { getBackendErrorMessage } from '../../../utils/error'
import { playErrorSound } from '../../../utils/audio'
import { PATHS } from '../../../routes/paths'
import { saveBlob } from '../../../utils/download'
import { Input } from '../Input/Input'
import styles from './AccountData.module.scss'

type Props = {
  /** Email of the signed-in account: the user must type it to confirm the deletion. */
  email: string
  /** Called after the account was deleted and the local session cleared (closes the host modal). */
  onDeleted: () => void
}

/**
 * "Your data" section: download everything stored about the user (GDPR access/portability) and delete the account
 * (GDPR erasure). Deleting asks for the exact email and the password, and says that subscriptions are cancelled.
 */
const AccountData: React.FC<Props> = ({ email, onDeleted }) => {
  const { t } = useI18n()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const uid = useId()
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const emailInputId = `${uid}-confirm-email`

  const [downloading, setDownloading] = useState(false)
  const [downloadStatus, setDownloadStatus] = useState('')
  const [downloadError, setDownloadError] = useState('')

  const [confirming, setConfirming] = useState(false)
  const [typedEmail, setTypedEmail] = useState('')
  const [password, setPassword] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Optional consent to use my AI generations to improve the AI. null = still loading. Off by default.
  const consentTitleId = `${uid}-consent-title`
  const consentDescId = `${uid}-consent-desc`
  const switchRef = useRef<HTMLButtonElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  const [consent, setConsent] = useState<boolean | null>(null)
  const [consentBusy, setConsentBusy] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [consentStatus, setConsentStatus] = useState('')
  const [consentError, setConsentError] = useState('')

  useEffect(() => {
    let alive = true
    getProfile()
      .then((p) => alive && setConsent(p.aiTrainingConsent?.granted === true))
      .catch((err) => {
        if (!alive) return
        setConsentError(getBackendErrorMessage(err, t))
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The withdrawal confirmation takes the focus on its safe option; closing it gives the focus back to the switch
  useEffect(() => {
    if (withdrawing) keepRef.current?.focus()
  }, [withdrawing])

  const changeConsent = async (granted: boolean) => {
    setConsentBusy(true)
    setConsentError('')
    setConsentStatus(t('profile.account.aiConsent.saving'))
    try {
      await setAiTrainingConsent(granted)
      setConsent(granted)
      setWithdrawing(false)
      setConsentStatus(t(granted ? 'profile.account.aiConsent.on' : 'profile.account.aiConsent.off'))
      setTimeout(() => switchRef.current?.focus(), 0)
    } catch (err) {
      setConsentStatus('')
      setConsentError(getBackendErrorMessage(err, t))
      playErrorSound()
    } finally {
      setConsentBusy(false)
    }
  }

  const onSwitch = () => {
    if (consent === null || consentBusy) return
    // Turning it on is immediate; turning it off deletes data, so it asks first
    if (consent) {
      setConsentStatus('')
      setWithdrawing(true)
    } else {
      void changeConsent(true)
    }
  }

  const emailMatches = typedEmail.trim() === email
  const canDelete = confirming && emailMatches && password.length > 0 && !deleting

  // Opening the confirmation moves the focus to its first field; closing it gives the focus back to the button
  useEffect(() => {
    if (confirming) document.getElementById(emailInputId)?.focus()
  }, [confirming, emailInputId])

  const handleDownload = async () => {
    setDownloading(true)
    setDownloadError('')
    setDownloadStatus(t('profile.account.downloading'))
    try {
      const { blob, filename } = await exportMyData()
      saveBlob(blob, filename)
      setDownloadStatus(t('profile.account.downloaded'))
    } catch (err) {
      setDownloadStatus('')
      setDownloadError(getBackendErrorMessage(err, t))
      playErrorSound()
    } finally {
      setDownloading(false)
    }
  }

  const closeConfirmation = () => {
    setConfirming(false)
    setTypedEmail('')
    setPassword('')
    setDeleteError('')
    // after the panel is gone the delete button is rendered again
    setTimeout(() => deleteButtonRef.current?.focus(), 0)
  }

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canDelete) return
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteMyAccount(password)
    } catch (err) {
      setDeleteError(getBackendErrorMessage(err, t))
      playErrorSound()
      setDeleting(false)
      return
    }
    // The server already dropped the account and the refresh cookie: forget the in-memory token and go to the landing
    navigate(PATHS.home, { state: { accountDeleted: true } })
    void logout()
    onDeleted()
  }

  return (
    <section className={styles.section} aria-labelledby={`${uid}-title`}>
      <h3 id={`${uid}-title`} className={styles.title}>{t('profile.account.title')}</h3>
      <p className={styles.intro}>{t('profile.account.intro')}</p>

      <div className={styles.consent} data-ai-consent>
        <div className={styles.consentHead}>
          <h4 id={consentTitleId} className={styles.consentTitle}>{t('profile.account.aiConsent.title')}</h4>
          <button
            type="button"
            ref={switchRef}
            role="switch"
            aria-checked={consent === true}
            aria-labelledby={consentTitleId}
            aria-describedby={consentDescId}
            className={styles.switch}
            disabled={consent === null || consentBusy}
            onClick={onSwitch}
            data-ai-consent-switch
          >
            <span className={styles.switchThumb} aria-hidden="true" />
          </button>
        </div>
        <p id={consentDescId} className={styles.consentDesc}>
          {t('profile.account.aiConsent.description')}{' '}
          <a href={`${PATHS.privacy}#ai-training`} target="_blank" rel="noopener noreferrer">
            {t('profile.account.aiConsent.privacy')}
          </a>
        </p>
        <p className={styles.status} role="status" aria-live="polite">{consentStatus}</p>
        <p className={styles.error} role="alert" aria-live="assertive">{consentError}</p>

        {withdrawing && (
          <div className={styles.confirm} role="group" aria-labelledby={`${uid}-withdraw-title`}>
            <h5 id={`${uid}-withdraw-title`} className={styles.confirmTitle}>{t('profile.account.aiConsent.confirmTitle')}</h5>
            <p className={styles.warning}>{t('profile.account.aiConsent.confirmText')}</p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                ref={keepRef}
                className={styles.cancelBtn}
                onClick={() => {
                  setWithdrawing(false)
                  setTimeout(() => switchRef.current?.focus(), 0)
                }}
                disabled={consentBusy}
              >
                {t('profile.account.aiConsent.keep')}
              </button>
              <button type="button" className={styles.dangerBtn} onClick={() => changeConsent(false)} disabled={consentBusy} data-ai-consent-confirm>
                {consentBusy ? t('profile.account.aiConsent.saving') : t('profile.account.aiConsent.confirm')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={styles.row}>
        <button type="button" className={styles.secondaryBtn} onClick={handleDownload} disabled={downloading}>
          {t('profile.account.download')}
        </button>
        {!confirming && (
          <button
            type="button"
            ref={deleteButtonRef}
            className={styles.dangerOutlineBtn}
            onClick={() => setConfirming(true)}
          >
            {t('profile.account.delete')}
          </button>
        )}
      </div>

      <p className={styles.status} role="status" aria-live="polite">{downloadStatus}</p>
      <p className={styles.error} role="alert" aria-live="assertive">{downloadError}</p>

      {confirming && (
        <form className={styles.confirm} onSubmit={handleDelete} aria-labelledby={`${uid}-confirm-title`} noValidate>
          <h4 id={`${uid}-confirm-title`} className={styles.confirmTitle}>{t('profile.account.deleteTitle')}</h4>
          <p className={styles.warning}>{t('profile.account.warning')}</p>
          <Input
            id={emailInputId}
            label={t('profile.account.emailLabel', { email })}
            name="confirm-email"
            type="text"
            value={typedEmail}
            onChange={(e) => setTypedEmail(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
          />
          <Input
            label={t('profile.account.passwordLabel')}
            name="delete-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <p className={styles.error} role="alert" aria-live="assertive">{deleteError}</p>
          <div className={styles.confirmActions}>
            <button type="button" className={styles.cancelBtn} onClick={closeConfirmation} disabled={deleting}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={styles.dangerBtn} disabled={!canDelete}>
              {deleting ? t('profile.account.deleting') : t('profile.account.confirm')}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

/**
 * One-off confirmation on the landing after an account deletion (navigation state `accountDeleted`).
 * The state is consumed at once so a reload does not show it again.
 */
export const AccountDeletedNotice: React.FC = () => {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if ((location.state as { accountDeleted?: boolean } | null)?.accountDeleted) {
      setVisible(true)
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.state, location.pathname, navigate])

  if (!visible) return null

  return (
    <div className={styles.deletedNotice} role="status" aria-live="polite" data-account-deleted>
      <span>{t('profile.account.deletedNotice')}</span>
      <button type="button" onClick={() => setVisible(false)} aria-label={t('profile.account.dismissNotice')}>
        &times;
      </button>
    </div>
  )
}

export default AccountData
