/**
 * Frontend Validation Utilities
 * Matches the rules defined in the backend Joi schemas
 */

export const validateEmail = (email: string): string | null => {
  if (!email) return 'Email is required';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return 'Email must be valid';
  return null;
};

export const validatePassword = (password: string): string | null => {
  if (!password) return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';
  return null;
};

export const validateUsername = (username: string): string | null => {
  if (!username) return 'Username is required';
  if (username.length < 2) return 'Username must be at least 2 characters';
  if (username.length > 80) return 'Username cannot exceed 80 characters';
  return null;
};
