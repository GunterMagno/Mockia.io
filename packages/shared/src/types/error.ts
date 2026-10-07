/**
 * Error Types and Codes
 */

export enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  CONFLICT = 'CONFLICT',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  /** 403: the feature needs a verified email address (AI generation, billing checkout / portal). */
  EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED',
  /** 409: the project cannot require an API key (visibility 'key') because none has been issued yet. */
  API_KEY_REQUIRED = 'API_KEY_REQUIRED',
}
