import React, { useEffect, useState } from 'react'
import Layout from '../layouts/Layout'
import { Card } from '../components/ui/Card/Card'
import { Button } from '../components/ui/Button/Button'
import { getProjects } from '../services/projectService'
import type { Project } from '../services/projectService'
import CreateProjectModal from '../components/projects/CreateProjectModal'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/ui/Icon/Icon'
import { useAuth } from '../contexts/AuthContext'
import folderIcon from '../assets/folder.svg'

import styles from './Dashboard.module.scss'

const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  const fetchProjects = (silent = false) => {
    if (!silent) setLoading(true)
    getProjects()
      .then((ps) => {
        // Simple optimization: only update if length or IDs changed
        setProjects(ps)
      })
      .catch(() => setProjects([]))
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }

  useEffect(() => {
    fetchProjects()
    
    const interval = setInterval(() => {
      fetchProjects(true)
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  const handleCreated = (p: Project) => {
    setProjects((prev) => [p, ...prev])
    navigate(`/editor/${p.slug}`)
  }

  return (
    <Layout>
      <header className={styles.header}>
        <div className={styles.titleSection}>
          <h1>My Projects</h1>
          <p>Manage your mock APIs and automations</p>
        </div>
        <Button size="lg" onClick={() => setOpen(true)}>
          <span className={styles.plus}>+</span> New Project
        </Button>
      </header>

      {loading ? (
        <div className={styles.loadingWrapper}>
          <div>Loading projects...</div>
        </div>
      ) : projects.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.iconWrapper}>
            <Icon src={folderIcon} size={64} color="var(--muted)" />
          </div>
          <h3>No projects yet</h3>
          <p>Create an empty one or import from GitHub to get started.</p>
          <Button onClick={() => setOpen(true)}>Create my first project</Button>
        </div>
      ) : (
        <section className={styles.grid}>
          {projects.map((p) => (
            <div 
              key={p.id} 
              onClick={() => navigate(`/editor/${p.slug}`)} 
              className={styles.cardWrapper}
            >
              <Card title={p.title} className={styles.projectCard}>
                <p className={styles.description}>
                  {p.description || 'No description'}
                </p>
                <div className={styles.cardFooter}>
                  <div className={styles.meta}>
                    <span>{p.gitHubRepo ? '🔗 GitHub' : '📄 Local'}</span>
                    {p.members.some(m => m.userId === user?.id && m.role !== 'OWNER') && (
                      <span className={styles.sharedBadge}>Shared</span>
                    )}
                  </div>
                  <span>{p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : 'Recently'}</span>
                </div>
              </Card>
            </div>
          ))}
        </section>
      )}
      
      <CreateProjectModal isOpen={open} onClose={() => setOpen(false)} onCreated={handleCreated} />
    </Layout>
  )
}

export default Dashboard
