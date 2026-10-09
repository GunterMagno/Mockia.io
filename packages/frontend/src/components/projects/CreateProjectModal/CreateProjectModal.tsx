import React, { useId, useState } from 'react'
import { Modal } from '../../ui/Modal/Modal'
import { createProject, importFromGitHub, hardDeleteProject } from '../../../services/projectService'
import { parseGithubUrl } from '../../../services/githubService'
import { generateAndSaveEndpoints, MAX_AI_REQUIREMENT_CHARS } from '../../../services/aiService'
import { getBackendErrorCode, getBackendErrorMessage } from '../../../utils/error'
import { Link } from 'react-router-dom'
import { PATHS } from '../../../routes/paths'
import type { Project } from '../../../services/projectService'
import styles from './CreateProjectModal.module.scss'
import { Icon } from '../../ui/Icon/Icon'
import AiFeedback from '../../ui/AiFeedback/AiFeedback'
import emptyProjectIcon from '../../../assets/empty-project.svg'
import githubIcon from '../../../assets/github.svg'
import aiSparkleIcon from '../../../assets/ai-sparkle.svg'
import loaderIcon from '../../../assets/loader.svg'
import checkIcon from '../../../assets/check.svg'
import linkIcon from '../../../assets/link.svg'
import folderIcon from '../../../assets/folder.svg'
import { playErrorSound } from '../../../utils/audio'
import ModalErrorAlert from '../../ui/ModalErrorAlert/ModalErrorAlert'
import { useI18n } from '../../../i18n/I18nProvider'

type Props = {
  isOpen: boolean
  onClose: () => void
  onCreated: (p: Project) => void
}

type Mode = 'empty' | 'github'
type Step = 'select' | 'config' | 'ai_prompt' | 'success'

const STEPS: Step[] = ['select', 'config', 'ai_prompt']

