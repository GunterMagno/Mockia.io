import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '../layouts/Layout'
import EndpointTree from '../components/editor/EndpointTree'
import JsonEditor from '../components/editor/JsonEditor'
import EndpointInspector from '../components/editor/EndpointInspector'
import { Button } from '../components/ui/Button/Button'
import { Modal } from '../components/ui/Modal/Modal'
import { getEndpoints, updateEndpoint, createEndpoint } from '../services/endpointService'
import { generateAndSaveEndpoints } from '../services/aiService'
import type { EndpointData } from '../services/endpointService'

import styles from './MockEditor.module.scss'

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

  // AI Generation State
  const [showAiModal, setShowAiModal] = useState(false)
  const [aiRequirement, setAiRequirement] = useState('')
  const [isAiGenerating, setIsAiGenerating] = useState(false)

  const fetchEndpoints = () => {
    if (id) {
      getEndpoints(id)
        .then(data => {
          setEndpoints(data)
          if (data.length > 0 && !selectedId) {
            handleSelectEndpoint(data[0])
          }
        })
        .catch(err => console.error("Error fetching endpoints:", err))
    }
  }

  useEffect(() => {
    fetchEndpoints()
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

  const handleAiGenerate = async () => {
    if (!id || !aiRequirement) return
    setIsAiGenerating(true)
    try {
      await generateAndSaveEndpoints(id, aiRequirement)
      await fetchEndpoints()
      setShowAiModal(false)
      setAiRequirement('')
      alert("Endpoints generated successfully!")
    } catch (error) {
      console.error("AI Generation failed:", error)
      alert("AI Generation failed. Please check the backend connection.")
    } finally {
      setIsAiGenerating(false)
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
      <header className={styles.header}>
        <div className={styles.leftHeader}>
          <Button onClick={() => navigate('/dashboard')} className={styles.backBtn}>
            &larr; Back
          </Button>
          <h2>Mock Editor</h2>
          {isDirty && <span className={styles.unsaved}>• Unsaved changes</span>}
        </div>
        <div className={styles.rightHeader}>
          <Button 
            variant="secondary" 
            onClick={() => setShowAiModal(true)}
            className={styles.aiBtn}
          >
            ✨ Generate more with AI
          </Button>
          <Button onClick={handleSave} disabled={!isDirty || isSaving}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </header>

      <div className={styles.editorLayout}>
        {/* Left Sidebar: Endpoint Tree */}
        <aside className={styles.treeSidebar}>
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
        <section className={styles.jsonEditorSection}>
          {activeEndpoint ? (
            <>
              <header>
                <h3>Response Data (JSON)</h3>
              </header>
              <JsonEditor value={jsonContent} onChange={handleJsonChange} />
            </>
          ) : (
            <div className={styles.emptyState}>
              Select an endpoint from the left to edit.
            </div>
          )}
        </section>

        {/* Right Sidebar: Inspector */}
        <aside className={styles.inspectorSidebar}>
          {activeEndpoint && (
            <EndpointInspector 
              endpoint={activeEndpoint} 
              onChangeMeta={handleMetaChange} 
            />
          )}
        </aside>
      </div>

      {/* AI Generation Modal */}
      <Modal isOpen={showAiModal} onClose={() => setShowAiModal(false)}>
        <div className={styles.aiModalContent}>
          <h3>Generate endpoints with AI</h3>
          <p>
            Tell Mockia AI what endpoints you want to create. You can describe the business logic, 
            data models, or specific routes you need.
          </p>
          <textarea
            value={aiRequirement}
            onChange={(e) => setAiRequirement(e.target.value)}
            placeholder="e.g. Create endpoints for a shopping cart with add, remove, and checkout functionality..."
            className={styles.aiTextarea}
          />
          <div className={styles.modalActions}>
            <Button variant="ghost" onClick={() => setShowAiModal(false)} disabled={isAiGenerating}>Cancel</Button>
            <Button onClick={handleAiGenerate} isLoading={isAiGenerating} disabled={!aiRequirement || isAiGenerating}>
              Generate
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  )
}

export default MockEditor

