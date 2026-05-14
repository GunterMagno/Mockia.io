import React from 'react'
import type { EndpointData } from '../../services/endpointService'

import { Button } from '../ui/Button/Button'

export interface EndpointTreeProps {
  endpoints: EndpointData[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd?: () => void
  onDelete?: (id: string) => void
}

import styles from './EndpointTree.module.scss'

export const EndpointTree: React.FC<EndpointTreeProps> = ({ endpoints, selectedId, onSelect, onAdd, onDelete }) => {
  return (
    <nav className={styles.nav}>
      <div className={styles.header}>
        <h4>Endpoints</h4>
        {onAdd && <Button onClick={onAdd} size="sm">+ New Endpoint</Button>}
      </div>
      
      {endpoints.length === 0 && <p className={styles.empty}>No endpoints found.</p>}
      
      {endpoints.map(ep => (
        <div key={ep.id} className={styles.itemWrapper}>
          <button
            onClick={() => onSelect(ep.id)}
            className={`${styles.item} ${selectedId === ep.id ? styles.selected : ''}`}
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
              title="Delete endpoint"
            >
              &times;
            </button>
          )}
        </div>
      ))}
    </nav>
  )
}

export default EndpointTree
