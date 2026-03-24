import { Request } from 'express';

/**
 * Extended Request with authentication information
 */
export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
  requestId?: string;
}
