import React, { useState } from 'react'
import { Modal } from '../../ui/Modal/Modal'
import { createProject, importFromGitHub, hardDeleteProject } from '../../../services/projectService'
import { parseGithubUrl } from '../../../services/githubService'
import { generateAndSaveEndpoints } from '../../../services/aiService'
import { getBackendErrorMessage } from '../../../utils/error'
import type { Project } from '../../../services/projectService'
import styles from './CreateProjectModal.module.scss'
import { Icon } from '../../ui/Icon/Icon'
import emptyProjectIcon from '../../../assets/empty-project.svg'
import githubIcon from '../../../assets/github.svg'
import aiSparkleIcon from '../../../assets/ai-sparkle.svg'
import loaderIcon from '../../../assets/loader.svg'
import eyeIcon from '../../../assets/eye.svg'
import eyeOffIcon from '../../../assets/eye-off.svg'
import { playErrorSound } from '../../../utils/audio'

type Props = {
  isOpen: boolean
  onClose: () => void
  onCreated: (p: Project) => void
}

type Mode = 'empty' | 'github'
type Step = 'select' | 'config' | 'ai_prompt' | 'success'

const CreateProjectModal: React.FC<Props> = ({ isOpen, onClose, onCreated }) => {
  const [step, setStep] = useState<Step>('select')
  const [mode, setMode] = useState<Mode | null>(null)
  
  // Form State
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [githubInfo, setGithubInfo] = useState<any>(null)
  
  // AI State
  const [shouldGenerate, setShouldGenerate] = useState(true)
  const [aiRequirement, setAiRequirement] = useState('Create a basic API for this project with common endpoints.')
  
  // Progress State
  const [loading, setLoading] = useState(false)
  const [validating, setValidating] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState('')
  const [createdProject, setCreatedProject] = useState<Project | null>(null)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)


  const reset = () => {
    setStep('select')
    setMode(null)
    setTitle('')
    setDescription('')
    setRepoUrl('')
    setShouldGenerate(true)
    setAiRequirement('Create a basic API for this project with common endpoints.')
    setLoading(false)
    setValidating(false)
    setStatusMessage('')
    setError('')
    setCreatedProject(null)
    setCopiedUrl(false)
    setCopiedKey(false)
  }

  const closeAndReset = () => {
    onClose()
    setTimeout(reset, 300)
  }

  const handleSelectMode = (m: Mode) => {
    setMode(m)
    setStep('config')
    setError('')
    setShouldGenerate(true) // Ensure it's active when switching modes
    if (m === 'github') {
      setAiRequirement('Extract all relevant API endpoints, interfaces and controllers to create a complete mock API.')
    } else {
      setAiRequirement('Create a complete REST API with GET, POST, PUT, DELETE endpoints for a simple resource (e.g., Tasks, Users, or Products).')
    }
  }

  const handleConfigNext = async () => {
    setError('')
    if (mode === 'github') {
      if (!repoUrl) return
      setValidating(true)
      try {
        const info = await parseGithubUrl(repoUrl)
        setGithubInfo(info)
        setStep('ai_prompt')
        setShouldGenerate(true) // Ensure it's active when moving to next step
      } catch (err) {
        setError(getBackendErrorMessage(err))
        playErrorSound()
      } finally {
        setValidating(false)
      }
    } else {
      if (!title) return
      setStep('ai_prompt')
      setShouldGenerate(true) // Ensure it's active when moving to next step
    }
  }

  const createProjectFlow = async () => {
    setLoading(true)
    setError('')
    
    const messages = mode === 'github' 
      ? ['Analyzing repository...', 'Cloning source code...', 'Extracting interfaces and types...', 'Mockia AI is generating your endpoints...', 'Preparing your workspace...']
      : ['Creating project structure...', 'Initializing API...', 'Mockia AI is generating your endpoints...', 'Almost ready...', 'Finalizing details...']

    let currentIdx = 0
    setStatusMessage(messages[0])
    
    const interval = setInterval(() => {
      currentIdx = (currentIdx + 1) % messages.length
      setStatusMessage(messages[currentIdx])
    }, 3500)
    
    
    try {
      let proj: Project;

      if (mode === 'github') {
        const info = githubInfo || await parseGithubUrl(repoUrl)
        proj = await createProject({ 
          title: info.repo || 'Imported Project', 
          description: `Imported from ${repoUrl}` 
        })
        
        try {
          // Update project with GitHub info and analysis
          const updatedProj = await importFromGitHub(proj.id, { repoUrl })
          proj = updatedProj // Capture the updated version for onCreated
        } catch (githubErr) {
          // ROLLBACK: Delete project if GitHub import fails
          await hardDeleteProject(proj.id);
          throw githubErr;
        }
      } else {
        proj = await createProject({ title, description })
      }

      if (shouldGenerate) {
        try {
          await generateAndSaveEndpoints(proj.id, aiRequirement)
        } catch (aiErr) {
          // ROLLBACK: Delete project if AI generation fails
          await hardDeleteProject(proj.id);
          throw aiErr;
        }
      }

      clearInterval(interval)
      setStatusMessage('Finishing up...')
      setCreatedProject(proj)
      setStep('success')
    } catch (err: any) {
      clearInterval(interval)
      setError(getBackendErrorMessage(err))
      playErrorSound()
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={closeAndReset} noPadding maxWidth="900px">
      <div className={styles.modalContent}>
        {/* Step Indicator */}
        <div className={styles.stepIndicator}>
          <div className={`${styles.dot} ${step === 'select' ? styles.active : ''}`} />
          <div className={`${styles.dot} ${step === 'config' ? styles.active : ''}`} />
          <div className={`${styles.dot} ${step === 'ai_prompt' ? styles.active : ''}`} />
        </div>

        {/* Step 1: Selection */}
        {step === 'select' && (
          <>
            <header className={styles.header}>
              <h2>Create New Project</h2>
              <p>Choose how you want to start your next mock API.</p>
            </header>
            <div className={styles.selectionGrid}>
              <div className={styles.selectionCard} onClick={() => handleSelectMode('empty')}>
                <div className={styles.icon}>
                  <Icon src={emptyProjectIcon} size={48} color="black" />
                </div>
                <h3>Empty Project</h3>
                <p>Start from scratch and define your endpoints manually or with AI.</p>
              </div>
              <div className={styles.selectionCard} onClick={() => handleSelectMode('github')}>
                <div className={styles.icon}>
                  <Icon src={githubIcon} size={48} color="var(--secondary-dark-off)" />
                </div>
                <h3>GitHub Import</h3>
                <p>Clone a repository and let Mockia analyze its structure automatically.</p>
              </div>
            </div>
            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={closeAndReset}>Cancel</button>
            </div>
          </>
        )}

        {/* Step 2: Config */}
        {step === 'config' && (
          <>
            <header className={styles.header}>
              <h2>{mode === 'github' ? 'GitHub Repository' : 'Project Details'}</h2>
              <p>{mode === 'github' ? 'Enter the public URL of the repository you want to import.' : 'Give your new project a name and description.'}</p>
            </header>
            
            <div className={styles.stepContent}>
              {mode === 'github' ? (
                <div className={styles.formGroup}>
                  <label>Repository URL</label>
                  <input 
                    className={styles.input}
                    placeholder="https://github.com/username/repo"
                    value={repoUrl}
                    onChange={e => setRepoUrl(e.target.value)}
                    autoFocus
                  />
                </div>
              ) : (
                <>
                  <div className={styles.formGroup}>
                    <label>Project Title</label>
                    <input 
                      className={styles.input}
                      placeholder="My Awesome API"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Description (Optional)</label>
                    <input 
                      className={styles.input}
                      placeholder="A short description of what this API does..."
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                    />
                  </div>
                </>
              )}
              {error && <div className={styles.error}>{error}</div>}
            </div>

            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={() => setStep('select')} disabled={validating}>Back</button>
              <button 
                className={styles.primaryBtn} 
                onClick={handleConfigNext}
                disabled={(mode === 'github' && !repoUrl) || (mode === 'empty' && !title) || validating}
              >
                {validating ? 'Checking...' : 'Continue'}
              </button>
            </div>
          </>
        )}

        {/* Step 3: AI Prompt */}
        {step === 'ai_prompt' && (
          <>
            <header className={styles.header}>
              <h2>AI Generation</h2>
              <p>Do you want Mockia AI to generate endpoints for you?</p>
            </header>

            <div className={styles.stepContent}>
              <div className={styles.aiCard}>
                <div className={styles.aiIcon}>
                  <Icon src={aiSparkleIcon} size={40} color="white" />
                </div>
                <div className={styles.aiText}>
                  <h4>Smart API Generation</h4>
                  <p>Mockia will use LLMs to create realistic endpoints and data structures based on your input.</p>
                </div>
              </div>

              <div className={styles.aiToggle}>
                <input 
                  type="checkbox" 
                  id="shouldGenerate"
                  checked={shouldGenerate}
                  onChange={e => setShouldGenerate(e.target.checked)}
                  className={styles.checkbox}
                />
                <label htmlFor="shouldGenerate" className={styles.checkboxLabel}>Generate endpoints with AI</label>
              </div>

              {shouldGenerate && (
                <div className={styles.formGroup}>
                  <label>What should the AI generate?</label>
                  <textarea 
                    className={styles.textarea}
                    value={aiRequirement}
                    onChange={e => setAiRequirement(e.target.value)}
                    placeholder="Describe the endpoints you want (e.g. A user management API with login, register and profile endpoints...)"
                  />
                </div>
              )}

              {error && <div className={styles.error}>{error}</div>}
              
              {loading && (
                <div className={styles.statusMessage}>
                  <Icon src={loaderIcon} size={20} className={styles.spinner} /> {statusMessage}
                </div>
              )}
            </div>

            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={() => setStep('config')} disabled={loading}>Back</button>
              <button 
                className={styles.primaryBtn} 
                onClick={createProjectFlow}
                disabled={loading}
              >
                {loading ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </>
        )}

        {/* Step 4: Success */}
        {step === 'success' && createdProject && (
          <div className={styles.successContent}>
            <header className={styles.header}>
              <div className={styles.successBadge}>✓</div>
              <h2>Project Ready!</h2>
              <p>Your mock API has been created successfully.</p>
            </header>

            <div className={styles.stepContent}>
              <div className={styles.connectionCard}>
                <div className={styles.infoGroup}>
                  <label>Mock Base URL</label>
                  <div className={styles.copyBox}>
                    <code>{window.location.origin}/api/mock/{createdProject.slug}</code>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/api/mock/${createdProject.slug}`)
                        setCopiedUrl(true)
                        setTimeout(() => setCopiedUrl(false), 2000)
                      }}
                      className={copiedUrl ? styles.copied : ''}
                    >
                      {copiedUrl ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div className={styles.infoGroup}>
                  <label>Project API Key</label>
                  <div className={styles.apiKeyDisplay}>
                    <div className={styles.apiKeyBox}>
                      <code>
                        {showApiKey 
                          ? (createdProject.apiKey || '') 
                          : (createdProject.apiKey ? '•'.repeat(createdProject.apiKey.length) : '')}
                      </code>
                      <button 
                        className={styles.toggleBtn}
                        onClick={() => setShowApiKey(!showApiKey)}
                        title={showApiKey ? 'Hide API Key' : 'Show API Key'}
                      >
                        <Icon src={showApiKey ? eyeOffIcon : eyeIcon} size={16} />
                      </button>
                    </div>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(createdProject.apiKey || '')
                        setCopiedKey(true)
                        setTimeout(() => setCopiedKey(false), 2000)
                      }}
                      className={`${styles.copyBtn} ${copiedKey ? styles.copied : ''}`}
                    >
                      {copiedKey ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div className={styles.instructionNote}>
                  <div className={styles.noteIcon}>!</div>
                  <div className={styles.noteText}>
                    <strong>Important:</strong> Include the <code>X-Mockia-API-Key</code> header in your requests to authenticate.
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.actions}>
              <button 
                className={styles.primaryBtn} 
                onClick={() => {
                  onCreated(createdProject)
                  closeAndReset()
                }}
              >
                Go to Editor &rarr;
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default CreateProjectModal
