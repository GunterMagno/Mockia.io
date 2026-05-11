import React from 'react'
import type { EndpointData } from '../../services/endpointService'
import { Input } from '../ui/Input/Input'

export interface EndpointInspectorProps {
  endpoint: EndpointData
  onChangeMeta: (updates: Partial<EndpointData>) => void
}

import styles from './EndpointInspector.module.scss'

export const EndpointInspector: React.FC<EndpointInspectorProps> = ({ endpoint, onChangeMeta }) => {
  return (
    <section className={styles.inspector}>
      <header className={styles.header}>
        <h3>HTTP Configuration</h3>
      </header>

      <fieldset className={styles.fieldset}>
        <div>
          <label className={styles.label}>
            HTTP Method
          </label>
          <select 
            value={endpoint.method} 
            onChange={(e) => onChangeMeta({ method: e.target.value })}
            className={styles.select}
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
          <label className={styles.label}>
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
          label="Description" 
          value={endpoint.description} 
          onChange={(e) => onChangeMeta({ description: e.target.value })} 
        />

      </fieldset>
    </section>
  )
}

export default EndpointInspector
