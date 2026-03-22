import { Request, Response, NextFunction } from 'express';
import { ErrorCode } from '@mockia/shared';

/**
 * Clase personalizada para errores de la API
 */
export class AppError extends Error {
  constructor(
    public message: string,
    public code: ErrorCode,
    public statusCode: number,
    public details?: Record<string, any>
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * Middleware global de manejo de errores
 * Normaliza todas las respuestas de error
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  }

  // Manejo específico para DuplicateUserError
  else if (err.name === 'DuplicateUserError') {
    appError = new AppError(
      err.message,
      ErrorCode.CONFLICT,
      409
    );
  }

  else if (err.name === 'ValidationError' || err.name === 'CastError') {
    appError = new AppError(
      'Error de validación',
      ErrorCode.VALIDATION_ERROR,
      400,
      { originalError: err.message }
    );
  }
  else {
    appError = new AppError(
      err.message || 'Error interno del servidor',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }

  // Logging
  console.error(`[${new Date().toISOString()}] ${appError.code}:`, {
    message: appError.message,
    path: req.path,
    method: req.method,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });

  // Respuesta normalizada
  res.status(appError.statusCode).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(process.env.NODE_ENV === 'development' && appError.details && { details: appError.details }),
    },
    timestamp: new Date().toISOString(),
  });
};

/**
 * Middleware para 404
 */
export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const error = new AppError(
    `Ruta no encontrada: ${req.method} ${req.path}`,
    ErrorCode.NOT_FOUND,
    404
  );
  next(error);
};

/**
 * Wrapper para async en rutas
 * Uso: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
