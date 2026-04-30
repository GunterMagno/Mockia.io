import React from 'react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useNavigate } from 'react-router-dom'

const Index: React.FC = () => {
  const navigate = useNavigate()
  return (
    <div style={{ padding: 20 }}>
      <Card title="Página de Inicio">
        <p>Bienvenido a Mockia.io. Utiliza los botones para navegar a las páginas de prueba.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
          <Button onClick={() => navigate('/login')}>Login</Button>
          <Button onClick={() => navigate('/signup')}>Signup</Button>
          <Button onClick={() => navigate('/dashboard')}>Dashboard</Button>
        </div>
      </Card>
    </div>
  )
}

export default Index
