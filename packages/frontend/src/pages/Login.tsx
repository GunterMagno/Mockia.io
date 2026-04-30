import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { api } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { getBackendErrorMessage } from '../utils/error'

const Login: React.FC = () => {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await login({ email, password })
      navigate('/dashboard')
    } catch (err: any) {
      setError(getBackendErrorMessage(err))
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '4rem auto' }}>
      <h2>Login</h2>
      <form onSubmit={onSubmit}>
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div style={{ color: 'red', marginTop: 8 }}>{error}</div>}
        <div style={{ marginTop: 12 }}>
          <Button type="submit">Iniciar sesión</Button>
        </div>
      </form>
    </div>
  )
}

export default Login
