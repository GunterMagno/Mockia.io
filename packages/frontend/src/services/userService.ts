import { api } from './api'

export interface UserProfile {
  id: string
  email: string
  fullName?: string
  username?: string
  createdAt: string
  updatedAt: string
}

export const getProfile = async (): Promise<UserProfile> => {
  const res = await api.get<UserProfile>('/users/profile')
  return res.data
}

export const updateProfile = async (payload: { fullName?: string, username?: string }): Promise<UserProfile> => {
  const res = await api.put<UserProfile>('/users/profile', payload)
  return res.data
}

export const changePassword = async (payload: { currentPassword: string, newPassword: string }): Promise<void> => {
  await api.post('/users/change-password', payload)
}

/**
 * Descarga el JSON con todos los datos personales (GET /users/me/export). Devuelve el contenido y el nombre de archivo
 * que propone el servidor (Content-Disposition), con uno propio de respaldo.
 */
export const exportMyData = async (): Promise<{ blob: Blob; filename: string }> => {
  const res = await api.get<Blob>('/users/me/export', { responseType: 'blob' })
  const disposition = String(res.headers['content-disposition'] ?? '')
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `mockia-export-${new Date().toISOString().slice(0, 10)}.json`
  return { blob: res.data, filename }
}

/** Borra la cuenta y todos sus datos (DELETE /users/me). Pide la contrasena; cancela antes la suscripcion de Stripe. */
export const deleteMyAccount = async (password: string): Promise<void> => {
  await api.delete('/users/me', { data: { password } })
}
