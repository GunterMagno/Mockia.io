import React, { useEffect, useState } from 'react'
import Layout from '../layouts/Layout'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { getProjects } from '../services/projectService'
import type { Project } from '../services/projectService'
import CreateProjectModal from '../components/projects/CreateProjectModal'

const Dashboard: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    getProjects()
      .then((ps) => setProjects(ps))
      .catch(() => setProjects([]))
  }, [])

  const handleCreated = (p: Project) => {
    setProjects((prev) => [p, ...prev])
  }

  return (
    <Layout>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2>Dashboard</h2>
        <Button onClick={() => setOpen(true)}>Create Project</Button>
      </header>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 16 }}>
        {projects.map((p) => (
          <Card key={p.id} title={p.title}>
            <p style={{ color: 'var(--muted)', margin: 0 }}>{p.description}</p>
          </Card>
        ))}
      </section>
      <CreateProjectModal isOpen={open} onClose={() => setOpen(false)} onCreated={handleCreated} />
    </Layout>
  )
}

export default Dashboard
