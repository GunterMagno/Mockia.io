import { api } from './api';

/** Longest requirement the backend accepts (generationBodySchema: 4000 characters). */
export const MAX_AI_REQUIREMENT_CHARS = 4000;

export interface AIGenerationResponse {
  specification: any;
  database: {
    mockApiId: string;
    endpointsCreated: number;
    responsesCreated: number;
  };
  usage: {
    totalTokens: number;
  };
  /** Random id of this generation; send it back with the user's feedback. Absent on servers that predate feedback. */
  generationId?: string;
}

export type AiVerdict = 'good' | 'bad';

/** Thumbs up / down on a generation (POST /ai/feedback). The latest vote per generation wins on the server. */
export const sendAiFeedback = async (generationId: string, verdict: AiVerdict): Promise<void> => {
  await api.post('/ai/feedback', { generationId, verdict });
};

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
    requirement,
  });
  return res.data.data;
};

/** Cuota mensual de IA tal y como la informa GET /ai/quota (solo informa: no reserva nada). */
export interface AiQuotaStatus {
  used: number;
  /** null: el plan no tiene tope. */
  limit: number | null;
  resetsAt: string;
  available: boolean;
}

/**
 * Consulta la cuota de IA sin gastarla. Si la consulta falla (red, servidor antiguo) devuelve null: quien llama sigue
 * como si no hubiera aviso, porque la reserva atomica del servidor es la que decide.
 */
export const fetchAiQuota = async (): Promise<AiQuotaStatus | null> => {
  try {
    const res = await api.get<{ data: AiQuotaStatus }>('/ai/quota');
    const d = res.data?.data;
    if (!d || typeof d.available !== 'boolean') return null;
    return d;
  } catch {
    return null;
  }
};
