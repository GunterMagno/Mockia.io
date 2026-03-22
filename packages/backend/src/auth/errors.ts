/**
 * Error personalizado para conflictos de usuario (ej: email duplicado)
 */
export class DuplicateUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateUserError';
  }
}
