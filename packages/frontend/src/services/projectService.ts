import { api } from './api'
import type { 
  Project, 
  CreateProjectRequest, 
  ImportGitHubRequest 
} from '@mockia/shared'

export type { Project, CreateProjectRequest, ImportGitHubRequest }

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
