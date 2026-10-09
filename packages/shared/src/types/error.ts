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
  /** 403: the feature needs a verified email address (AI generation, billing checkout; never the portal). */
  EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED',
  /** 409: the project cannot require an API key (visibility 'key') because none has been issued yet. */
  API_KEY_REQUIRED = 'API_KEY_REQUIRED',
  /** 429: the plan's monthly AI generation quota is spent (the body carries used, limit and resetsAt). */
  AI_QUOTA_EXCEEDED = 'AI_QUOTA_EXCEEDED',
  /** 503: the public demo is off, its global daily budget is spent or every generation slot is busy. */
  DEMO_UNAVAILABLE = 'DEMO_UNAVAILABLE',
  /** 429: this visitor (pseudonymized IP) spent their daily demo generations, or asks for too many challenges. */
  DEMO_LIMIT_REACHED = 'DEMO_LIMIT_REACHED',
  /** 400: the proof-of-work challenge is malformed, forged, expired, already spent or was not solved. */
  DEMO_CHALLENGE_INVALID = 'DEMO_CHALLENGE_INVALID',
  /** 429: a demo mock already served all the requests it is allowed to. */
  DEMO_MOCK_LIMIT = 'DEMO_MOCK_LIMIT',
  /** 429: this visitor spent their daily allowance of requests to demo mocks. */
  DEMO_IP_LIMIT = 'DEMO_IP_LIMIT',
  /** 429: too many requests to the demo in a short time (in-memory flood guard). */
  DEMO_RATE_LIMIT = 'DEMO_RATE_LIMIT',
}
