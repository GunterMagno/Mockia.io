import type { MessageKey } from '../i18n/I18nProvider'

/**
 * Frontend Validation Utilities
 * Matches the rules defined in the backend Joi schemas.
 * Devuelven la clave i18n del error (o null); el componente la traduce con t().
 */

export const validateEmail = (email: string): MessageKey | null => {
  if (!email) return 'validation.emailRequired';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return 'validation.emailInvalid';
  return null;
};

/** Login: only "not empty". The length policy applies to NEW passwords; older accounts may have shorter ones. */
export const validatePassword = (password: string): MessageKey | null => {
  if (!password) return 'validation.passwordRequired';
  return null;
};

/** Password policy of the backend for new passwords (register, reset, change): 10 to 128 characters. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const validateNewPassword = (password: string): MessageKey | null => {
  if (!password) return 'validation.passwordRequired';
  if (password.length < PASSWORD_MIN_LENGTH) return 'validation.passwordMin';
  if (password.length > PASSWORD_MAX_LENGTH) return 'validation.passwordMax';
  return null;
};

export const validateUsername = (username: string): MessageKey | null => {
  if (!username) return 'validation.usernameRequired';
  if (username.length < 2) return 'validation.usernameMin';
  if (username.length > 80) return 'validation.usernameMax';
  return null;
};
