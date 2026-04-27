/**
 * Route Resolution Types
 * Shared types for route resolution and matching
 */

/**
 * Path parameters extracted from a URL based on route pattern
 * @example { id: "123", slug: "my-item" }
 */
export type PathParams = Record<string, string>;

/**
 * Route match result containing the matched endpoint and extracted parameters
 */
export interface RouteMatch {
  /** The matched endpoint path pattern */
  pathPattern: string;
  /** Extracted path parameters */
  pathParams: PathParams;
  /** HTTP method of the endpoint */
  method: string;
}

/**
 * Route pattern with specificity information
 * Used for prioritizing which routes to match first
 */
export interface RoutePattern {
  /** The route pattern (e.g., "/users/:id") */
  pattern: string;
  /** Specificity score (higher = more specific) */
  specificity: number;
  /** Whether pattern contains wildcards */
  hasWildcards: boolean;
}

/**
 * Route resolution request
 */
export interface RouteResolutionRequest {
  /** Project slug */
  projectSlug: string;
  /** HTTP method (GET, POST, PUT, DELETE, PATCH) */
  method: string;
  /** Request path */
  path: string;
}

/**
 * Route resolution response
 */
export interface RouteResolutionResponse {
  /** Whether a matching route was found */
  found: boolean;
  /** The matched route, if found */
  route?: RouteMatch;
  /** Error message if route not found */
  error?: string;
}
