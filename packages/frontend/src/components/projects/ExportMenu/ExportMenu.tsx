import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../../../i18n/I18nProvider'
import type { MessageKey } from '../../../i18n/I18nProvider'
import { exportProject, type ExportFormat } from '../../../services/projectService'
import { getBackendErrorMessage } from '../../../utils/error'
import { saveBlob } from '../../../utils/download'
import { playErrorSound } from '../../../utils/audio'
import { Icon } from '../../ui/Icon/Icon'
import downloadIcon from '../../../assets/download.svg'
import styles from './ExportMenu.module.scss'

type Props = {
  /** Project id or slug (the backend accepts both). The menu is disabled until it is known. */
  projectId: string | undefined
}

const ITEMS: ReadonlyArray<{ format: ExportFormat; label: MessageKey; hint: MessageKey }> = [
  { format: 'openapi', label: 'projectExport.openapi', hint: 'projectExport.openapiHint' },
  { format: 'postman', label: 'projectExport.postman', hint: 'projectExport.postmanHint' },
  { format: 'msw', label: 'projectExport.msw', hint: 'projectExport.mswHint' },
]

/**
 * "Export" button with a menu of formats (OpenAPI, Postman collection, MSW handlers). Every project member can use it.
 * Accessible menu button: aria-haspopup/expanded, arrow keys / Home / End move between items, Escape closes and returns
 * the focus to the button, Tab or a click outside closes it. The download is an authenticated blob request.
 */
const ExportMenu: React.FC<Props> = ({ projectId }) => {
  const { t } = useI18n()
  const uid = useId()
  const buttonId = `${uid}-button`
  const menuId = `${uid}-menu`
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const focusItem = useCallback((index: number) => {
    const count = ITEMS.length
    itemRefs.current[((index % count) + count) % count]?.focus()
  }, [])

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }, [])

  // Opening moves the focus to the first item
  useEffect(() => {
    if (open) focusItem(0)
  }, [open, focusItem])

  // A click or touch outside closes the menu (without stealing the focus from what the user clicked)
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [open])

  const handleButtonKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) setOpen(true)
      else focusItem(e.key === 'ArrowDown' ? 0 : ITEMS.length - 1)
    }
  }

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement)
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusItem(current + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        focusItem(current - 1)
        break
      case 'Home':
        e.preventDefault()
        focusItem(0)
        break
      case 'End':
        e.preventDefault()
        focusItem(ITEMS.length - 1)
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        close(true)
        break
      case 'Tab':
        // the menu is a single tab stop: leaving it closes it and lets the browser move on
        setOpen(false)
        break
    }
  }

  const handleExport = async (format: ExportFormat) => {
    if (!projectId || busy) return
    close(true)
    setBusy(format)
    setError('')
    setStatus(t('projectExport.preparing'))
    try {
      const { blob, filename } = await exportProject(projectId, format)
      saveBlob(blob, filename)
      setStatus(t('projectExport.done', { file: filename }))
    } catch (err) {
      setStatus('')
      setError(t('projectExport.failed', { message: getBackendErrorMessage(err, t) }))
      playErrorSound()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={!projectId || busy !== null}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleButtonKeyDown}
      >
        <Icon src={downloadIcon} size={18} />
        {busy ? t('projectExport.exporting') : t('projectExport.button')}
      </button>

      {open && (
        <ul id={menuId} role="menu" aria-labelledby={buttonId} className={styles.menu} onKeyDown={handleMenuKeyDown}>
          {ITEMS.map((item, i) => (
            <li key={item.format} role="none">
              <button
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={styles.item}
                data-format={item.format}
                onClick={() => handleExport(item.format)}
              >
                <span className={styles.itemLabel}>{t(item.label)}</span>
                <span className={styles.itemHint}>{t(item.hint)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Live regions exist before their content so screen readers announce it */}
      <span role="status" className="sr-only">{status}</span>
      <p role="alert" className={error ? styles.error : 'sr-only'}>{error}</p>
    </div>
  )
}

export { ExportMenu }
export default ExportMenu
