import { Router } from 'express';
import { register } from './auth.controller';
import { registerSchema } from './auth.validation';
import { validate } from '../middlewares/validateRequest';

/**
 * Router de autenticación
 * Define las rutas de auth y el orden de middlewares
 *
 * Stack de middlewares para cada ruta:
 * 1. validate({ body: registerSchema }) - Valida que el body sea un CreateUserRequest válido
 * 2. register - Controlador que registra el usuario
 */

export const authRouter = Router();

/**
 * POST /api/auth/register
 * Registra un nuevo usuario
 *
 * Validaciones:
 * - email: requerido, formato email válido
 * - password: requerida, mínimo 8 caracteres
 * - username: requerido, 2-80 caracteres
 *
 * Respuestas:
 * - 201: Usuario registrado exitosamente
 * - 400: Datos de entrada inválidos
 * - 409: Email ya registrado
 */
authRouter.post(
  '/register',
  validate({ body: registerSchema }),
  register
);

export default authRouter;
