import React from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../components/ui/Card'

const Layout: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: 240, borderRight: '1px solid var(--border)', padding: 'var(--spacing-4)' }}>
        <nav>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            <li style={{ margin: 'var(--spacing-2) 0' }}>
              <Link to="/">Dashboard</Link>
            </li>
            <li style={{ margin: 'var(--spacing-2) 0' }}>
              <Link to="/dashboard">Dashboard</Link>
            </li>
            <li style={{ margin: 'var(--spacing-2) 0' }}>
              <Link to="/settings">Settings</Link>
            </li>
          </ul>
        </nav>
      </aside>
      <main style={{ flex: 1, padding: 'var(--spacing-4)' }}>
        <header style={{ display: 'flex', justifyContent: 'flex-end', padding: 'var(--spacing-2) 0' }}>
          {/* Placeholder for user avatar/name */}
          <Card style={{ padding: 'var(--spacing-2)' }} title={''}>
            <span>Usuario</span>
          </Card>
        </header>
        <section>{children}</section>
      </main>
    </div>
  )
}

export default Layout
