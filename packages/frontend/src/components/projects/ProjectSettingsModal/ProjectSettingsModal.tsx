import React, { useState, useEffect } from 'react'
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
import { playErrorSound } from '../../../utils/audio'

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
      setError('Failed to update project')
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
      setError('Failed to delete project')
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
      setError('Failed to leave project')
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
      setError('Failed to invite member. Make sure the user exists.')
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
      setError('Failed to remove member')
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
      setError('Failed to regenerate API Key')
      playErrorSound()
    } finally {
      setIsRegenerating(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} noPadding maxWidth="800px">
      <article className={styles.container}>
        <header className={styles.header}>
          <h2>Project Settings</h2>
          <nav className={styles.tabs}>
            <button 
              className={`${styles.tab} ${activeTab === 'general' ? styles.active : ''}`}
              onClick={() => setActiveTab('general')}
            >
              General
            </button>
            <button 
              className={`${styles.tab} ${activeTab === 'members' ? styles.active : ''}`}
              onClick={() => setActiveTab('members')}
            >
              Members
            </button>
            <button 
              className={`${styles.tab} ${activeTab === 'connection' ? styles.active : ''}`}
              onClick={() => setActiveTab('connection')}
            >
              Connection
            </button>
          </nav>
        </header>

        <section className={styles.content}>
          {activeTab === 'general' ? (
            <section className={styles.generalTab}>
              <article className={styles.formGroup}>
                <label>Project Name</label>
                <input 
                  value={title} 
                  onChange={e => setTitle(e.target.value)} 
                  className={styles.input}
                  placeholder="My Awesome Project"
                  disabled={isViewer}
                />
              </article>
              <article className={styles.formGroup}>
                <label>Description</label>
                <input 
                  value={description} 
                  onChange={e => setDescription(e.target.value)} 
                  className={styles.input}
                  placeholder="What is this project about?"
                  disabled={isViewer}
                />
              </article>

              {project.ownerId !== currentUserId ? (
                <section className={styles.dangerZone}>
                  <header className={styles.dangerHeader}>
                    <figure className={styles.dangerIcon}>
                      <Icon src={warningIcon} size={32} />
                    </figure>
                    <article className={styles.dangerText}>
                      <h4>Leave Project</h4>
                      <p>Once you leave the project, you will lose all access. The owner must invite you again for access.</p>
                    </article>
                  </header>
                  
                  {showConfirmLeave ? (
                    <article className={styles.confirmDelete}>
                      <p>Are you absolutely sure you want to leave this project?</p>
                      <nav className={styles.confirmActions}>
                        <button onClick={handleCancelLeave} className={styles.cancelLeaveBtn}>No, Stay</button>
                        <button onClick={handleConfirmLeave} className={styles.confirmDeleteBtn} disabled={loading}>
                          {loading ? 'Leaving...' : 'Yes, Leave Project'}
                        </button>
                      </nav>
                    </article>
                  ) : (
                    <button onClick={handleLeaveClick} className={styles.deleteBtn} disabled={loading}>
                      Leave Project
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
                        <h4>Danger Zone</h4>
                        <p>Once you delete a project, there is no going back. please be certain</p>
                      </article>
                    </header>
                    
                    {showConfirmDelete ? (
                      <article className={styles.confirmDelete}>
                        <p>Are you absolutely sure?</p>
                        <nav className={styles.confirmActions}>
                          <button onClick={handleCancelDelete} className={styles.cancelDeleteBtn}>No, Keep it</button>
                          <button onClick={handleConfirmDelete} className={styles.confirmDeleteBtn} disabled={loading}>
                            {loading ? 'Deleting...' : 'Yes, Delete Project'}
                          </button>
                        </nav>
                      </article>
                    ) : (
                      <button onClick={handleDeleteClick} className={styles.deleteBtn} disabled={loading}>
                        Delete Project
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
                  <label>Invite new members</label>
                  <article className={styles.inviteForm}>
                    <input 
                      type="email" 
                      value={inviteEmail} 
                      onChange={e => setInviteEmail(e.target.value)}
                      placeholder="user@example.com"
                      className={styles.input}
                    />
                    <select 
                      value={inviteRole} 
                      onChange={e => setInviteRole(e.target.value as any)}
                      className={styles.select}
                    >
                      <option value="VIEWER">Viewer</option>
                      <option value="EDITOR">Editor</option>
                    </select>
                    <button onClick={handleInvite} className={styles.inviteBtn} disabled={loading || !inviteEmail}>
                      Invite
                    </button>
                  </article>
                </section>
              )}

              <section className={styles.membersList}>
                <h4>ACTIVE MEMBERS ( {project.members.length} )</h4>
                {project.members.map((member) => (
                  <article key={member.userId} className={styles.memberItem}>
                    <article className={styles.memberInfo}>
                      <figure className={styles.memberAvatar}>
                        {member.username ? member.username[0].toUpperCase() : 'U'}
                      </figure>
                      <article className={styles.memberDetails}>
                        <span className={styles.memberName}>{member.username || 'Unknown User'}</span>
                        <span className={styles.memberEmail}>{member.email || 'No email available'}</span>
                      </article>
                    </article>
                    <nav className={styles.memberActions}>
                      <span className={`${styles.roleBadge} ${styles[member.role]}`}>
                        {member.role.toUpperCase()}
                      </span>
                      {member.role !== 'OWNER' && member.userId !== currentUserId && !isViewer && (
                        <button 
                          onClick={() => handleRemoveMember(member.userId)} 
                          className={styles.removeBtn}
                          title="Remove member"
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
                <h4>Project API Key</h4>
                <p>Use this key in the <code>X-Mockia-API-Key</code> header to authenticate your requests.</p>
                <article className={styles.apiKeyDisplay}>
                  <article className={styles.apiKeyBox}>
                    <code>
                      {showApiKey 
                        ? (project.apiKey || 'No API Key generated') 
                        : (project.apiKey ? '•'.repeat(project.apiKey.length) : 'No API Key generated')}
                    </code>
                    <button 
                      className={styles.toggleBtn}
                      onClick={() => setShowApiKey(!showApiKey)}
                      title={showApiKey ? 'Hide API Key' : 'Show API Key'}
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
                    {copiedKey ? 'Copied' : 'Copy'}
                  </button>
                </article>
              </section>

              {!isViewer && (
                <section className={styles.regenerateSection}>
                  <h4>Regenerate API Key</h4>
                  <p>Warning: This will immediately invalidate the current key. Any frontend using the old key will lose access.</p>
                  <button 
                    className={styles.regenerateBtn} 
                    onClick={handleRegenerateKey}
                    disabled={isRegenerating}
                  >
                    {isRegenerating ? 'Regenerating...' : 'Regenerate API Key'}
                  </button>
                </section>
              )}
            </section>
          )}
          {error && <span className={styles.error}>{error}</span>}
        </section>

        <footer className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>{isViewer ? 'Close' : 'Cancel'}</button>
          {!isViewer && (
            <button className={styles.saveBtn} onClick={handleSaveGeneral} disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </footer>
      </article>
    </Modal>
  )
}

export default ProjectSettingsModal
