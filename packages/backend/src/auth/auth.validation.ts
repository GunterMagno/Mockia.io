import Joi from 'joi';
import { CreateUserRequest } from '@mockia/shared';

/**
 * Esquema de validación para el registro de usuario
 * Valida que el body de la petición coincida con CreateUserRequest
 */
export const registerSchema = Joi.object<CreateUserRequest>({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'El email debe ser válido',
      'any.required': 'El email es requerido',
    }),
  password: Joi.string()
    .min(8)
    .required()
    .messages({
      'string.min': 'La contraseña debe tener al menos 8 caracteres',
      'any.required': 'La contraseña es requerida',
    }),
  username: Joi.string()
    .min(2)
    .max(80)
    .required()
    .messages({
      'string.min': 'El nombre de usuario debe tener al menos 2 caracteres',
      'string.max': 'El nombre de usuario no puede exceder 80 caracteres',
      'any.required': 'El nombre de usuario es requerido',
    })
});

/**
 * Esquema para validación de login
 * (Útil para futuras rutas de autenticación)
 */
export const loginSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'El email debe ser válido',
      'any.required': 'El email es requerido',
    }),
  password: Joi.string()
    .required()
    .messages({
      'any.required': 'La contraseña es requerida',
    }),
});
