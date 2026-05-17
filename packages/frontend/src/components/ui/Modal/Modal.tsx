import React, { useEffect, useState } from 'react'
import styles from './Modal.module.scss'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  noPadding?: boolean
  maxWidth?: string
}

export const Modal: React.FC<ModalProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  noPadding, 
  maxWidth = '600px' 
}) => {
  const [shouldRender, setShouldRender] = useState(isOpen)
  const [isAnimating, setIsAnimating] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
      const timer = setTimeout(() => setIsAnimating(true), 10)
      return () => clearTimeout(timer)
    } else {
      setIsAnimating(false)
      const timer = setTimeout(() => setShouldRender(false), 200)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  if (!shouldRender) return null

  return (
    <article className={`${styles.overlay} ${isAnimating ? styles.active : ''}`} onClick={onClose}>
      <section 
        className={`${styles.modal} ${isAnimating ? styles.active : ''}`} 
        style={{ '--modal-width': maxWidth } as React.CSSProperties} 
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <header className={styles.header}>
            <h2 className={styles.title}>{title}</h2>
            <button className={styles.closeBtn} onClick={onClose}>&times;</button>
          </header>
        )}
        <section className={noPadding ? '' : styles.body}>{children}</section>
      </section>
    </article>
  )
}

export default Modal
