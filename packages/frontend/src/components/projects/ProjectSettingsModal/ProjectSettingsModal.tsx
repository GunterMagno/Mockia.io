import React, { useState, useEffect } from 'react'
import { Modal } from '../../ui/Modal/Modal'
import { Icon } from '../../ui/Icon/Icon'
import { updateProject, archiveProject, addProjectMember, removeProjectMember, regenerateApiKey } from '../../../services/projectService'
import type { Project } from '@mockia/shared'
import styles from './ProjectSettingsModal.module.scss'
import warningIcon from '../../../assets/warning.svg'
import copyIcon from '../../../assets/copy.svg'
import checkIcon from '../../../assets/check.svg'
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
  const [inviteRole, setInviteRole] = useState<'EDITOR' | 'VIEWER'>('VIEWER')
  
  const [loading, setLoading] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [error, setError] = useState('')
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  
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
      <div className={styles.container}>
        <header className={styles.header}>
          <h2>Project Settings</h2>
          <div className={styles.tabs}>
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
          </div>
        </header>

        <div className={styles.content}>
          {activeTab === 'general' ? (
            <div className={styles.generalTab}>
              <div className={styles.formGroup}>
                <label>Project Name</label>
                <input 
                  value={title} 
                  onChange={e => setTitle(e.target.value)} 
                  className={styles.input}
                  placeholder="My Awesome Project"
                  disabled={isViewer}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Description</label>
                <input 
                  value={description} 
                  onChange={e => setDescription(e.target.value)} 
                  className={styles.input}
                  placeholder="What is this project about?"
                  disabled={isViewer}
                />
              </div>

              {!isViewer && (
                <div className={styles.dangerZone}>
                  <div className={styles.dangerHeader}>
                    <div className={styles.dangerIcon}>
                      <Icon src={warningIcon} size={32} />
                    </div>
                    <div className={styles.dangerText}>
                      <h4>Danger Zone</h4>
                      <p>Once you delete a project, there is no going back. please be certain</p>
                    </div>
                  </div>
                  
                  {showConfirmDelete ? (
                    <div className={styles.confirmDelete}>
                      <p>Are you absolutely sure?</p>
                      <div className={styles.confirmActions}>
                        <button onClick={handleCancelDelete} className={styles.cancelDeleteBtn}>No, Keep it</button>
                        <button onClick={handleConfirmDelete} className={styles.confirmDeleteBtn} disabled={loading}>
                          {loading ? 'Deleting...' : 'Yes, Delete Project'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={handleDeleteClick} className={styles.deleteBtn} disabled={loading}>
                      Delete Project
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : activeTab === 'members' ? (
            <div className={styles.membersTab}>
              {!isViewer && (
                <div className={styles.inviteSection}>
                  <label>Invite new members</label>
                  <div className={styles.inviteForm}>
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
                  </div>
                </div>
              )}

              <div className={styles.membersList}>
                <h4>ACTIVE MEMBERS ( {project.members.length} )</h4>
                {project.members.map((member) => (
                  <div key={member.userId} className={styles.memberItem}>
                    <div className={styles.memberInfo}>
                      <div className={styles.memberAvatar}>
                        {member.username ? member.username[0].toUpperCase() : 'U'}
                      </div>
                      <div className={styles.memberDetails}>
                        <span className={styles.memberName}>{member.username || 'Unknown User'}</span>
                        <span className={styles.memberEmail}>{member.email || 'No email available'}</span>
                      </div>
                    </div>
                    <div className={styles.memberActions}>
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
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.connectionTab}>
              <div className={styles.apiKeySection}>
                <h4>Project API Key</h4>
                <p>Use this key in the <code>X-Mockia-API-Key</code> header to authenticate your requests.</p>
                <div className={styles.apiKeyDisplay}>
                  <code>{project.apiKey || 'No API Key generated'}</code>
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
                </div>
              </div>

              {!isViewer && (
                <div className={styles.regenerateSection}>
                  <h4>Regenerate API Key</h4>
                  <p>Warning: This will immediately invalidate the current key. Any frontend using the old key will lose access.</p>
                  <button 
                    className={styles.regenerateBtn} 
                    onClick={handleRegenerateKey}
                    disabled={isRegenerating}
                  >
                    {isRegenerating ? 'Regenerating...' : 'Regenerate API Key'}
                  </button>
                </div>
              )}
            </div>
          )}
          {error && <div className={styles.error}>{error}</div>}
        </div>

        <footer className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>{isViewer ? 'Close' : 'Cancel'}</button>
          {!isViewer && (
            <button className={styles.saveBtn} onClick={handleSaveGeneral} disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </footer>
      </div>
    </Modal>
  )
}

export default ProjectSettingsModal
