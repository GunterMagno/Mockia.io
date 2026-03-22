import { Router } from 'express';
import { register } from './auth.controller';
import { registerSchema } from './auth.validation';
import { validate } from '../middlewares/validateRequest';

/**
 * Authentication router
 * Defines auth routes and middleware stack
 *
 * Middleware stack for each route:
 * 1. validate({ body: registerSchema }) - Validates that body is a valid CreateUserRequest
 * 2. register - Controller that registers the user
 */

export const authRouter = Router();

/**
 * POST /api/auth/register
 * Registers a new user
 *
 * Validations:
 * - email: required, valid email format
 * - password: required, minimum 8 characters
 * - username: required, 2-80 characters
 *
 * Responses:
 * - 201: User registered successfully
 * - 400: Invalid input data
 * - 409: Email already registered
 */
authRouter.post(
  '/register',
  validate({ body: registerSchema }),
  register
);

export default authRouter;
