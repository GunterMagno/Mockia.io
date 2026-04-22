/**
 * Route Resolution Service Tests
 * Tests for path parameter extraction and route matching
 */

import {
  extractPathParams,
  calculatePatternSpecificity,
  hasWildcards,
} from '../modules/mock/pathParams.util';

describe('Path Parameters Utility', () => {
  describe('extractPathParams', () => {
    it('should extract single parameter from path', () => {
      const params = extractPathParams('/users/:id', '/users/123');
      expect(params).toEqual({ id: '123' });
    });

    it('should extract multiple parameters from path', () => {
      const params = extractPathParams(
        '/posts/:postId/comments/:commentId',
        '/posts/1/comments/5'
      );
      expect(params).toEqual({ postId: '1', commentId: '5' });
    });

    it('should extract parameters with different segment counts', () => {
      const params = extractPathParams(
        '/api/:version/users/:id/profile',
        '/api/v1/users/123/profile'
      );
      expect(params).toEqual({ version: 'v1', id: '123' });
    });

    it('should return null if path does not match pattern', () => {
      const params = extractPathParams('/users/:id', '/posts/123');
      expect(params).toBeNull();
    });

    it('should return null if segment count does not match', () => {
      const params = extractPathParams('/users/:id', '/users/123/extra');
      expect(params).toBeNull();
    });

    it('should return empty object for static paths with no parameters', () => {
      const params = extractPathParams('/users/active', '/users/active');
      expect(params).toEqual({});
    });

    it('should return null if static segment does not match exactly', () => {
      const params = extractPathParams('/users/active', '/users/inactive');
      expect(params).toBeNull();
    });

    it('should handle trailing slashes correctly', () => {
      // Trailing slashes should be filtered out, so both should work the same
      const params1 = extractPathParams('/users/:id/', '/users/123/');
      const params2 = extractPathParams('/users/:id', '/users/123');
      expect(params1).toEqual(params2);
    });

    it('should extract parameters with alphanumeric values', () => {
      const params = extractPathParams(
        '/users/:username',
        '/users/john_doe123'
      );
      expect(params).toEqual({ username: 'john_doe123' });
    });

    it('should handle edge case with root path', () => {
      const params = extractPathParams('/', '/');
      expect(params).toEqual({});
    });
  });

  describe('calculatePatternSpecificity', () => {
    it('should give higher score to static paths', () => {
      const staticScore = calculatePatternSpecificity('/users/active');
      const paramScore = calculatePatternSpecificity('/users/:id');
      expect(staticScore).toBeGreaterThan(paramScore);
    });

    it('should score fully static path highest', () => {
      const score = calculatePatternSpecificity('/users/active');
      expect(score).toBe(4); // 2 literals * 2
    });

    it('should score paths with parameters lower', () => {
      const score = calculatePatternSpecificity('/users/:id');
      expect(score).toBe(2); // 1 literal * 2 + 0 for parameter
    });

    it('should score fully parameterized path as 0', () => {
      const score = calculatePatternSpecificity('/:version/:resource/:id');
      expect(score).toBe(0);
    });

    it('should rank static routes with more literals as more specific', () => {
      const score1 = calculatePatternSpecificity('/api/users/active');
      const score2 = calculatePatternSpecificity('/api/users/:id');
      expect(score1).toBeGreaterThan(score2);
    });

    it('should handle single segment paths', () => {
      const staticScore = calculatePatternSpecificity('/users');
      const paramScore = calculatePatternSpecificity('/:resource');
      expect(staticScore).toBeGreaterThan(paramScore);
    });
  });

  describe('hasWildcards', () => {
    it('should return true for paths with parameters', () => {
      expect(hasWildcards('/users/:id')).toBe(true);
    });

    it('should return true for paths with multiple parameters', () => {
      expect(hasWildcards('/posts/:postId/comments/:commentId')).toBe(true);
    });

    it('should return false for static paths', () => {
      expect(hasWildcards('/users/active')).toBe(false);
    });

    it('should return false for root path', () => {
      expect(hasWildcards('/')).toBe(false);
    });

    it('should return true for paths starting with parameter', () => {
      expect(hasWildcards('/:version/users')).toBe(true);
    });

    it('should handle parameters in the middle of path', () => {
      expect(hasWildcards('/api/:version/docs')).toBe(true);
    });
  });

  describe('Route Resolution Priority (Integration)', () => {
    /**
     * This test demonstrates the expected behavior:
     * When both static and wildcard routes exist,
     * static routes should match first, then wildcard routes
     * sorted by specificity (more literals = higher priority)
     */
    it('should prioritize static routes over wildcard routes', () => {
      // Scenario: Both /users/active and /users/:id exist
      const staticPath = '/users/active';
      const wildcardPath = '/users/:id';
      const requestPath = '/users/active';

      // Static should match exactly
      const staticMatch = extractPathParams(staticPath, requestPath);
      expect(staticMatch).not.toBeNull();
      expect(staticMatch).toEqual({});

      // Wildcard should also match
      const wildcardMatch = extractPathParams(wildcardPath, requestPath);
      expect(wildcardMatch).not.toBeNull();
      expect(wildcardMatch).toEqual({ id: 'active' });

      // But static should have higher specificity
      const staticScore = calculatePatternSpecificity(staticPath);
      const wildcardScore = calculatePatternSpecificity(wildcardPath);
      expect(staticScore).toBeGreaterThan(wildcardScore);
    });

    it('should match wildcard when static does not exist', () => {
      // Scenario: Only /users/:id exists
      const wildcardPath = '/users/:id';
      const requestPath = '/users/123';

      // Should match wildcard
      const match = extractPathParams(wildcardPath, requestPath);
      expect(match).not.toBeNull();
      expect(match).toEqual({ id: '123' });
    });

    it('should handle complex nested routes with multiple parameters', () => {
      const pattern = '/api/:version/users/:userId/posts/:postId/comments/:commentId';
      const path = '/api/v1/users/42/posts/100/comments/999';

      const params = extractPathParams(pattern, path);
      expect(params).toEqual({
        version: 'v1',
        userId: '42',
        postId: '100',
        commentId: '999',
      });
    });
  });
});
