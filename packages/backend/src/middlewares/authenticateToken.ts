import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../auth/jwt.service';
import { AppError } from './errorHandler';
import { ErrorCode } from '@mockia/shared';

/**
 * Extended Request with user information
 * Added by the authenticateToken middleware
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
  };
}

/**
 * Middleware to authenticate JWT tokens from the Authorization header
 * 
 * Expected header format: Authorization: Bearer <accessToken>
 * 
 * Flow:
 * 1. Extract the Authorization header
 * 2. Parse the Bearer token
 * 3. Verify the JWT with verifyAccessToken
 * 4. Attach user info to req.user
 * 5. Call next() to continue to the next middleware/controller
 * 
 * Errors:
 * - 401 if header is missing
 * - 401 if token format is invalid
 * - 401 if token is invalid or expired
 * 
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    // 1. Extract the Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new AppError(
        'Missing authorization header',
        ErrorCode.UNAUTHORIZED,
        401
      );
    }

    // 2. Parse the Bearer token
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new AppError(
        'Invalid authorization header format. Expected: Bearer <token>',
        ErrorCode.UNAUTHORIZED,
        401
      );
    }

    const token = parts[1];

    // 3. Verify the JWT
    const payload = verifyAccessToken(token);

    // 4. Attach user info to request
    const userId = payload.sub;
    req.user = { id: userId };

    // 5. Continue to next middleware/controller
    next();
  } catch (error) {
    // If error is not already an AppError, convert it
    if (error instanceof AppError) {
      next(error);
    } else {
      const appError = new AppError(
        'Invalid or expired token',
        ErrorCode.UNAUTHORIZED,
        401
      );
      next(appError);
    }
  }
}
