/**
 * Custom error for user conflicts (e.g: duplicate email)
 */
export class DuplicateUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateUserError';
  }
}
