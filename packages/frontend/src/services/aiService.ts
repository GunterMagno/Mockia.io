import { api } from './api'

export interface AIGenerationResponse {
  specification: any
  database: {
    mockApiId: string
    endpointsCreated: number
    responsesCreated: number
  }
  usage: {
    totalTokens: number
  }
}

/**
 * Generates mock endpoints and saves them to the project
 * @param projectId Project ID
 * @param requirement Description of what to generate
 * @returns Generation results
 */
export const generateAndSaveEndpoints = async (
  projectId: string, 
  requirement: string
): Promise<AIGenerationResponse> => {
  const res = await api.post<{ data: AIGenerationResponse }>('/ai/generate-and-save', {
    projectId,
    requirement
  })
  return res.data.data
}
