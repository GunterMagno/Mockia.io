import React from 'react'
import type { EndpointData } from '../../../services/endpointService'
import { Input } from '../../ui/Input/Input'

export interface EndpointInspectorProps {
  endpoint: EndpointData
  onChangeMeta: (updates: Partial<EndpointData>) => void
  readOnly?: boolean
}

import styles from './EndpointInspector.module.scss'

export const EndpointInspector: React.FC<EndpointInspectorProps> = ({ endpoint, onChangeMeta, readOnly }) => {
  return (
    <section className={styles.inspector}>
      <header className={styles.header}>
        <h3>HTTP Configuration</h3>
      </header>

      <fieldset className={styles.fieldset} disabled={readOnly}>
        <article>
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
        </article>

        <Input 
          label="Path" 
          value={endpoint.path} 
          onChange={(e) => onChangeMeta({ path: e.target.value })} 
        />

        <article>
          <label className={styles.label}>
            Status Code
          </label>
          <select 
            value={endpoint.responses?.[0]?.statusCode || 200} 
            onChange={(e) => {
              const newResponses = [...(endpoint.responses || [])]
              if (newResponses.length === 0) newResponses.push({ statusCode: 200, schema: {} })
              newResponses[0].statusCode = parseInt(e.target.value) || 200
              onChangeMeta({ responses: newResponses })
            }}
            className={styles.select}
          >
            <optgroup label="2xx Success">
              <option value="200">200 OK</option>
              <option value="201">201 Created</option>
              <option value="202">202 Accepted</option>
              <option value="204">204 No Content</option>
            </optgroup>
            <optgroup label="4xx Client Error">
              <option value="400">400 Bad Request</option>
              <option value="401">401 Unauthorized</option>
              <option value="403">403 Forbidden</option>
              <option value="404">404 Not Found</option>
              <option value="409">409 Conflict</option>
            </optgroup>
            <optgroup label="5xx Server Error">
              <option value="500">500 Internal Server Error</option>
              <option value="501">501 Not Implemented</option>
              <option value="503">503 Service Unavailable</option>
            </optgroup>
          </select>
        </article>

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
