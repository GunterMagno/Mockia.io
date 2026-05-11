import React, { useState } from 'react'
import { Modal } from '../ui/Modal/Modal'
import { createProject, importFromGitHub } from '../../services/projectService'
import { parseGithubUrl } from '../../services/githubService'
import { generateAndSaveEndpoints } from '../../services/aiService'
import { getBackendErrorMessage } from '../../utils/error'
import type { Project } from '../../services/projectService'
import styles from './CreateProjectModal.module.scss'
import { Icon } from '../ui/Icon/Icon'
import emptyProjectIcon from '../../assets/empty-project.svg'
import githubIcon from '../../assets/github.svg'
import aiSparkleIcon from '../../assets/ai-sparkle.svg'

type Props = {
  isOpen: boolean
  onClose: () => void
  onCreated: (p: Project) => void
}

type Mode = 'empty' | 'github'
type Step = 'select' | 'config' | 'ai_prompt'

const CreateProjectModal: React.FC<Props> = ({ isOpen, onClose, onCreated }) => {
  const [step, setStep] = useState<Step>('select')
  const [mode, setMode] = useState<Mode | null>(null)
  
  // Form State
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  
  // AI State
  const [shouldGenerate, setShouldGenerate] = useState(true)
  const [aiRequirement, setAiRequirement] = useState('Create a basic API for this project with common endpoints.')
  
  // Progress State
  const [loading, setLoading] = useState(false)
  const [validating, setValidating] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState('')

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
        await parseGithubUrl(repoUrl)
        setStep('ai_prompt')
        setShouldGenerate(true) // Ensure it's active when moving to next step
      } catch (err) {
        setError('The GitHub URL provided is not valid. Please check the format and ensure the repository is public.')
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
    
    try {
      let proj: Project;

      if (mode === 'github') {
        setStatusMessage('Analyzing GitHub repository...')
        const info = await parseGithubUrl(repoUrl)
        proj = await createProject({ 
          title: info.repo || 'Imported Project', 
          description: `Imported from ${repoUrl}` 
        })
        setStatusMessage('Cloning and importing data...')
        await importFromGitHub(proj.id, { repoUrl })
      } else {
        setStatusMessage('Creating project structure...')
        proj = await createProject({ title, description })
      }

      if (shouldGenerate) {
        setStatusMessage('Mockia AI is building your API...')
        await generateAndSaveEndpoints(proj.id, aiRequirement)
      }

      setStatusMessage('Finishing up...')
      onCreated(proj)
      closeAndReset()
    } catch (err: any) {
      setError(getBackendErrorMessage(err))
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
                  <span className={styles.spinner}>⏳</span> {statusMessage}
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
      </div>
    </Modal>
  )
}

export default CreateProjectModal
