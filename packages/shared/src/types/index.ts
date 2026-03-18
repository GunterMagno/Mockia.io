/**
 * Shared Types for Mockia.io
 * Used across Frontend and Backend
 */

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  timestamp: string;
}

// User Types
export interface User {
  id: string;
  email: string;
  username: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserRequest {
  email: string;
  password: string;
  username: string;
}

// Mock API Types
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

// Error Types
export enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
}
