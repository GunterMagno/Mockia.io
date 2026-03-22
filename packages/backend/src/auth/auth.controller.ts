import { Request, Response, NextFunction } from 'express';
import { registerUser } from './auth.service';
import type { CreateUserRequest } from '@mockia/shared';
import { asyncHandler } from '../middlewares/errorHandler';

/**
 * Controller for user registration
 * Connects the HTTP world (Express) with business logic
 */

/**
 * POST /api/auth/register
 * Registers a new user
 *
 * Expected body:
 * {
 *   "email": "user@example.com",
 *   "password": "password123",
 *   "username": "testuser"
 * }
 *
 * @returns 201 with the created user (without password)
 * @throws 400 if validation fails
 * @throws 409 if email already exists
 */
export const register = asyncHandler(
  async (req: Request<{}, {}, CreateUserRequest>, res: Response, next: NextFunction) => {
    const createUserRequest: CreateUserRequest = req.body;

    // Call the service to register the user
    const userDTO = await registerUser(createUserRequest);

    // Respond with 201 (Created) and the created user
    res.status(201).json({
      success: true,
      data: userDTO,
      timestamp: new Date().toISOString(),
    });
  }
);
