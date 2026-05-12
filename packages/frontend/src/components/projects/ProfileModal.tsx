import React, { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal/Modal'
import { getProfile, updateProfile, changePassword } from '../../services/userService'
import { useAuth } from '../../contexts/AuthContext'
import styles from './ProfileModal.module.scss'

type Props = {
  isOpen: boolean
  onClose: () => void
}

const ProfileModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { logout } = useAuth()
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
      
      setStatus({ type: 'success', message: 'Profile updated successfully!' })
      setTimeout(() => {
        setStatus({ type: '', message: '' })
        onClose()
      }, 1500)
    } catch (err: any) {
      setStatus({ type: 'error', message: err?.response?.data?.message || 'Failed to update profile. Check current password.' })
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    logout()
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} noPadding maxWidth="800px">
      <div className={styles.container}>
        <h2 className={styles.title}>Account Settings</h2>
        
        <div className={styles.formSection}>
          <div className={styles.formGroup}>
            <label>Username</label>
            <input 
              value={username}
              onChange={e => setUsername(e.target.value)}
              className={styles.input}
              placeholder="yourusername"
            />
          </div>

          <div className={styles.formGroup}>
            <label>Email</label>
            <input 
              value={email}
              readOnly
              className={`${styles.input} ${styles.readOnly}`}
              placeholder="your@email.com"
            />
          </div>

          <div className={styles.passwordGrid}>
            <div className={styles.formGroup}>
              <label>Current Password</label>
              <input 
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                className={styles.input}
                placeholder="Current Password"
                autoComplete="one-time-code"
              />
            </div>
            <div className={styles.formGroup}>
              <label>New Password</label>
              <input 
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className={styles.input}
                placeholder="New Password"
                autoComplete="new-password"
              />
            </div>
          </div>
        </div>

        {status.message && (
          <div className={`${styles.status} ${styles[status.type]}`}>
            {status.message}
          </div>
        )}

        <div className={styles.actions}>
          <button className={styles.logoutBtn} onClick={handleLogout}>
            Log Out
          </button>
          <div className={styles.rightActions}>
            <button className={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button 
              className={styles.saveBtn} 
              onClick={handleSave} 
              disabled={loading || (!!newPassword && !currentPassword)}
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default ProfileModal
