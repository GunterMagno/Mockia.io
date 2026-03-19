import { Request } from 'express';

/**
 * Request extendido con información de autenticación
 */
export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
  requestId?: string;
}
