import React from 'react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useNavigate } from 'react-router-dom'

const Index: React.FC = () => {
  const navigate = useNavigate()
  return (
    <section style={{ padding: 'var(--spacing-5)' }}>
      <Card title="Página de Inicio">
        <p>Bienvenido a Mockia.io. Utiliza los botones para navegar a las páginas de prueba.</p>
        <nav style={{ display: 'flex', gap: 'var(--spacing-3)', flexWrap: 'wrap', marginTop: 'var(--spacing-3)' }}>
          <Button onClick={() => navigate('/login')}>Login</Button>
          <Button onClick={() => navigate('/signup')}>Signup</Button>
          <Button onClick={() => navigate('/dashboard')}>Dashboard</Button>
        </nav>
      </Card>
    </section>
  )
}

export default Index
