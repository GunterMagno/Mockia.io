import React, { useEffect, useState } from 'react'
import Layout from '../../layouts/Layout'
import { Button } from '../../components/ui/Button/Button'
import { getProjects } from '../../services/projectService'
import type { Project } from '../../services/projectService'
import CreateProjectModal from '../../components/projects/CreateProjectModal'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../components/ui/Icon/Icon'
import { useAuth } from '../../contexts/AuthContext'
import folderIcon from '../../assets/folder.svg'

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
        try {
          const lastVisited = JSON.parse(localStorage.getItem('mockia_last_visited') || '{}')
          const getProjectTime = (p: Project) => {
            const localVis = lastVisited[p.id] || 0
            const dbUp = p.updatedAt ? new Date(p.updatedAt).getTime() : 0
            const dbCr = p.createdAt ? new Date(p.createdAt).getTime() : 0
            return Math.max(localVis, dbUp, dbCr)
          }

          const sorted = [...ps].sort((a, b) => getProjectTime(b) - getProjectTime(a))
          setProjects(sorted)
        } catch (e) {
          console.error("Error sorting projects:", e)
          setProjects(ps)
        }
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
        <article className={styles.titleSection}>
          <h1>My Projects</h1>
          <p>Manage your mock APIs and automations</p>
        </article>
        <Button size="lg" onClick={() => setOpen(true)}>
          <span className={styles.plus}>+</span> New Project
        </Button>
      </header>

      {loading ? (
        <section className={styles.loadingWrapper}>
          <span>Loading projects...</span>
        </section>
      ) : projects.length === 0 ? (
        <section className={styles.emptyState}>
          <figure className={styles.iconWrapper}>
            <Icon src={folderIcon} size={64} color="var(--muted)" />
          </figure>
          <h3>No projects yet</h3>
          <p>Create an empty one or import from GitHub to get started.</p>
          <Button onClick={() => setOpen(true)}>Create my first project</Button>
        </section>
      ) : (
        <section className={styles.grid}>
          {projects.map((p) => (
            <article 
              key={p.id} 
              onClick={() => navigate(`/editor/${p.slug}`)} 
              className={styles.projectCard}
            >
              <header className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>{p.title}</h3>
                {p.members.some(m => m.userId === user?.id && m.role !== 'OWNER') && (
                  <span className={styles.sharedBadge}>Shared</span>
                )}
              </header>
              <p className={styles.description}>
                {p.description || 'No description provided.'}
              </p>
              <footer className={styles.cardFooter}>
                <div className={styles.meta}>
                  {p.gitHubRepo ? (
                    <span className={`${styles.badge} ${styles.github}`}>
                      <span className={styles.badgeDot}></span>
                      GitHub
                    </span>
                  ) : (
                    <span className={`${styles.badge} ${styles.local}`}>
                      <span className={styles.badgeDot}></span>
                      Local
                    </span>
                  )}
                </div>
                <span className={styles.date}>
                  {p.updatedAt ? new Date(p.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recently'}
                </span>
              </footer>
            </article>
          ))}
        </section>
      )}
      
      <CreateProjectModal isOpen={open} onClose={() => setOpen(false)} onCreated={handleCreated} />
    </Layout>
  )
}

export default Dashboard
