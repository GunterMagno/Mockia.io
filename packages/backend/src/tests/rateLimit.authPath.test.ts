import { isStrictAuthPath, skipsGlobalLimiter } from '../middlewares/rateLimit.js';

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

// The global limiter (1000 / 15 min per IP) is off under jest too: the predicate that decides which requests skip it
// is tested directly. Notification polling and health probes must not eat the bucket of real API calls.
describe('skipsGlobalLimiter', () => {
  it.each([
    ['GET', '/notifications'],
    ['GET', '/notifications/'],
    ['GET', '/Notifications'],
    ['GET', '/health'],
    ['HEAD', '/health'],
    ['GET', '/mock/my-proj/users'],
    ['POST', '/mock/my-proj/users'],
    ['POST', '/billing/webhook'],
  ])('%s %s skips the global limiter', (method, path) => {
    expect(skipsGlobalLimiter(method, path)).toBe(true);
  });

  it.each([
    ['POST', '/notifications/mark-read'],
    ['DELETE', '/notifications/abc'],
    ['POST', '/notifications'],
    ['GET', '/notifications/abc'],
    ['GET', '/projects'],
    ['POST', '/ai/generate-and-save'],
    ['GET', '/healthz'],
    ['GET', '/auth/me'],
  ])('%s %s counts toward the global limiter', (method, path) => {
    expect(skipsGlobalLimiter(method, path)).toBe(false);
  });
});
