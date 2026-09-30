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

export const validatePassword = (password: string): MessageKey | null => {
  if (!password) return 'validation.passwordRequired';
  if (password.length < 8) return 'validation.passwordMin';
  return null;
};

export const validateUsername = (username: string): MessageKey | null => {
  if (!username) return 'validation.usernameRequired';
  if (username.length < 2) return 'validation.usernameMin';
  if (username.length > 80) return 'validation.usernameMax';
  return null;
};
