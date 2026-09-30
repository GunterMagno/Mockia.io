import React, { useState, useEffect, useId } from 'react'
import { Modal } from '../../ui/Modal/Modal'
import { getProfile, updateProfile, changePassword } from '../../../services/userService'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { PATHS } from '../../../routes/paths'
import { Input } from '../../ui/Input/Input'
import styles from './ProfileModal.module.scss'
import { playErrorSound } from '../../../utils/audio'
import { getBackendErrorMessage } from '../../../utils/error'
import ModalErrorAlert from '../../ui/ModalErrorAlert/ModalErrorAlert'
import { useI18n } from '../../../i18n/I18nProvider'

type Props = {
  isOpen: boolean
  onClose: () => void
}

const ProfileModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { logout } = useAuth()
  const { t } = useI18n()
  const uid = useId()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState({ type: '', message: '' })

  useEffect(() => {
    if (isOpen) {
      getProfile()
        .then(profile => {
          setUsername(profile.username || '')
          setEmail(profile.email)
          setStatus({ type: '', message: '' })
        })
        .catch(err => console.error('Failed to load profile', err))
    }
  }, [isOpen])

  const handleSave = async () => {
    setLoading(true)
    setStatus({ type: '', message: '' })
    try {
      // Update profile info
      await updateProfile({ username })
      
      // Update password if provided
      if (currentPassword && newPassword) {
        await changePassword({ currentPassword, newPassword })
        setCurrentPassword('')
        setNewPassword('')
      }
      
      setStatus({ type: 'success', message: t('profile.updated') })
      setTimeout(() => {
        setStatus({ type: '', message: '' })
        onClose()
      }, 1500)
    } catch (err: any) {
      setStatus({ type: 'error', message: getBackendErrorMessage(err, t) })
      playErrorSound()
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    navigate(PATHS.home)
    logout()
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} noPadding maxWidth="800px">
      <article className={styles.container}>
        <section className={styles.innerContent}>
          <h2 className={styles.title}>{t('profile.title')}</h2>
          
          <section className={styles.formSection}>
            <article className={styles.formGroup}>
              <label htmlFor={`${uid}-username`}>{t('profile.username')}</label>
              <input 
                id={`${uid}-username`}
                value={username}
                onChange={e => setUsername(e.target.value)}
                className={styles.input}
                placeholder={t('profile.usernamePlaceholder')}
              />
            </article>

            <article className={styles.formGroup}>
              <label htmlFor={`${uid}-email`}>{t('profile.email')}</label>
              <input 
                id={`${uid}-email`}
                value={email}
                readOnly
                className={`${styles.input} ${styles.readOnly}`}
                placeholder={t('auth.emailPlaceholder')}
              />
            </article>

            <fieldset className={styles.passwordGrid}>
              <article className={styles.formGroup}>
                <label htmlFor={`${uid}-current`}>{t('profile.currentPassword')}</label>
                <Input 
                  id={`${uid}-current`}
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  className={styles.input}
                  placeholder={t('profile.currentPassword')}
                  autoComplete="one-time-code"
                />
              </article>
              <article className={styles.formGroup}>
                <label htmlFor={`${uid}-new`}>{t('profile.newPassword')}</label>
                <Input 
                  id={`${uid}-new`}
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className={styles.input}
                  placeholder={t('profile.newPassword')}
                  autoComplete="new-password"
                />
              </article>
            </fieldset>
          </section>

          <Link to={PATHS.billing} className={styles.billingLink} onClick={onClose}>
            <span>{t('billing.title')}</span>
            <span aria-hidden="true">→</span>
          </Link>

          {status.message && status.type === 'error' && (
            <ModalErrorAlert message={status.message} />
          )}

          {status.message && status.type === 'success' && (
            <article className={`${styles.status} ${styles.success}`}>
              {status.message}
            </article>
          )}

          <nav className={styles.actions}>
            <button className={styles.logoutBtn} onClick={handleLogout}>
              {t('profile.logOut')}
            </button>
            <nav className={styles.rightActions}>
              <button className={styles.cancelBtn} onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button 
                className={styles.saveBtn} 
                onClick={handleSave} 
                disabled={loading || (!!newPassword && !currentPassword)}
              >
                {loading ? t('common.saving') : t('common.save')}
              </button>
            </nav>
          </nav>
        </section>
      </article>
    </Modal>
  )
}

export default ProfileModal
