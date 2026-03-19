/**
 * Mock API Types
 */

export interface MockAPI {
  id: string;
  name: string;
  description?: string;
  baseUrl: string;
  endpoints: MockEndpoint[];
  createdAt: string;
  updatedAt: string;
}

export interface MockEndpoint {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  responseSchema: Record<string, any>;
  statusCode: number;
}

export interface CreateMockAPIRequest {
  name: string;
  description?: string;
  baseUrl: string;
}
