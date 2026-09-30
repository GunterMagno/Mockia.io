import React, { useState, useEffect, useId } from 'react'
import { Modal } from '../../ui/Modal/Modal'
import { Icon } from '../../ui/Icon/Icon'
import { updateProject, archiveProject, addProjectMember, removeProjectMember, regenerateApiKey, leaveProject } from '../../../services/projectService'
import type { Project } from '@mockia/shared'
import styles from './ProjectSettingsModal.module.scss'
import warningIcon from '../../../assets/warning.svg'
import copyIcon from '../../../assets/copy.svg'
import checkIcon from '../../../assets/check.svg'
import eyeIcon from '../../../assets/eye.svg'
import eyeOffIcon from '../../../assets/eye-off.svg'
import githubIcon from '../../../assets/github.svg'
import externalLinkIcon from '../../../assets/external-link.svg'
import { playErrorSound } from '../../../utils/audio'
import ModalErrorAlert from '../../ui/ModalErrorAlert/ModalErrorAlert'
import { useI18n } from '../../../i18n/I18nProvider'

type Props = {
  isOpen: boolean
  onClose: () => void
  project: Project
  isViewer?: boolean
  onUpdate: (p: Project) => void
  onDelete: () => void
}

type Tab = 'general' | 'members' | 'connection'