const CreateProjectModal: React.FC<Props> = ({ isOpen, onClose, onCreated }) => {
  const { t, tl, rich } = useI18n()
  const uid = useId()
  const [step, setStep] = useState<Step>('select')
  const [mode, setMode] = useState<Mode | null>(null)
  
  // Form State
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [githubInfo, setGithubInfo] = useState<any>(null)
  
  // AI State
  const [shouldGenerate, setShouldGenerate] = useState(true)
  const [aiRequirement, setAiRequirement] = useState(() => t('createProject.aiDefaultBasic'))
  
  // Progress State
  const [loading, setLoading] = useState(false)
  const [validating, setValidating] = useState(false)
  const [progress, setProgress] = useState<string[]>([])
  const [progressIdx, setProgressIdx] = useState(0)
  const [error, setError] = useState('')
  const [limitReached, setLimitReached] = useState(false)
  const [createdProject, setCreatedProject] = useState<Project | null>(null)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [generationId, setGenerationId] = useState<string | undefined>(undefined)

  const apiBaseUrl = import.meta.env.VITE_API_URL && (import.meta.env.VITE_API_URL.startsWith('http') || import.meta.env.VITE_API_URL.startsWith('//'))
    ? import.meta.env.VITE_API_URL
    : window.location.origin + '/api';
  const cleanedApiBaseUrl = apiBaseUrl.endsWith('/') ? apiBaseUrl.slice(0, -1) : apiBaseUrl;
  const mockBaseUrl = createdProject?.slug ? `${cleanedApiBaseUrl}/mock/${createdProject.slug}` : '';


  const reset = () => {
    setStep('select')
    setMode(null)
    setTitle('')
    setDescription('')
    setRepoUrl('')
    setShouldGenerate(true)
    setAiRequirement(t('createProject.aiDefaultBasic'))
    setLoading(false)
    setValidating(false)
    setProgress([])
    setProgressIdx(0)
    setError('')
    setLimitReached(false)
    setCreatedProject(null)
    setCopiedUrl(false)
    setGenerationId(undefined)
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
      setAiRequirement(t('createProject.aiDefaultGithub'))
    } else {
      setAiRequirement(t('createProject.aiDefaultEmpty'))
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
        setError(getBackendErrorMessage(err, t))
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
    
    const messages = mode === 'github' ? tl('createProject.progressGithub') : tl('createProject.progressEmpty')

    setProgress(messages)
    setProgressIdx(0)

    // Avanza por los pasos y se queda en el ultimo hasta que termine (antes rotaba en bucle)
    const interval = setInterval(() => {
      setProgressIdx((i) => Math.min(i + 1, messages.length - 1))
    }, 3500)
    
    
    try {
      let proj: Project;

      if (mode === 'github') {
        const info = githubInfo || await parseGithubUrl(repoUrl)
        proj = await createProject({ 
          title: info.repo || t('createProject.importedTitle'),
          description: t('createProject.importedFrom', { url: repoUrl }) 
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
          const generated = await generateAndSaveEndpoints(proj.id, aiRequirement)
          setGenerationId(generated.generationId)
        } catch (aiErr) {
          // ROLLBACK: Delete project if AI generation fails
          await hardDeleteProject(proj.id);
          throw aiErr;
        }
      }

      clearInterval(interval)
      setProgressIdx(messages.length)
      setCreatedProject(proj)
      setStep('success')
    } catch (err: any) {
      clearInterval(interval)
      setError(getBackendErrorMessage(err, t))
      setLimitReached(getBackendErrorCode(err) === 'PLAN_LIMIT_REACHED')
      playErrorSound()
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={closeAndReset} noPadding maxWidth="900px">
      <article className={styles.modalContent}>
        {/* Step Indicator */}
        {STEPS.includes(step) && (
          <nav className={styles.stepIndicator} aria-label={t('createProject.steps', { current: STEPS.indexOf(step) + 1, total: STEPS.length })}>
            {tl('createProject.stepNames').map((name, i) => (
              <span
                key={name}
                className={`${styles.seg} ${step === STEPS[i] ? styles.active : ''} ${i < STEPS.indexOf(step) ? styles.done : ''}`}
                aria-current={step === STEPS[i] ? 'step' : undefined}
              >
                <span className={styles.segLabel}><b>0{i + 1}</b>{name}</span>
                <span className={styles.segTrack}><span /></span>
              </span>
            ))}
          </nav>
        )}

        {/* Step 1: Selection */}
        {step === 'select' && (
          <>
            <header className={styles.header}>
              <h2>{t('createProject.title')}</h2>
              <p>{t('createProject.subtitle')}</p>
            </header>
            <section className={styles.selectionGrid}>
              <button type="button" className={styles.selectionCard} onClick={() => handleSelectMode('empty')}>
                <figure className={styles.icon}>
                  <Icon src={emptyProjectIcon} size={36} color="var(--color-accent-text)" />
                </figure>
                <h3>{t('createProject.emptyTitle')}</h3>
                <p>{t('createProject.emptyText')}</p>
              </button>
              <button type="button" className={styles.selectionCard} onClick={() => handleSelectMode('github')}>
                <figure className={styles.icon}>
                  <Icon src={githubIcon} size={36} color="var(--color-text)" />
                </figure>
                <h3>{t('createProject.githubTitle')}</h3>
                <p>{t('createProject.githubText')}</p>
              </button>
            </section>
            <nav className={styles.actions}>
              <button className={styles.cancelBtn} onClick={closeAndReset}>{t('common.cancel')}</button>
            </nav>
          </>
        )}

        {/* Step 2: Config */}
        {step === 'config' && (
          <>
            <header className={styles.header}>
              <h2>{mode === 'github' ? t('createProject.githubStepTitle') : t('createProject.detailsTitle')}</h2>
              <p>{mode === 'github' ? t('createProject.githubStepText') : t('createProject.detailsText')}</p>
            </header>
            
            <section className={styles.stepContent}>
              {mode === 'github' ? (
                <article className={styles.formGroup}>
                  <label htmlFor={`${uid}-repo`}>{t('createProject.repoUrl')}</label>
                  <div className={styles.fieldWrap}>
                    <Icon src={linkIcon} size={18} />
                    <input
                      id={`${uid}-repo`}
                      type="url"
                      className={styles.input}
                      placeholder="https://github.com/username/repo"
                      value={repoUrl}
                      onChange={e => setRepoUrl(e.target.value)}
                      autoFocus
                    />
                  </div>
                </article>
              ) : (
                <>
                  <article className={styles.formGroup}>
                    <label htmlFor={`${uid}-title`}>{t('createProject.projectTitle')}</label>
                    <div className={styles.fieldWrap}>
                      <Icon src={folderIcon} size={18} />
                      <input
                        id={`${uid}-title`}
                        className={styles.input}
                        placeholder={t('createProject.projectTitlePlaceholder')}
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        autoFocus
                      />
                    </div>
                  </article>
                  <article className={styles.formGroup}>
                    <label htmlFor={`${uid}-description`}>{t('createProject.description')}</label>
                    <input
                      id={`${uid}-description`}
                      className={styles.input}
                      placeholder={t('createProject.descriptionPlaceholder')}
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                    />
                  </article>
                </>
              )}
              <ModalErrorAlert message={error} />
            </section>

            <nav className={styles.actions}>
              <button className={styles.cancelBtn} onClick={() => setStep('select')} disabled={validating}>{t('common.back')}</button>
              <button 
                className={styles.primaryBtn} 
                onClick={handleConfigNext}
                disabled={(mode === 'github' && !repoUrl) || (mode === 'empty' && !title) || validating}
              >
                {validating ? t('createProject.checking') : t('common.continue')}
              </button>
            </nav>
          </>
        )}

        {/* Step 3: AI Prompt */}
        {step === 'ai_prompt' && (
          <>
            <header className={styles.header}>
              <h2>{t('createProject.aiTitle')}</h2>
              <p>{t('createProject.aiText')}</p>
            </header>

            <section className={styles.stepContent}>
              <article className={styles.aiCard}>
                <figure className={styles.aiIcon}>
                  <Icon src={aiSparkleIcon} size={34} color="var(--color-accent-text)" />
                </figure>
                <article className={styles.aiText}>
                  <h4>{t('createProject.aiCardTitle')}</h4>
                  <p>{t('createProject.aiCardText')}</p>
                </article>
              </article>

              <article className={styles.aiToggle}>
                <input 
                  type="checkbox" 
                  id="shouldGenerate"
                  checked={shouldGenerate}
                  onChange={e => setShouldGenerate(e.target.checked)}
                  className={styles.checkbox}
                />
                <label htmlFor="shouldGenerate" className={styles.checkboxLabel}>{t('createProject.aiToggle')}</label>
              </article>

              {shouldGenerate && (
                <article className={styles.formGroup}>
                  <label htmlFor={`${uid}-prompt`}>{t('createProject.aiPrompt')}</label>
                  <textarea
                    id={`${uid}-prompt`}
                    className={styles.textarea}
                    value={aiRequirement}
                    onChange={e => setAiRequirement(e.target.value)}
                    maxLength={MAX_AI_REQUIREMENT_CHARS}
                    placeholder={t('createProject.aiPromptPlaceholder')}
                  />
                </article>
              )}

              <ModalErrorAlert message={error} />
              {limitReached && (
                <Link to={PATHS.billing} className={styles.upgradeLink} onClick={closeAndReset}>
                  {t('billing.upgradeCta')} →
                </Link>
              )}

              {loading && (
                <ul className={styles.log} role="status" ref={(el) => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}>
                  {progress.map((message, i) => (
                    <li key={message} className={i < progressIdx ? styles.logDone : i === progressIdx ? styles.logNow : undefined}>
                      <span className={styles.logState} aria-hidden="true">
                        {i < progressIdx && <Icon src={checkIcon} size={16} />}
                        {i === progressIdx && <Icon src={loaderIcon} size={16} className={styles.spinner} />}
                      </span>
                      {message}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <nav className={styles.actions}>
              <button className={styles.cancelBtn} onClick={() => setStep('config')} disabled={loading}>{t('common.back')}</button>
              <button 
                className={styles.primaryBtn} 
                onClick={createProjectFlow}
                disabled={loading}
              >
                {loading ? t('createProject.creating') : t('createProject.create')}
              </button>
            </nav>
          </>
        )}

        {/* Step 4: Success */}
        {step === 'success' && createdProject && (
          <article className={styles.successContent}>
            <header className={styles.header}>
              <figure className={styles.successBadge} aria-hidden="true">✓</figure>
              <h2>{t('createProject.successTitle')}</h2>
              <p>{t('createProject.successText')}</p>
            </header>

            <section className={styles.stepContent}>
              <article className={styles.connectionCard}>
                <article className={styles.infoGroup}>
                  <label>{t('createProject.mockBaseUrl')}</label>
                  <article className={styles.infoDisplay}>
                    <section className={styles.infoBox}>
                      <code>{mockBaseUrl}</code>
                    </section>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(mockBaseUrl)
                        setCopiedUrl(true)
                        setTimeout(() => setCopiedUrl(false), 2000)
                      }}
                      className={`${styles.copyBtn} ${copiedUrl ? styles.copied : ''}`}
                    >
                      {copiedUrl ? t('common.copied') : t('common.copy')}
                    </button>
                  </article>
                </article>

                <article className={styles.instructionNote}>
                  <figure className={styles.noteIcon} aria-hidden="true">!</figure>
                  <span className={styles.noteText}>
                    <strong>{t('createProject.important')}</strong>{' '}
                    {rich('createProject.publicNote', { strong: (chunk) => <strong>{chunk}</strong> })}
                  </span>
                </article>
              </article>
              <AiFeedback generationId={generationId} />
            </section>

            <nav className={styles.actions}>
              <button 
                className={styles.primaryBtn} 
                onClick={() => {
                  onCreated(createdProject)
                  closeAndReset()
                }}
              >
                {t('createProject.goToEditor')}
              </button>
            </nav>
          </article>
        )}
      </article>
    </Modal>
  )
}

export default CreateProjectModal
