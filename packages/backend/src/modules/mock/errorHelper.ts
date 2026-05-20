/**
 * Utility to generate clean and realistic default JSON error responses for forced HTTP status codes.
 */
export function getDefaultErrorBody(statusCode: number): any {
  switch (statusCode) {
    case 400:
      return {
        error: 'Bad Request',
        message: 'The request could not be understood or was missing required parameters.',
        statusCode: 400,
      };
    case 401:
      return {
        error: 'Unauthorized',
        message: 'Authentication is required and has failed or has not yet been provided.',
        statusCode: 401,
      };
    case 403:
      return {
        error: 'Forbidden',
        message: 'You do not have permission to access this resource.',
        statusCode: 403,
      };
    case 404:
      return {
        error: 'Not Found',
        message: 'The requested resource could not be found.',
        statusCode: 404,
      };
    case 409:
      return {
        error: 'Conflict',
        message: 'The request could not be completed due to a conflict with the current state of the target resource.',
        statusCode: 409,
      };
    case 500:
      return {
        error: 'Internal Server Error',
        message: 'An unexpected error occurred on the server.',
        statusCode: 500,
      };
    case 503:
      return {
        error: 'Service Unavailable',
        message: 'The server is temporarily unable to handle the request.',
        statusCode: 503,
      };
    default:
      return {
        error: 'Error',
        message: `Mock API request failed with status code ${statusCode}`,
        statusCode,
      };
  }
}
