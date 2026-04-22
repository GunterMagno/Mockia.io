/**
 * Path Parameters Extraction Utility
 * Extracts path parameters from actual URLs based on route patterns
 */

/**
 * Extracts path parameters from an actual path based on a pattern
 * 
 * @param pattern - The route pattern (e.g., "/users/:id" or "/posts/:postId/comments/:commentId")
 * @param actualPath - The actual URL path (e.g., "/users/123")
 * @returns Object with extracted parameters or null if path doesn't match pattern
 * 
 * @example
 * extractPathParams("/users/:id", "/users/123")
 * // Returns: { id: "123" }
 * 
 * @example
 * extractPathParams("/posts/:postId/comments/:commentId", "/posts/1/comments/5")
 * // Returns: { postId: "1", commentId: "5" }
 * 
 * @example
 * extractPathParams("/users/:id", "/posts/123")
 * // Returns: null (doesn't match)
 */
export function extractPathParams(
  pattern: string,
  actualPath: string
): Record<string, string> | null {
  // Split both pattern and actual path by '/'
  const patternSegments = pattern.split('/').filter(Boolean);
  const actualSegments = actualPath.split('/').filter(Boolean);

  // If lengths don't match, they don't correspond
  if (patternSegments.length !== actualSegments.length) {
    return null;
  }

  const params: Record<string, string> = {};

  // Iterate through segments and extract parameters
  for (let i = 0; i < patternSegments.length; i++) {
    const patternSegment = patternSegments[i];
    const actualSegment = actualSegments[i];

    // If pattern segment starts with ':', it's a parameter
    if (patternSegment.startsWith(':')) {
      const paramName = patternSegment.slice(1);
      params[paramName] = actualSegment;
    } else {
      // If it's a literal, it must match exactly
      if (patternSegment !== actualSegment) {
        return null;
      }
    }
  }

  return params;
}

/**
 * Calculates the specificity score of a route pattern
 * More specific routes (with more literals) score higher
 * 
 * @param pattern - The route pattern (e.g., "/users/:id" or "/users/active")
 * @returns Specificity score (higher = more specific)
 * 
 * @example
 * calculatePatternSpecificity("/users/active") // Returns: 2 (all literals)
 * calculatePatternSpecificity("/users/:id") // Returns: 1 (one literal, one param)
 */
export function calculatePatternSpecificity(pattern: string): number {
  const segments = pattern.split('/').filter(Boolean);
  let score = 0;

  for (const segment of segments) {
    // Literal segments contribute more to specificity
    if (!segment.startsWith(':')) {
      score += 2; // Higher weight for literals
    } else {
      score += 0; // Parameters don't contribute to specificity
    }
  }

  return score;
}

/**
 * Checks if a pattern contains any parameters
 * 
 * @param pattern - The route pattern
 * @returns true if pattern contains parameters (e.g., :id)
 */
export function hasWildcards(pattern: string): boolean {
  return /:\w+/.test(pattern);
}
