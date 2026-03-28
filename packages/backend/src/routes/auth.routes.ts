import { Router } from 'express';
import { register, login, refresh } from '../controllers/auth.controller';
import { registerSchema, loginSchema, refreshSchema } from '../validation/auth.validation';
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

/**
 * POST /api/auth/login
 * Authenticates a user and returns JWT tokens
 *
 * Validations:
 * - email: required, valid email format
 * - password: required
 *
 * Responses:
 * - 200: Login successful, returns user + tokens
 * - 400: Invalid input data
 * - 401: Invalid credentials
 */
authRouter.post(
  '/login',
  validate({ body: loginSchema }),
  login
);

/**
 * POST /api/auth/refresh
 * Refreshes the access token using a valid refresh token
 *
 * Validations:
 * - refreshToken: required, must be a valid JWT
 *
 * Responses:
 * - 200: Token refresh successful, returns new tokens
 * - 400: Invalid input data
 * - 401: Invalid or expired refresh token
 */
authRouter.post(
  '/refresh',
  validate({ body: refreshSchema }),
  refresh
);

export default authRouter;
