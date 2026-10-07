import React, { useEffect, useState } from 'react'
import Layout from '../../layouts/Layout'
import { Button } from '../../components/ui/Button/Button'
import { getProjects } from '../../services/projectService'
import type { Project } from '../../services/projectService'
import CreateProjectModal from '../../components/projects/CreateProjectModal'
import EmailVerificationBanner from '../../components/ui/EmailVerificationBanner/EmailVerificationBanner'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../../components/ui/Icon/Icon'
import { useAuth } from '../../contexts/AuthContext'
import folderIcon from '../../assets/folder.svg'
import { PATHS } from '../../routes/paths'
import { useI18n } from '../../i18n/I18nProvider'
import { getBillingOverview, type BillingOverview } from '../../services/billingService'

import styles from './Dashboard.module.scss'

const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t, formatDate } = useI18n()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [billing, setBilling] = useState<BillingOverview | null>(null)

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

  // Plan y uso: se refresca cuando cambia el numero de proyectos (crear, archivar, compartir)
  useEffect(() => {
    getBillingOverview()
      .then(setBilling)
      .catch(() => setBilling(null))
  }, [projects.length])

  const projectLimit = billing?.limits.maxActiveProjects ?? null
  const atLimit = billing !== null && projectLimit !== null && billing.usage.activeProjects >= projectLimit

  const handleCreated = (p: Project) => {
    setProjects((prev) => [p, ...prev])
    navigate(PATHS.editor(p.slug))
  }

  return (
    <Layout>
      <EmailVerificationBanner />
      <header className={styles.header}>
        <article className={styles.titleSection}>
          <h1>{t('dashboard.title')}</h1>
          <p>{t('dashboard.subtitle')}</p>
          {billing && (
            <Link to={PATHS.billing} className={`${styles.planChip} ${atLimit ? styles.planChipWarn : ''}`}>
              <span>{t('billing.planBadge', { plan: t(`pricing.plans.${billing.plan}.name`) })}</span>
              {projectLimit !== null && (
                <span>· {t('billing.projectsUsage', { used: billing.usage.activeProjects, limit: projectLimit })}</span>
              )}
              {billing.plan !== 'team' && (atLimit || billing.plan === 'free') && (
                <strong className={styles.planChipCta}>{t('billing.upgradeCta')} →</strong>
              )}
            </Link>
          )}
        </article>
        <Button size="lg" onClick={() => setOpen(true)}>
          <span className={styles.plus} aria-hidden="true">+</span> {t('dashboard.newProject')}
        </Button>
      </header>

      {loading ? (
        <section className={styles.loadingWrapper} role="status">
          <span>{t('dashboard.loading')}</span>
        </section>
      ) : projects.length === 0 ? (
        <section className={styles.emptyState}>
          <figure className={styles.iconWrapper}>
            <Icon src={folderIcon} size={64} color="var(--muted)" />
          </figure>
          <h3>{t('dashboard.emptyTitle')}</h3>
          <p>{t('dashboard.emptyText')}</p>
          <Button onClick={() => setOpen(true)}>{t('dashboard.emptyCta')}</Button>
        </section>
      ) : (
        <section className={styles.grid}>
          {projects.map((p) => (
            <article
              key={p.id}
              className={styles.projectCard}
            >
              <header className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>
                  <Link to={PATHS.editor(p.slug)} className={styles.cardLink}>{p.title}</Link>
                </h3>
                {p.members.some(m => m.userId === user?.id && m.role !== 'OWNER') && (
                  <span className={styles.sharedBadge}>{t('dashboard.shared')}</span>
                )}
              </header>
              <p className={styles.description}>
                {p.description || t('dashboard.noDescription')}
              </p>
              <footer className={styles.cardFooter}>
                <div className={styles.meta}>
                  {p.gitHubRepo ? (
                    <span className={`${styles.badge} ${styles.github}`}>
                      <span className={styles.badgeDot}></span>
                      {t('dashboard.github')}
                    </span>
                  ) : (
                    <span className={`${styles.badge} ${styles.local}`}>
                      <span className={styles.badgeDot}></span>
                      {t('dashboard.local')}
                    </span>
                  )}
                </div>
                <span className={styles.date}>
                  {p.updatedAt ? formatDate(p.updatedAt, { month: 'short', day: 'numeric', year: 'numeric' }) : t('dashboard.recently')}
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
