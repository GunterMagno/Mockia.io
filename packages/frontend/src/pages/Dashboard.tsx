import React from 'react'
import { Card } from '../components/ui/Card'

const Dashboard: React.FC = () => {
  return (
    <div style={{ padding: 20 }}>
      <Card title="Dashboard">
        <p>Bienvenido al panel protegido. Esta página es una demostración.</p>
      </Card>
    </div>
  )
}

export default Dashboard
