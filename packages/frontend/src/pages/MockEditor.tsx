import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '../layouts/Layout'
import EndpointTree from '../components/editor/EndpointTree'
import JsonEditor from '../components/editor/JsonEditor'
import EndpointInspector from '../components/editor/EndpointInspector'
import { Button } from '../components/ui/Button/Button'
import { Modal } from '../components/ui/Modal/Modal'
import { getEndpoints, updateEndpoint, createEndpoint } from '../services/endpointService'
import { getProjectById, type Project } from '../services/projectService'
import { generateAndSaveEndpoints } from '../services/aiService'
import type { EndpointData } from '../services/endpointService'

import { Icon } from '../components/ui/Icon/Icon'
import aiSparkleIcon from '../assets/ai-sparkle.svg'
import copyIcon from '../assets/copy.svg'

import styles from './MockEditor.module.scss'
import ProjectSettingsModal from '../components/projects/ProjectSettingsModal'
import { getBackendErrorMessage } from '../utils/error'

const MockEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  
  const [endpoints, setEndpoints] = useState<EndpointData[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  
  // To track the working copy of the selected endpoint
  const [activeEndpoint, setActiveEndpoint] = useState<EndpointData | null>(null)
  const [jsonContent, setJsonContent] = useState<string>('{}')
  
  // State for changes
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // AI Generation State
  const [showAiModal, setShowAiModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [aiRequirement, setAiRequirement] = useState('')
  const [isAiGenerating, setIsAiGenerating] = useState(false)
  const [aiStatusMessage, setAiStatusMessage] = useState('')
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // Get current user ID from token
  useEffect(() => {
    const token = localStorage.getItem('mockia_token')
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        setCurrentUserId(payload.sub)
      } catch (e) {
        console.error("Error decoding token:", e)
      }
    }
  }, [])

  const userRole = project?.members.find(m => String(m.userId) === String(currentUserId))?.role
  const isViewer = userRole === 'VIEWER'

  const fetchEndpoints = (silent = false) => {
    if (id) {
      getEndpoints(id)
        .then(data => {
          // Only update if data is different to avoid flickering (simplified check)
          setEndpoints(data)
          if (data.length > 0 && !selectedId && !silent) {
            handleSelectEndpoint(data[0])
          }
        })
        .catch(err => console.error("Error fetching endpoints:", err))
    }
  }

  // Polling for real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      // ONLY refresh if user is NOT editing anything to avoid losing state
      if (!isDirty && !isSaving && !isAiGenerating) {
        fetchEndpoints(true)
      }
    }, 10000) // Every 10 seconds

    return () => clearInterval(interval)
  }, [id, isDirty, isSaving, isAiGenerating])

  // AUTO-SAVE logic
  useEffect(() => {
    if (!isDirty || isSaving || isAiGenerating || isViewer) return

    const timer = setTimeout(() => {
      console.log("Auto-saving changes...")
      handleSave()
    }, 1500) // Save after 1.5s of inactivity

    return () => clearTimeout(timer)
  }, [activeEndpoint, jsonContent, isDirty, isSaving, isAiGenerating, isViewer])

  useEffect(() => {
    fetchEndpoints()
    if (id) {
      getProjectById(id)
        .then(setProject)
        .catch(err => console.error("Error fetching project:", err))
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

  const handleAiGenerate = async () => {
    if (!id || !aiRequirement) return
    setIsAiGenerating(true)
    
    const messages = [
      'Analyzing current project structure...',
      'Mapping repository context...',
      'Mockia AI is designing new endpoints...',
      'Generating realistic response data...',
      'Validating JSON structure...',
      'Almost there...'
    ]
    
    let currentIdx = 0
    setAiStatusMessage(messages[0])
    
    const interval = setInterval(() => {
      currentIdx = (currentIdx + 1) % messages.length
      setAiStatusMessage(messages[currentIdx])
    }, 3000)

    try {
      // Pass project.id instead of slug/id to backend
      await generateAndSaveEndpoints(project!.id, aiRequirement)
      clearInterval(interval)
      console.log("AI Generation successful, fetching endpoints...")
      await fetchEndpoints()
      setShowAiModal(false)
      setAiRequirement('')
    } catch (error: any) {
      clearInterval(interval)
      console.error("AI Generation failed:", error)
      alert(`AI Generation failed: ${getBackendErrorMessage(error)}`)
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
    <Layout onOpenProjectSettings={() => setShowSettingsModal(true)}>
      <header className={styles.header}>
        <div className={styles.leftHeader}>
          <Button onClick={() => navigate('/dashboard')} variant="ghost" className={styles.backBtn}>
            &larr; Back
          </Button>
          <div className={styles.urlSection}>
            <span className={styles.urlLabel}>Mock Base URL:</span>
            <code className={styles.urlDisplay}>
              {window.location.origin}/api/mock/{project?.slug || '...'}
            </code>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => {
                const url = `${window.location.origin}/api/mock/${project?.slug}`;
                navigator.clipboard.writeText(url);
              }}
              title="Copy URL"
              className={styles.copyBtn}
            >
              <Icon src={copyIcon} size={16} />
            </Button>
          </div>
          {isDirty && <span className={styles.unsaved}>• Unsaved changes</span>}
        </div>
        <div className={styles.rightHeader}>
          {!isViewer && (
            <>
              <Button 
                variant="secondary" 
                onClick={() => setShowAiModal(true)}
                className={styles.aiBtn}
              >
                <Icon src={aiSparkleIcon} size={18} /> Generate more with AI
              </Button>
              <Button onClick={handleSave} disabled={!isDirty || isSaving}>
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </>
          )}
          {isViewer && <span className={styles.viewerBadge}>VIEW ONLY MODE</span>}
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
            onAdd={isViewer ? undefined : handleAddEndpoint}
          />
        </aside>

        {/* Center: JSON Editor */}
        <section className={styles.jsonEditorSection}>
          {activeEndpoint ? (
            <>
              <header>
                <h3>Response Data (JSON)</h3>
              </header>
              <JsonEditor value={jsonContent} onChange={handleJsonChange} readOnly={isViewer} />
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
              readOnly={isViewer}
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
              {isAiGenerating ? aiStatusMessage : 'Generate'}
            </Button>
          </div>
        </div>
      </Modal>
      {/* Project Settings Modal */}
      {project && (
        <ProjectSettingsModal 
          isOpen={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          project={project}
          isViewer={isViewer}
          onUpdate={(updated) => {
            setProject(updated)
            // If slug changed, we need to update the URL
            if (updated.slug !== project.slug) {
              navigate(`/editor/${updated.slug}`, { replace: true })
            }
          }}
          onDelete={() => navigate('/dashboard')}
        />
      )}
    </Layout>
  )
}

export default MockEditor

