import { Request, Response, NextFunction } from 'express';
import Joi, { Schema } from 'joi';
import { ErrorCode } from '@mockia/shared';
import { AppError } from './errorHandler';

/**
 * Opciones de validación simple
 */
interface ValidateOptions {
  body?: Schema;
  query?: Schema;
  params?: Schema;
}

/**
 * Middleware de validación con Joi
 * Uso: router.post('/users', validate({
 *   body: Joi.object({
 *     email: Joi.string().email().required(),
 *     password: Joi.string().min(6).required(),
 *   })
 * }), handler)
 */
export const validate = (options: ValidateOptions) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: Record<string, string[]> = {};

    // Validar body
    if (options.body) {
      const { error, value } = options.body.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (error) {
        error.details.forEach((detail) => {
          const key = detail.context?.key || 'unknown';
          if (!errors[key]) errors[key] = [];
          errors[key].push(detail.message);
        });
      } else {
        req.body = value;
      }
    }

    // Validar query
    if (options.query) {
      const { error, value } = options.query.validate(req.query, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (error) {
        error.details.forEach((detail) => {
          const key = detail.context?.key || 'unknown';
          if (!errors[key]) errors[key] = [];
          errors[key].push(detail.message);
        });
      } else {
        req.query = value;
      }
    }

    // Validar params
    if (options.params) {
      const { error, value } = options.params.validate(req.params, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (error) {
        error.details.forEach((detail) => {
          const key = detail.context?.key || 'unknown';
          if (!errors[key]) errors[key] = [];
          errors[key].push(detail.message);
        });
      } else {
        req.params = value;
      }
    }

    // Si hay errores, lanzar AppError
    if (Object.keys(errors).length > 0) {
      throw new AppError(
        'Validación fallida',
        ErrorCode.VALIDATION_ERROR,
        400,
        errors
      );
    }

    next();
  };
};