const ProjectSettingsModal: React.FC<Props> = ({ isOpen, onClose, project, isViewer = false, onUpdate, onDelete }) => {
  const { t, rich } = useI18n()
  const uid = useId()
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const [title, setTitle] = useState(project.title)
  const [description, setDescription] = useState(project.description || '')
  
  // Member invite state
  const [inviteEmail, setInviteEmail] = useState('')
  const [copiedKey, setCopiedKey] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [inviteRole, setInviteRole] = useState<'EDITOR' | 'VIEWER'>('VIEWER')

  
  const [loading, setLoading] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [error, setError] = useState('')
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [showConfirmLeave, setShowConfirmLeave] = useState(false)
  
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // Get current user ID from token
  useEffect(() => {
    const token = localStorage.getItem('mockia_token')
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        setCurrentUserId(payload.sub)
      } catch (e) {
        console.error("Error decoding token:", e)
      }
    }
  }, [])

  const handleSaveGeneral = async () => {
    setLoading(true)
    setError('')
    try {
      const updated = await updateProject(project.id, { title, description })
      onUpdate(updated)
      onClose()
    } catch (err: any) {
      setError(t('projectSettings.updateFailed'))
      playErrorSound()
    } finally {
      setLoading(false)
    }
  }
  
  const handleDeleteClick = () => {
    setShowConfirmDelete(true)
  }

  const handleCancelDelete = () => {
    setShowConfirmDelete(false)
  }

  const handleConfirmDelete = async () => {
    setLoading(true)
    try {
      await archiveProject(project.id)
      onDelete()
      onClose()
    } catch (err: any) {
      setError(t('projectSettings.deleteFailed'))
      playErrorSound()
    } finally {
      setLoading(false)
      setShowConfirmDelete(false)
    }
  }

  const handleLeaveClick = () => {
    setShowConfirmLeave(true)
  }

  const handleCancelLeave = () => {
    setShowConfirmLeave(false)
  }

  const handleConfirmLeave = async () => {
    setLoading(true)
    setError('')
    try {
      await leaveProject(project.id)
      onDelete() // Navigates to dashboard
      onClose()
    } catch (err: any) {
      setError(t('projectSettings.leaveFailed'))
      playErrorSound()
    } finally {
      setLoading(false)
      setShowConfirmLeave(false)
    }
  }

  const handleInvite = async () => {
    if (!inviteEmail) return
    setLoading(true)
    setError('')
    try {
      const updated = await addProjectMember(project.id, inviteEmail, inviteRole)
      onUpdate(updated)
      setInviteEmail('')
    } catch (err: any) {
      setError(t('projectSettings.inviteFailed'))
      playErrorSound()
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    setLoading(true)
    try {
      const updated = await removeProjectMember(project.id, userId)
      onUpdate(updated)
    } catch (err: any) {
      setError(t('projectSettings.removeFailed'))
      playErrorSound()
    } finally {
      setLoading(false)
    }
  }

  const handleRegenerateKey = async () => {
    setIsRegenerating(true)
    setError('')
    try {
      const updated = await regenerateApiKey(project.id)
      onUpdate(updated)
    } catch (err: any) {
      setError(t('projectSettings.regenerateFailed'))
      playErrorSound()
    } finally {
      setIsRegenerating(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} noPadding maxWidth="800px">
      <article className={styles.container}>
        <header className={styles.header}>
          <h2>{t('projectSettings.title')}</h2>
          <nav className={styles.tabs} aria-label={t('projectSettings.tabs')}>
            <button 
              className={`${styles.tab} ${activeTab === 'general' ? styles.active : ''}`}
              onClick={() => setActiveTab('general')}
              aria-current={activeTab === 'general' ? 'page' : undefined}
            >
              {t('projectSettings.general')}
            </button>
            <button 
              className={`${styles.tab} ${activeTab === 'members' ? styles.active : ''}`}
              onClick={() => setActiveTab('members')}
              aria-current={activeTab === 'members' ? 'page' : undefined}
            >
              {t('projectSettings.members')}
            </button>
            <button 
              className={`${styles.tab} ${activeTab === 'connection' ? styles.active : ''}`}
              onClick={() => setActiveTab('connection')}
              aria-current={activeTab === 'connection' ? 'page' : undefined}
            >
              {t('projectSettings.connection')}
            </button>
          </nav>
        </header>

        <section className={styles.content}>
          {activeTab === 'general' ? (
            <section className={styles.generalTab}>
              <article className={styles.formGroup}>
                <label htmlFor={`${uid}-name`}>{t('projectSettings.name')}</label>
                <input
                  id={`${uid}-name`}
                  value={title} 
                  onChange={e => setTitle(e.target.value)} 
                  className={styles.input}
                  placeholder={t('projectSettings.namePlaceholder')}
                  disabled={isViewer}
                />
              </article>
              <article className={styles.formGroup}>
                <label htmlFor={`${uid}-description`}>{t('projectSettings.description')}</label>
                <input
                  id={`${uid}-description`}
                  value={description} 
                  onChange={e => setDescription(e.target.value)} 
                  className={styles.input}
                  placeholder={t('projectSettings.descriptionPlaceholder')}
                  disabled={isViewer}
                />
              </article>

              {project.gitHubRepo && (
                <article className={styles.formGroup}>
                  <label htmlFor={`${uid}-repo`}>{t('projectSettings.githubRepo')}</label>
                  <article className={styles.githubBox}>
                    <Icon src={githubIcon} size={30} className={styles.githubIconColor} />
                    <input
                      id={`${uid}-repo`}
                      type="text"
                      readOnly 
                      value={project.gitHubRepo.url} 
                      className={styles.githubInput}
                    />
                    <button 
                      type="button"
                      onClick={() => window.open(project.gitHubRepo?.url, '_blank', 'noopener,noreferrer')}
                      className={styles.githubLinkBtn}
                      title={t('projectSettings.openOnGithub')}
                    >
                      <Icon src={externalLinkIcon} size={16} />
                      <span>{t('projectSettings.openRepo')}</span>
                    </button>
                  </article>
                </article>
              )}

              {project.ownerId !== currentUserId ? (
                <section className={styles.dangerZone}>
                  <header className={styles.dangerHeader}>
                    <figure className={styles.dangerIcon}>
                      <Icon src={warningIcon} size={32} />
                    </figure>
                    <article className={styles.dangerText}>
                      <h4>{t('projectSettings.leaveTitle')}</h4>
                      <p>{t('projectSettings.leaveText')}</p>
                    </article>
                  </header>
                  
                  {showConfirmLeave ? (
                    <article className={styles.confirmDelete}>
                      <p>{t('projectSettings.leaveConfirm')}</p>
                      <nav className={styles.confirmActions}>
                        <button onClick={handleCancelLeave} className={styles.cancelLeaveBtn}>{t('projectSettings.stay')}</button>
                        <button onClick={handleConfirmLeave} className={styles.confirmDeleteBtn} disabled={loading}>
                          {loading ? t('projectSettings.leaving') : t('projectSettings.confirmLeave')}
                        </button>
                      </nav>
                    </article>
                  ) : (
                    <button onClick={handleLeaveClick} className={styles.deleteBtn} disabled={loading}>
                      {t('projectSettings.leaveTitle')}
                    </button>
                  )}
                </section>
              ) : (
                !isViewer && (
                  <section className={styles.dangerZone}>
                    <header className={styles.dangerHeader}>
                      <figure className={styles.dangerIcon}>
                        <Icon src={warningIcon} size={32} />
                      </figure>
                      <article className={styles.dangerText}>
                        <h4>{t('projectSettings.dangerTitle')}</h4>
                        <p>{t('projectSettings.dangerText')}</p>
                      </article>
                    </header>
                    
                    {showConfirmDelete ? (
                      <article className={styles.confirmDelete}>
                        <p>{t('projectSettings.deleteConfirm')}</p>
                        <nav className={styles.confirmActions}>
                          <button onClick={handleCancelDelete} className={styles.cancelDeleteBtn}>{t('projectSettings.keep')}</button>
                          <button onClick={handleConfirmDelete} className={styles.confirmDeleteBtn} disabled={loading}>
                            {loading ? t('common.deleting') : t('projectSettings.confirmDelete')}
                          </button>
                        </nav>
                      </article>
                    ) : (
                      <button onClick={handleDeleteClick} className={styles.deleteBtn} disabled={loading}>
                        {t('projectSettings.deleteProject')}
                      </button>
                    )}
                  </section>
                )
              )}
            </section>
          ) : activeTab === 'members' ? (
            <section className={styles.membersTab}>
              {!isViewer && (
                <section className={styles.inviteSection}>
                  <label htmlFor={`${uid}-invite`}>{t('projectSettings.invite')}</label>
                  <article className={styles.inviteForm}>
                    <input
                      id={`${uid}-invite`}
                      type="email" 
                      value={inviteEmail} 
                      onChange={e => setInviteEmail(e.target.value)}
                      placeholder="user@example.com"
                      className={styles.input}
                    />
                    <select
                      aria-label={t('projectSettings.inviteRole')}
                      value={inviteRole} 
                      onChange={e => setInviteRole(e.target.value as any)}
                      className={styles.select}
                    >
                      <option value="VIEWER">{t('projectSettings.roleViewer')}</option>
                      <option value="EDITOR">{t('projectSettings.roleEditor')}</option>
                    </select>
                    <button onClick={handleInvite} className={styles.inviteBtn} disabled={loading || !inviteEmail}>
                      {t('projectSettings.inviteButton')}
                    </button>
                  </article>
                </section>
              )}

              <section className={styles.membersList}>
                <h4>{t('projectSettings.activeMembers', { count: project.members.length })}</h4>
                {project.members.map((member) => (
                  <article key={member.userId} className={styles.memberItem}>
                    <article className={styles.memberInfo}>
                      <figure className={styles.memberAvatar} aria-hidden="true">
                        {member.username ? member.username[0].toUpperCase() : 'U'}
                      </figure>
                      <article className={styles.memberDetails}>
                        <span className={styles.memberName}>{member.username || t('projectSettings.unknownUser')}</span>
                        <span className={styles.memberEmail}>{member.email || t('projectSettings.noEmail')}</span>
                      </article>
                    </article>
                    <nav className={styles.memberActions}>
                      <span className={`${styles.roleBadge} ${styles[member.role]}`}>
                        {member.role === 'OWNER' ? t('projectSettings.roleOwner') : member.role === 'EDITOR' ? t('projectSettings.roleEditor') : t('projectSettings.roleViewer')}
                      </span>
                      {member.role !== 'OWNER' && member.userId !== currentUserId && !isViewer && (
                        <button 
                          onClick={() => handleRemoveMember(member.userId)} 
                          className={styles.removeBtn}
                          title={t('projectSettings.removeMember')}
                          aria-label={`${t('projectSettings.removeMember')}: ${member.username || member.email || ''}`}
                        >
                          &times;
                        </button>
                      )}
                    </nav>
                  </article>
                ))}
              </section>
            </section>
          ) : (
            <section className={styles.connectionTab}>
              <section className={styles.apiKeySection}>
                <h4>{t('projectSettings.apiKeyTitle')}</h4>
                <p>{rich('projectSettings.apiKeyText', { code: (chunk) => <code>{chunk}</code> })}</p>
                <article className={styles.apiKeyDisplay}>
                  <article className={styles.apiKeyBox}>
                    <code>
                      {showApiKey 
                        ? (project.apiKey || t('projectSettings.noApiKey'))
                        : (project.apiKey ? '•'.repeat(project.apiKey.length) : t('projectSettings.noApiKey'))}
                    </code>
                    <button 
                      className={styles.toggleBtn}
                      onClick={() => setShowApiKey(!showApiKey)}
                      title={showApiKey ? t('common.hideApiKey') : t('common.showApiKey')}
                      aria-label={showApiKey ? t('common.hideApiKey') : t('common.showApiKey')}
                    >
                      <Icon src={showApiKey ? eyeOffIcon : eyeIcon} size={16} />
                    </button>
                  </article>
                  <button 
                    className={`${styles.copyBtn} ${copiedKey ? styles.copied : ''}`} 
                    onClick={() => {
                      if (project.apiKey) {
                        navigator.clipboard.writeText(project.apiKey)
                        setCopiedKey(true)
                        setTimeout(() => setCopiedKey(false), 2000)
                      }
                    }}
                  >
                    <Icon src={copiedKey ? checkIcon : copyIcon} size={16} />
                    {copiedKey ? t('common.copied') : t('common.copy')}
                  </button>
                </article>
              </section>

              {!isViewer && (
                <section className={styles.regenerateSection}>
                  <h4>{t('projectSettings.regenerateTitle')}</h4>
                  <p>{t('projectSettings.regenerateText')}</p>
                  <button 
                    className={styles.regenerateBtn} 
                    onClick={handleRegenerateKey}
                    disabled={isRegenerating}
                  >
                    {isRegenerating ? t('projectSettings.regenerating') : t('projectSettings.regenerate')}
                  </button>
                </section>
              )}
            </section>
          )}
          <ModalErrorAlert message={error} />
        </section>

        <footer className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>{isViewer ? t('common.close') : t('common.cancel')}</button>
          {!isViewer && (
            <button className={styles.saveBtn} onClick={handleSaveGeneral} disabled={loading}>
              {loading ? t('common.saving') : t('common.saveChanges')}
            </button>
          )}
        </footer>
      </article>
    </Modal>
  )
}

export default ProjectSettingsModal
