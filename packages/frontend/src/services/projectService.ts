import { api } from './api'
import { filenameFromDisposition } from '../utils/download'
import type { 
  Project, 
  CreateProjectRequest, 
  ImportGitHubRequest 
} from '@mockia/shared'

export type { Project, CreateProjectRequest, ImportGitHubRequest }

export const getProjects = async (): Promise<Project[]> => {
  const res = await api.get<{ data: Project[] }>('/projects?populate=members')
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

export const getProjectById = async (id: string): Promise<Project> => {
  const res = await api.get<{ data: Project }>(`/projects/${id}`)
  return res.data.data
}

export const updateProject = async (id: string, payload: { title?: string, description?: string }): Promise<Project> => {
  const res = await api.put<{ data: Project }>(`/projects/${id}`, payload)
  return res.data.data
}

export const archiveProject = async (id: string): Promise<Project> => {
  const res = await api.delete<{ data: Project }>(`/projects/${id}`)
  return res.data.data
}

export const hardDeleteProject = async (id: string): Promise<void> => {
  await api.delete(`/projects/${id}/hard`)
}

export const addProjectMember = async (projectId: string, targetEmail: string, role: string): Promise<Project> => {
  const res = await api.post<{ data: Project }>(`/projects/${projectId}/members`, { targetEmail, role })
  return res.data.data
}

export const removeProjectMember = async (projectId: string, userId: string): Promise<Project> => {
  const res = await api.delete<{ data: Project }>(`/projects/${projectId}/members/${userId}`)
  return res.data.data
}

export const regenerateApiKey = async (projectId: string): Promise<Project> => {
  const res = await api.post<{ data: Project }>(`/projects/${projectId}/regenerate-api-key`)
  return res.data.data
}

export const leaveProject = async (projectId: string): Promise<void> => {
  await api.post(`/projects/${projectId}/leave`)
}


export type ExportFormat = 'openapi' | 'postman' | 'msw'

const EXPORT_FALLBACK_NAME: Record<ExportFormat, string> = {
  openapi: 'openapi.json',
  postman: 'collection.postman_collection.json',
  msw: 'handlers.ts',
}

/**
 * Descarga los mocks del proyecto (GET /projects/:id/export?format=...) con el token Bearer en memoria.
 * Devuelve el contenido y el nombre de archivo que propone el servidor (Content-Disposition).
 */
export const exportProject = async (projectId: string, format: ExportFormat): Promise<{ blob: Blob; filename: string }> => {
  const res = await api.get<Blob>(`/projects/${encodeURIComponent(projectId)}/export`, { params: { format }, responseType: 'blob' })
  return { blob: res.data, filename: filenameFromDisposition(res.headers['content-disposition'], EXPORT_FALLBACK_NAME[format]) }
}
