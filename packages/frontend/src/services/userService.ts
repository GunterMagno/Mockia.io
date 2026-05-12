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
