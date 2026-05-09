import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '../layouts/Layout'
import EndpointTree from '../components/editor/EndpointTree'
import JsonEditor from '../components/editor/JsonEditor'
import EndpointInspector from '../components/editor/EndpointInspector'
import { Button } from '../components/ui/Button'
import { getEndpoints, updateEndpoint, createEndpoint } from '../services/endpointService'
import type { EndpointData } from '../services/endpointService'

const MockEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  
  const [endpoints, setEndpoints] = useState<EndpointData[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  
  // To track the working copy of the selected endpoint
  const [activeEndpoint, setActiveEndpoint] = useState<EndpointData | null>(null)
  const [jsonContent, setJsonContent] = useState<string>('{}')
  
  // State for changes
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (id) {
      getEndpoints(id)
        .then(data => {
          setEndpoints(data)
          if (data.length > 0) {
            handleSelectEndpoint(data[0])
          }
        })
        .catch(err => console.error("Error fetching endpoints:", err))
    }
  }, [id])

  const handleSelectEndpoint = (ep: EndpointData) => {
    if (isDirty) {
      const confirm = window.confirm("You have unsaved changes. Discard?")
      if (!confirm) return
    }
    
    setSelectedId(ep.id)
    setActiveEndpoint({ ...ep })
    
    // We get the response schema from the first response
    const schema = ep.responses && ep.responses.length > 0 ? ep.responses[0].schema : {}
    setJsonContent(JSON.stringify(schema, null, 2))
    setIsDirty(false)
  }

  const handleAddEndpoint = async () => {
    if (isDirty) {
      const confirm = window.confirm("You have unsaved changes. Discard?")
      if (!confirm) return
    }
    if (!id) return

    try {
      const newEp = await createEndpoint(id, {
        path: '/new-endpoint',
        method: 'GET',
        description: 'New endpoint description'
      })
      setEndpoints(prev => [...prev, newEp])
      handleSelectEndpoint(newEp)
    } catch (error) {
      console.error("Error creating endpoint:", error)
      alert("Failed to create endpoint.")
    }
  }

  const handleMetaChange = (updates: Partial<EndpointData>) => {
    if (!activeEndpoint) return
    setActiveEndpoint({ ...activeEndpoint, ...updates })
    setIsDirty(true)
  }

  const handleJsonChange = (val: string) => {
    setJsonContent(val)
    setIsDirty(true)
  }

  const handleSave = async () => {
    if (!activeEndpoint) return
    setIsSaving(true)
    try {
      let parsedJson = {}
      try {
        parsedJson = JSON.parse(jsonContent)
      } catch (e) {
        alert("Invalid JSON. Please fix errors before saving.")
        setIsSaving(false)
        return
      }

      const statusCode = activeEndpoint.responses?.[0]?.statusCode || 200

      const payload = {
        path: activeEndpoint.path,
        method: activeEndpoint.method,
        description: activeEndpoint.description,
        responseBody: parsedJson,
        statusCode
      }
      
      // Update endpoint on backend
      const updatedEp = await updateEndpoint(activeEndpoint.id, payload)
      
      // Update local state list
      setEndpoints(prev => prev.map(ep => ep.id === activeEndpoint.id ? updatedEp : ep))
      setActiveEndpoint(updatedEp)
      setIsDirty(false)
    } catch (err) {
      console.error("Save failed:", err)
      alert("Failed to save endpoint. Please check the backend connection.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Layout>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-4)', paddingBottom: 'var(--spacing-3)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
          <Button onClick={() => navigate('/dashboard')} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)' }}>
            &larr; Back
          </Button>
          <h2 style={{ margin: 0 }}>Mock Editor</h2>
          {isDirty && <span style={{ color: 'var(--color-warning, #f59e0b)', fontSize: 'var(--text-sm)', fontWeight: 'bold' }}>• Unsaved changes</span>}
        </div>
        <div>
          <Button onClick={handleSave} disabled={!isDirty || isSaving}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 'var(--spacing-4)', height: 'calc(100vh - 140px)' }}>
        {/* Left Sidebar: Endpoint Tree */}
        <aside style={{ width: '280px', borderRight: '1px solid var(--border)', paddingRight: 'var(--spacing-3)', overflowY: 'auto' }}>
          <EndpointTree 
            endpoints={endpoints} 
            selectedId={selectedId} 
            onSelect={(id) => {
              const ep = endpoints.find(e => e.id === id)
              if (ep) handleSelectEndpoint(ep)
            }} 
            onAdd={handleAddEndpoint}
          />
        </aside>

        {/* Center: JSON Editor */}
        <section style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {activeEndpoint ? (
            <>
              <header style={{ marginBottom: 'var(--spacing-2)' }}>
                <h3 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Response Data (JSON)</h3>
              </header>
              <JsonEditor value={jsonContent} onChange={handleJsonChange} />
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
              Select an endpoint from the left to edit.
            </div>
          )}
        </section>

        {/* Right Sidebar: Inspector */}
        <aside style={{ width: '320px', borderLeft: '1px solid var(--border)', paddingLeft: 'var(--spacing-3)', overflowY: 'auto' }}>
          {activeEndpoint && (
            <EndpointInspector 
              endpoint={activeEndpoint} 
              onChangeMeta={handleMetaChange} 
            />
          )}
        </aside>
      </div>
    </Layout>
  )
}

export default MockEditor
