import { api } from './api'

export interface GitHubUrlParsed {
  owner: string
  repo: string
  branch: string
  url: string
}

export interface IngestResponse {
  owner: string
  repo: string
  branch: string
  fileCount: number
  files: string[]
  analysisTime: number
}

/**
 * Parses a GitHub URL using the backend API
 * @param url GitHub repository URL
 * @returns Parsed information (owner, repo, branch)
 */
export const parseGithubUrl = async (url: string): Promise<GitHubUrlParsed> => {
  const res = await api.post<{ data: GitHubUrlParsed }>('/github/parse', { url })
  return res.data.data
}

/**
 * Clones and analyzes a GitHub repository for preview/ingestion
 * @param url GitHub repository URL
 * @param branch Optional branch name
 * @returns Analysis results
 */
export const ingestGithubRepo = async (url: string, branch?: string): Promise<IngestResponse> => {
  const res = await api.post<{ data: IngestResponse }>('/github/ingest', { url, branch })
  return res.data.data
}
