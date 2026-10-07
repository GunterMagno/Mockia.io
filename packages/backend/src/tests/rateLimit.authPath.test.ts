import { isStrictAuthPath } from '../middlewares/rateLimit.js';

// The strict limiter is off under jest (NODE_ENV=test), so the path matcher is tested directly.
// Express routes case-insensitively and ignores a trailing slash: every spelling that reaches the login/register
// handler must land in the strict bucket.
describe('isStrictAuthPath', () => {
  it.each([
    'login',
    '/login',
    '/LOGIN',
    '/Login',
    '/Login/',
    '/login/',
    '//login',
    '/login//',
    '/register',
    '/REGISTER',
    '/Register/',
  ])('%s is a credential endpoint (strict bucket)', (path) => {
    expect(isStrictAuthPath(path)).toBe(true);
  });

  it.each([
    '/refresh',
    '/REFRESH',
    '/logout',
    '/logout-all',
    '/sessions',
    '/me',
    '/',
    '',
    '/login/extra',
    '/loginx',
    '/xlogin',
    '/login-all',
  ])('%s is not a credential endpoint', (path) => {
    expect(isStrictAuthPath(path)).toBe(false);
  });
});
