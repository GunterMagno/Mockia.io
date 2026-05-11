import React from 'react'
import { Card } from '../components/ui/Card/Card'
import { Button } from '../components/ui/Button/Button'
import { useNavigate } from 'react-router-dom'

import styles from './Index.module.scss'

const Index: React.FC = () => {
  const navigate = useNavigate()
  return (
    <section className={styles.section}>
      <Card title="Home Page">
        <p>Welcome to Mockia.io. Use the buttons below to navigate to test pages.</p>
        <nav className={styles.nav}>
          <Button onClick={() => navigate('/login')}>Login</Button>
          <Button onClick={() => navigate('/signup')}>Signup</Button>
          <Button onClick={() => navigate('/dashboard')}>Dashboard</Button>
        </nav>
      </Card>
    </section>
  )
}

export default Index
