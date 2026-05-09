import React from 'react'
import type { EndpointData } from '../../services/endpointService'

import { Button } from '../ui/Button'

export interface EndpointTreeProps {
  endpoints: EndpointData[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
}

export const EndpointTree: React.FC<EndpointTreeProps> = ({ endpoints, selectedId, onSelect, onAdd }) => {
  // Method colors for better visual distinction
  const getMethodColor = (method: string) => {
    switch (method.toUpperCase()) {
      case 'GET': return 'var(--color-primary)'
      case 'POST': return 'var(--color-success, #10b981)'
      case 'PUT': return 'var(--color-warning, #f59e0b)'
      case 'DELETE': return 'var(--color-danger)'
      case 'PATCH': return 'var(--color-warning, #f59e0b)'
      default: return 'var(--text)'
    }
  }

  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-1)' }}>
      <div style={{ padding: 'var(--spacing-2) 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>Endpoints</h4>
        <Button onClick={onAdd} size="sm">+ Nuevo Endpoint</Button>
      </div>
      
      {endpoints.length === 0 && <p style={{ color: 'var(--muted)', padding: 'var(--spacing-2)' }}>No endpoints found.</p>}
      
      {endpoints.map(ep => (
        <button
          key={ep.id}
          onClick={() => onSelect(ep.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-2)',
            padding: 'var(--spacing-2)',
            border: 'none',
            background: selectedId === ep.id ? 'var(--bg-card)' : 'transparent',
            color: selectedId === ep.id ? 'var(--text)' : 'var(--muted)',
            textAlign: 'left',
            cursor: 'pointer',
            borderRadius: 'var(--radius-md)',
            fontWeight: selectedId === ep.id ? 'bold' : 'normal',
            transition: 'background var(--transition-fast)'
          }}
        >
          <span style={{ color: getMethodColor(ep.method), fontSize: 'var(--text-xs)', fontWeight: 'bold', minWidth: '40px' }}>
            {ep.method.toUpperCase()}
          </span>
          <span style={{ fontSize: 'var(--text-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ep.path}
          </span>
        </button>
      ))}
    </nav>
  )
}

export default EndpointTree
