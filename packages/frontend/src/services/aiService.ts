import { api } from './api'

/** Longest requirement the backend accepts (generationBodySchema: 4000 characters). */
export const MAX_AI_REQUIREMENT_CHARS = 4000

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
  /** Random id of this generation; send it back with the user's feedback. Absent on servers that predate feedback. */
  generationId?: string
}

export type AiVerdict = 'good' | 'bad'

/** Thumbs up / down on a generation (POST /ai/feedback). The latest vote per generation wins on the server. */
export const sendAiFeedback = async (generationId: string, verdict: AiVerdict): Promise<void> => {
  await api.post('/ai/feedback', { generationId, verdict })
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
