import bcrypt from 'bcrypt';
import { UserModel } from '../models/User';
import { DuplicateUserError } from './errors';
import type { CreateUserRequest, User as UserDTO } from '@mockia/shared';

/**
 * Registra un nuevo usuario
 * 
 * Flujo:
 * 1. Verifica si el email ya existe en la BD
 * 2. Hashea la contraseña en texto claro
 * 3. Crea el documento en MongoDB
 * 4. Mapea el documento a DTO User de API
 * 
 * @param createUserRequest - DTO con email, password, username
 * @returns Usuario creado mapeado a DTO User
 * @throws DuplicateUserError si el email ya existe
 * @throws Error si hay problemas con la BD
 */
export async function registerUser(
  createUserRequest: CreateUserRequest
): Promise<UserDTO> {
  const { email, password, username } = createUserRequest;

  // 1. Verificar si el email ya existe
  const existingUser = await UserModel.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    throw new DuplicateUserError(`El email ${email} ya está registrado`);
  }

  // 2. Hashear la contraseña
  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // 3. Crear el documento en MongoDB
  const userDocument = new UserModel({
    email: email.toLowerCase(),
    username,
    passwordHash,
  });

  const savedUser = await userDocument.save();

  // 4. Mapear el documento a DTO User de API
  const userDTO: UserDTO = {
    id: savedUser._id.toString(),
    email: savedUser.email,
    username: savedUser.username,
    createdAt: savedUser.createdAt.toISOString(),
    updatedAt: savedUser.updatedAt.toISOString(),
  };

  return userDTO;
}

/**
 * Verifica una contraseña contra su hash
 * Útil para login
 * 
 * @param password - Contraseña en texto claro
 * @param passwordHash - Hash almacenado en BD
 * @returns true si la contraseña es correcta
 */
export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
