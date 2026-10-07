/**
 * User Types
 */

export interface User {
  id: string;
  email: string;
  username: string;
  /** ISO date when the user proved control of the inbox (verification link or password reset). Absent/null = unverified. */
  emailVerifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserRequest {
  email: string;
  password: string;
  username: string;
  /** Language of the verification email ('en' | 'es' | 'zh'). Defaults to 'en'. */
  locale?: string;
}
