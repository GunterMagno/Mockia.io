/**
 * User Types
 */

/** Interface languages the app supports. Same codes as the frontend i18n. */
export const SUPPORTED_LOCALES = ['en', 'es', 'zh'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export interface User {
  id: string;
  email: string;
  username: string;
  /** ISO date when the user proved control of the inbox (verification link or password reset). Absent/null = unverified. */
  emailVerifiedAt?: string | null;
  /** Interface language saved by the user. Absent = never saved (the client sends its current one once). */
  locale?: Locale;
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

/** Body of PATCH /users/me/preferences. */
export interface UpdatePreferencesRequest {
  locale: Locale;
}

/** Response of PATCH /users/me/preferences. */
export interface PreferencesResponse {
  locale: Locale;
}
