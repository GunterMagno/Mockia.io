import { Request, Response, NextFunction } from 'express';
import { registerUser } from './auth.service';
import type { CreateUserRequest } from '@mockia/shared';
import { asyncHandler } from '../middlewares/errorHandler';

/**
 * Controlador para el registro de usuario
 * Conecta el mundo HTTP (Express) con la lógica de negocio
 */

/**
 * POST /api/auth/register
 * Registra un nuevo usuario
 *
 * Body esperado:
 * {
 *   "email": "user@example.com",
 *   "password": "password123",
 *   "username": "testuser"
 * }
 *
 * @returns 201 con el usuario creado (sin contraseña)
 * @throws 400 si la validación falla
 * @throws 409 si el email ya existe
 */
export const register = asyncHandler(
  async (req: Request<{}, {}, CreateUserRequest>, res: Response, next: NextFunction) => {
    const createUserRequest: CreateUserRequest = req.body;

    // Llamar al servicio para registrar el usuario
    const userDTO = await registerUser(createUserRequest);

    // Responder con 201 (Created) y el usuario creado
    res.status(201).json({
      success: true,
      data: userDTO,
      timestamp: new Date().toISOString(),
    });
  }
);
