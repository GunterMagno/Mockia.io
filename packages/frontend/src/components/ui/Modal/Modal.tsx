import React from 'react'
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
  if (!isOpen) return null

  return (
    <article className={styles.overlay} onClick={onClose}>
      <section 
        className={styles.modal} 
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
