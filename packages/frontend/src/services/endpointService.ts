import { api } from './api'

export interface EndpointData {
  id: string
  path: string
  method: string
  description: string
  requestSchema?: any
  responses?: Array<{
    statusCode: number;
    schema: any;
    examples?: any[];
  }>
  delay_ms?: number
  force_status_code?: number
}

export const getEndpoints = async (projectSlug: string): Promise<EndpointData[]> => {
  const res = await api.get<{ data: { endpoints: EndpointData[] } }>(`/mock/endpoints/${projectSlug}`)
  return res.data.data.endpoints
}

export const updateEndpoint = async (
  endpointId: string,
  payload: Partial<EndpointData> & { 
    responseBody?: any; 
    statusCode?: number; 
    delay_ms?: number; 
    force_status_code?: number 
  }
): Promise<EndpointData> => {
  const res = await api.put<{ data: EndpointData }>(`/endpoints/${endpointId}`, payload)
  return res.data.data
}

export const createEndpoint = async (projectSlug: string, payload: Partial<EndpointData>): Promise<EndpointData> => {
  const res = await api.post<{ data: EndpointData }>(`/endpoints/${projectSlug}`, payload)
  return res.data.data
}

export const deleteEndpoint = async (endpointId: string): Promise<void> => {
  await api.delete(`/endpoints/${endpointId}`)
}
