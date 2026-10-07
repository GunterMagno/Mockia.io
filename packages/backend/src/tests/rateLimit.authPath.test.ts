import { isStrictAuthPath } from '../middlewares/rateLimit.js';

// The strict limiter is off under jest (NODE_ENV=test), so the path matcher is tested directly.
// Express routes case-insensitively and ignores a trailing slash: every spelling that reaches the login/register/forgot/reset
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
    '/forgot',
    '/FORGOT',
    '/Forgot/',
    '//forgot',
    '/reset',
    '/RESET',
    '/Reset/',
    '/reset//',
  ])('%s is a strict-bucket endpoint (credentials or password reset)', (path) => {
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
    '/verify',
    '/VERIFY',
    '/verify/resend',
    '/forgot/extra',
    '/forgotten',
    '/resetx',
    '/reset-password',
  ])('%s is not a credential endpoint', (path) => {
    expect(isStrictAuthPath(path)).toBe(false);
  });
});
