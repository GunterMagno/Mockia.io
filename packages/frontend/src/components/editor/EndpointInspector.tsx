import React from 'react'
import type { EndpointData } from '../../services/endpointService'
import { Input } from '../ui/Input'

export interface EndpointInspectorProps {
  endpoint: EndpointData
  onChangeMeta: (updates: Partial<EndpointData>) => void
}

export const EndpointInspector: React.FC<EndpointInspectorProps> = ({ endpoint, onChangeMeta }) => {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
      <header>
        <h3 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Configuración HTTP</h3>
      </header>

      <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
        <div>
          <label style={{ display: 'block', marginBottom: 'var(--spacing-1)', fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
            Método HTTP
          </label>
          <select 
            value={endpoint.method} 
            onChange={(e) => onChangeMeta({ method: e.target.value })}
            style={{
              width: '100%',
              padding: 'var(--spacing-2)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              color: 'var(--text)',
              fontSize: 'var(--text-base)'
            }}
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
            <option value="PATCH">PATCH</option>
          </select>
        </div>

        <Input 
          label="Path" 
          value={endpoint.path} 
          onChange={(e) => onChangeMeta({ path: e.target.value })} 
        />

        <div>
          <label style={{ display: 'block', marginBottom: 'var(--spacing-1)', fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
            Status Code
          </label>
          <Input 
            type="number"
            value={endpoint.responses?.[0]?.statusCode || 200} 
            onChange={(e) => {
              const newResponses = [...(endpoint.responses || [])]
              if (newResponses.length === 0) newResponses.push({ statusCode: 200, schema: {} })
              newResponses[0].statusCode = parseInt(e.target.value) || 200
              onChangeMeta({ responses: newResponses })
            }} 
          />
        </div>

        <Input 
          label="Descripción" 
          value={endpoint.description} 
          onChange={(e) => onChangeMeta({ description: e.target.value })} 
        />

      </fieldset>
    </section>
  )
}

export default EndpointInspector
