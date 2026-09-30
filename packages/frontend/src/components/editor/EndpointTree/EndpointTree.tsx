import React from 'react'
import type { EndpointData } from '../../../services/endpointService'

import { Button } from '../../ui/Button/Button'
import { useI18n } from '../../../i18n/I18nProvider'

export interface EndpointTreeProps {
  endpoints: EndpointData[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd?: () => void
  onDelete?: (id: string) => void
}

import styles from './EndpointTree.module.scss'

export const EndpointTree: React.FC<EndpointTreeProps> = ({ endpoints, selectedId, onSelect, onAdd, onDelete }) => {
  const { t } = useI18n()
  return (
    <nav className={styles.nav}>
      <header className={styles.header}>
        <h4>{t('tree.title')}</h4>
        {onAdd && <Button onClick={onAdd} size="sm">{t('tree.newEndpoint')}</Button>}
      </header>
      
      {endpoints.length === 0 && <p className={styles.empty}>{t('tree.empty')}</p>}
      
      {endpoints.map(ep => (
        <article key={ep.id} className={styles.itemWrapper}>
          <button
            onClick={() => onSelect(ep.id)}
            className={`${styles.item} ${selectedId === ep.id ? styles.selected : ''}`}
            aria-current={selectedId === ep.id ? 'true' : undefined}
          >
            <span className={`${styles.method} ${styles[ep.method.toLowerCase()] || ''}`}>
              {ep.method.toUpperCase()}
            </span>
            <span className={styles.path}>
              {ep.path}
            </span>
          </button>
          {onDelete && (
            <button 
              className={styles.deleteBtn}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(ep.id);
              }}
              title={t('tree.delete', { method: ep.method.toUpperCase(), path: ep.path })}
              aria-label={t('tree.delete', { method: ep.method.toUpperCase(), path: ep.path })}
            >
              &times;
            </button>
          )}
        </article>
      ))}
    </nav>
  )
}

export default EndpointTree
