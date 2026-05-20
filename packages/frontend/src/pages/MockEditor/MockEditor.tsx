import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '../../layouts/Layout'
import EndpointTree from '../../components/editor/EndpointTree/EndpointTree'
import JsonEditor from '../../components/editor/JsonEditor/JsonEditor'
import EndpointInspector from '../../components/editor/EndpointInspector/EndpointInspector'
import { Button } from '../../components/ui/Button/Button'
import { Modal } from '../../components/ui/Modal/Modal'
import { getEndpoints, updateEndpoint, createEndpoint, deleteEndpoint } from '../../services/endpointService'
import { getProjectById, type Project } from '../../services/projectService'
import { generateAndSaveEndpoints } from '../../services/aiService'
import type { EndpointData } from '../../services/endpointService'

import { Icon } from '../../components/ui/Icon/Icon'
import aiSparkleIcon from '../../assets/ai-sparkle.svg'
import copyIcon from '../../assets/copy.svg'
import checkIcon from '../../assets/check.svg'

import styles from './MockEditor.module.scss'
import ProjectSettingsModal from '../../components/projects/ProjectSettingsModal'
import { getBackendErrorMessage } from '../../utils/error'

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
  const [isDeleting, setIsDeleting] = useState(false)

  // AI Generation State
  const [showAiModal, setShowAiModal] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [aiRequirement, setAiRequirement] = useState('')
  const [isAiGenerating, setIsAiGenerating] = useState(false)
  const [aiStatusMessage, setAiStatusMessage] = useState('')
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [endpointToDelete, setEndpointToDelete] = useState<string | null>(null)

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

  const userRole = project?.members?.find(m => String(m.userId) === String(currentUserId))?.role
  const isViewer = userRole === 'VIEWER'

  const apiBaseUrl = import.meta.env.VITE_API_URL && (import.meta.env.VITE_API_URL.startsWith('http') || import.meta.env.VITE_API_URL.startsWith('//'))
    ? import.meta.env.VITE_API_URL
    : window.location.origin + '/api';
  const cleanedApiBaseUrl = apiBaseUrl.endsWith('/') ? apiBaseUrl.slice(0, -1) : apiBaseUrl;
  const mockBaseUrl = project?.slug ? `${cleanedApiBaseUrl}/mock/${project.slug}` : '...';

  const fetchEndpoints = (silent = false) => {
    if (id) {
      getEndpoints(id)
        .then(data => {
          setEndpoints(data)
          
          // If we have an active endpoint and it's NOT dirty, update it if server version changed
          if (activeEndpoint && !isDirty && !isSaving) {
            const serverEp = data.find(e => e.id === activeEndpoint.id)
            if (serverEp) {
              const serverSchema = serverEp.responses?.[0]?.schema || {}
              const activeSchema = activeEndpoint.responses?.[0]?.schema || {}
              
              const serverJson = JSON.stringify(serverSchema, null, 2)
              const currentJson = JSON.stringify(activeSchema, null, 2)
              
              if (serverJson !== currentJson || serverEp.path !== activeEndpoint.path || serverEp.method !== activeEndpoint.method) {
                console.log("Syncing active endpoint with server changes...")
                setActiveEndpoint(serverEp)
                setJsonContent(serverJson)
              }
            }
          }

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
      // Refresh project to check for membership/access changes and update members list dynamically
      if (id) {
        getProjectById(id)
          .then(setProject)
          .catch(err => {
            console.error("Access lost or project deleted:", err);
            navigate('/dashboard');
          });
      }

      // ONLY refresh endpoints if user is NOT editing anything to avoid losing state
      if (!isDirty && !isSaving && !isAiGenerating && !isDeleting) {
        fetchEndpoints(true)
      }
    }, 2500) // Reduced to 2.5 seconds for better responsiveness

    return () => clearInterval(interval)
  }, [id, isDirty, isSaving, isAiGenerating, isDeleting, activeEndpoint])

  // AUTO-SAVE logic
  useEffect(() => {
    if (!isDirty || isSaving || isAiGenerating || isViewer || isDeleting) return

    const timer = setTimeout(() => {
      console.log("Auto-saving changes...")
      handleSave()
    }, 1500) // Save after 1.5s of inactivity

    return () => clearTimeout(timer)
  }, [activeEndpoint, jsonContent, isDirty, isSaving, isAiGenerating, isViewer, isDeleting])

  useEffect(() => {
    fetchEndpoints()
    if (id) {
      getProjectById(id)
        .then((p) => {
          setProject(p)
          try {
            const lastVisited = JSON.parse(localStorage.getItem('mockia_last_visited') || '{}')
            lastVisited[p.id] = Date.now()
            localStorage.setItem('mockia_last_visited', JSON.stringify(lastVisited))
          } catch (e) {
            console.error("Error saving last visited project:", e)
          }
        })
        .catch(err => {
          console.error("Error fetching project:", err);
          navigate('/dashboard');
        })
    }
  }, [id])

  // Dispatch event to set project name in the Header
  useEffect(() => {
    if (project?.title) {
      document.dispatchEvent(new CustomEvent('set-project-name', { detail: project.title }));
    }
    return () => {
      // Clear it when unmounting
      document.dispatchEvent(new CustomEvent('set-project-name', { detail: null }));
    };
  }, [project?.title]);

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

  const handleDeleteEndpoint = async (endpointId: string) => {
    if (isViewer) return
    
    setIsDeleting(true)
    try {
      await deleteEndpoint(endpointId)
      
      // Update local state
      setEndpoints(prev => prev.filter(ep => ep.id !== endpointId))
      
      // If the deleted endpoint was selected, select another one or none
      if (selectedId === endpointId) {
        setSelectedId(null)
        setActiveEndpoint(null)
        setJsonContent('{}')
        setIsDirty(false)
      }
      setEndpointToDelete(null)
    } catch (error) {
      console.error("Error deleting endpoint:", error)
      alert("Failed to delete endpoint.")
    } finally {
      setIsDeleting(false)
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
    if (!activeEndpoint || isViewer) return
    setActiveEndpoint({ ...activeEndpoint, ...updates })
    setIsDirty(true)
  }

  const handleJsonChange = (val: string) => {
    if (isViewer) return
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
        statusCode,
        delay_ms: activeEndpoint.delay_ms || 0,
        force_status_code: activeEndpoint.force_status_code || 0
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
        <section className={styles.leftHeader}>
          <article className={styles.urlSection}>
            <span className={styles.urlLabel}>Mock Base URL:</span>
            <code className={styles.urlDisplay}>
              {mockBaseUrl}
            </code>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => {
                if (project?.slug) {
                  navigator.clipboard.writeText(mockBaseUrl);
                  setCopiedUrl(true);
                  setTimeout(() => setCopiedUrl(false), 2000);
                }
              }}
              title="Copy URL"
              className={`${styles.copyBtn} ${copiedUrl ? styles.copied : ''}`}
            >
              <Icon src={copiedUrl ? checkIcon : copyIcon} size={16} />
            </Button>
          </article>

          <article className={styles.authInfo}>
            <span className={styles.authLabel}>Header:</span>
            <code>X-Mockia-API-Key</code>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => {
                if (project?.apiKey) {
                  navigator.clipboard.writeText(project.apiKey);
                  setCopiedKey(true);
                  setTimeout(() => setCopiedKey(false), 2000);
                }
              }}
              title="Copy API Key"
              className={`${styles.copyBtn} ${copiedKey ? styles.copied : ''}`}
            >
              <Icon src={copiedKey ? checkIcon : copyIcon} size={16} />
              {copiedKey ? 'Key Copied!' : 'Copy Key'}
            </Button>
          </article>
          {isDirty && <span className={styles.unsaved}>• Unsaved changes</span>}
        </section>
        <section className={styles.rightHeader}>
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
        </section>
      </header>

      <section className={styles.editorLayout}>
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
            onDelete={isViewer ? undefined : (id) => setEndpointToDelete(id)}
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
            <article className={styles.emptyState}>
              Select an endpoint from the left to edit.
            </article>
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
      </section>

      {/* AI Generation Modal */}
      <Modal isOpen={showAiModal} onClose={() => setShowAiModal(false)}>
        <article className={styles.aiModalContent}>
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
          <nav className={styles.modalActions}>
            <Button variant="ghost" onClick={() => setShowAiModal(false)} disabled={isAiGenerating}>Cancel</Button>
            <Button onClick={handleAiGenerate} isLoading={isAiGenerating} disabled={!aiRequirement || isAiGenerating}>
              {isAiGenerating ? aiStatusMessage : 'Generate'}
            </Button>
          </nav>
        </article>
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
      {/* Delete Confirmation Modal */}
      <Modal isOpen={!!endpointToDelete} onClose={() => setEndpointToDelete(null)}>
        <article className={styles.aiModalContent}>
          <h3>Confirm deletion</h3>
          <p>
            Are you sure you want to delete this endpoint? This action cannot be undone.
          </p>
          <nav className={styles.modalActions}>
            <Button variant="ghost" onClick={() => setEndpointToDelete(null)} disabled={isDeleting}>Cancel</Button>
            <Button variant="danger" onClick={() => endpointToDelete && handleDeleteEndpoint(endpointToDelete)} isLoading={isDeleting} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </nav>
        </article>
      </Modal>
    </Layout>
  )
}

export default MockEditor

