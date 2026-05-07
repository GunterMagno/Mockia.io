import React, { useState } from 'react'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { createProject, importFromGitHub } from '../../services/projectService'
import type { Project } from '../../services/projectService'

type Props = {
  isOpen: boolean
  onClose: () => void
  onCreated: (p: Project) => void
}

const CreateProjectModal: React.FC<Props> = ({ isOpen, onClose, onCreated }) => {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'empty' | 'github'>('empty')
  const [created, setCreated] = useState<Project | null>(null)

  const reset = () => {
    setTitle('')
    setDescription('')
    setRepoUrl('')
    setLoading(false)
    setTab('empty')
    setCreated(null)
  }

  const closeAndReset = () => {
    onClose()
    reset()
  }

  const handleCreateEmpty = async () => {
    if (!title) return
    setLoading(true)
    try {
      const proj = await createProject({ title, description })
      setCreated(proj)
      onCreated(proj)
      closeAndReset()
    } catch {
      // ignore for now; UI can show a toast if desired
      setLoading(false)
    }
  }

  const handleImportGitHub = async () => {
    if (!repoUrl) return
    setLoading(true)
    try {
      let proj = created
      if (!proj) {
        // Create a minimal project first
        proj = await createProject({ title: title || 'Imported GitHub Project', description })
      }
      const updated = await importFromGitHub(proj.id, { repoUrl })
      onCreated(updated)
      closeAndReset()
    } catch {
      setLoading(false)
    }
  }

  const onSubmit = async () => {
    if (tab === 'empty') {
      await handleCreateEmpty()
    } else {
      await handleImportGitHub()
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={closeAndReset} title="Crear Proyecto">
      <nav style={{ display: 'flex', marginBottom: 'var(--spacing-3)' }}>
        <button
          onClick={() => setTab('empty')}
          style={{ padding: 'var(--spacing-2) var(--spacing-3)', border: '1px solid var(--border-strong)', borderBottom: tab === 'empty' ? '2px solid var(--color-primary)' : undefined, marginRight: 'var(--spacing-2)' }}
        >
          Proyecto vacío
        </button>
        <button
          onClick={() => setTab('github')}
          style={{ padding: 'var(--spacing-2) var(--spacing-3)', border: '1px solid var(--border-strong)', borderBottom: tab === 'github' ? '2px solid var(--color-primary)' : undefined }}
        >
          Importar desde GitHub
        </button>
      </nav>
      {tab === 'empty' ? (
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <Input label="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input label="Descripción" value={description} onChange={(e) => setDescription(e.target.value)} />
        </fieldset>
      ) : (
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <Input label="Repo URL" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
        </fieldset>
      )}
      <footer style={{ display: 'flex', justifyContent: 'flex-end', margin: 'var(--spacing-3) 0 0 0' }}>
        <Button onClick={onSubmit} disabled={loading}>{loading ? 'Procesando...' : 'Crear'}</Button>
      </footer>
    </Modal>
  )
}

export default CreateProjectModal
