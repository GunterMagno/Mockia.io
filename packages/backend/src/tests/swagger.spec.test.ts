import { buildSwaggerSpec } from '../config/swagger.js';

/**
 * swagger-jsdoc does not throw on a malformed @swagger block: it prints "Not all input has been taken into account"
 * at boot and silently drops the route from /api/docs. Every annotation must parse.
 */
describe('OpenAPI document of the API (/api/docs)', () => {
  it('builds without YAML errors and includes the /users routes', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const spec = buildSwaggerSpec() as { paths?: Record<string, unknown> };
      const reports = [...info.mock.calls, ...error.mock.calls].map((args) => args.join(' '));
      expect(reports.filter((line) => /Not all input|YAML|Here's the report/i.test(line))).toEqual([]);
      expect(Object.keys(spec.paths ?? {})).toEqual(
        expect.arrayContaining(['/users/me/ai-consent', '/users/change-password', '/users/me/export', '/auth/login'])
      );
    } finally {
      info.mockRestore();
      error.mockRestore();
    }
  });
});
