import React, { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../../../i18n/I18nProvider'
import styles from './Modal.module.scss'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  noPadding?: boolean
  maxWidth?: string
}

const FOCUSABLE = 'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

/**
 * Dialogo modal accesible: role="dialog" + aria-modal, nombre tomado del titulo (o del primer encabezado
 * del contenido), Escape cierra, el foco entra al abrir y vuelve al elemento que lo abrio al cerrar.
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  noPadding,
  maxWidth = '600px'
}) => {
  const { t } = useI18n()
  const [shouldRender, setShouldRender] = useState(isOpen)
  const [isAnimating, setIsAnimating] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  const titleId = useId()
  // onClose suele ser una funcion nueva en cada render: con un ref el efecto de foco no se repite al teclear
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

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

  useEffect(() => {
    if (!isOpen) return
    const opener = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    const timer = setTimeout(() => {
      const dialog = dialogRef.current
      if (!dialog) return
      if (!title && !dialog.hasAttribute('aria-labelledby')) {
        const heading = dialog.querySelector<HTMLElement>('h1, h2, h3')
        if (heading) {
          heading.id ||= `${titleId}-heading`
          dialog.setAttribute('aria-labelledby', heading.id)
        }
      }
      // Respeta un autoFocus del contenido; si no, primer control o el propio dialogo
      if (!dialog.contains(document.activeElement)) {
        const first = dialog.querySelector<HTMLElement>(FOCUSABLE)
        ;(first ?? dialog).focus()
      }
    }, 20)
    return () => {
      document.removeEventListener('keydown', onKey)
      clearTimeout(timer)
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [isOpen, title, titleId])

  if (!shouldRender) return null

  return (
    <article className={`${styles.overlay} ${isAnimating ? styles.active : ''}`} onClick={onClose}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`${styles.modal} ${isAnimating ? styles.active : ''}`}
        style={{ '--modal-width': maxWidth } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <header className={styles.header}>
            <h2 className={styles.title} id={titleId}>{title}</h2>
            <button className={styles.closeBtn} onClick={onClose} aria-label={t('common.close')}>&times;</button>
          </header>
        )}
        <section className={noPadding ? '' : styles.body}>{children}</section>
      </section>
    </article>
  )
}

export default Modal
