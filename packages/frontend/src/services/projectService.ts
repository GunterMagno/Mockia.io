import { api } from './api'
export interface Project {
  id: string
  title: string
  description?: string
  slug: string
  ownerId: string
  members: any[]
  gitHubRepo?: any
  isArchived: boolean
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

export interface CreateProjectRequest {
  title: string
  description?: string
}

export interface ImportGitHubRequest {
  repoUrl: string
  branch?: string
}

export const getProjects = async (): Promise<Project[]> => {
  const res = await api.get<{ data: Project[] }>('/projects')
  return res.data.data
}

export const createProject = async (payload: CreateProjectRequest): Promise<Project> => {
  const res = await api.post<{ data: Project }>('/projects', payload)
  return res.data.data
}

export const importFromGitHub = async (projectId: string, payload: ImportGitHubRequest): Promise<Project> => {
  const res = await api.post<{ data: Project }>(`/projects/${projectId}/import/github`, payload)
  return res.data.data
}
