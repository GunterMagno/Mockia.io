// La UI elige idioma segun el navegador: estos tests fijan ingles (tambien en los hooks before)
Cypress.on('window:before:load', (win) => win.localStorage.setItem('mockia_locale', 'en'));

describe('Authentication Flow', () => {
  const randomEmail = `testuser${Date.now()}@example.com`;
  const password = 'Password123!';

  it('Should successfully register a new user', () => {
    cy.visit('/signup');

    // Fill the signup form
    cy.get('input[name="username"]').type('TestUser');
    cy.get('input[name="email"]').type(randomEmail);
    cy.get('input[name="new-password"]').type(password);

    // Submit
    cy.get('button[type="submit"]').click();

    // Should be auto-logged in and redirected to dashboard
    cy.url().should('include', '/dashboard');
  });

  it('Should successfully login and redirect to dashboard', () => {
    cy.visit('/login');

    // Fill the login form
    cy.get('input[name="email"]').type(randomEmail);
    cy.get('input[name="password"]').type(password);

    // Submit
    cy.get('button[type="submit"]').click();

    // Should be redirected to dashboard
    cy.url().should('include', '/dashboard');
    cy.contains('My projects').should('be.visible');
  });

  it('Keeps a working session without "Remember me" (session cookie, API calls carry the in-memory token)', () => {
    cy.visit('/login');
    cy.get('input[name="email"]').type(randomEmail);
    cy.get('input[name="password"]').type(password);
    cy.contains('label', 'Remember me').find('input[type="checkbox"]').uncheck();
    cy.intercept('GET', '/api/projects*').as('projects');
    cy.get('button[type="submit"]').click();

    cy.url().should('include', '/dashboard');
    cy.wait('@projects').its('response.statusCode').should('eq', 200);
    // Without "Remember me" the cookie has no expiry: it ends with the browser session
    cy.getCookie('mockia_rt').then((cookie) => {
      expect(cookie, 'refresh cookie').not.to.be.null;
      expect((cookie as Cypress.Cookie).expiry, 'expiry of a session cookie').to.be.undefined;
    });
    cy.reload();
    cy.contains('My projects').should('be.visible');
  });

  it('"Remember me" makes the refresh cookie last 7 days', () => {
    cy.visit('/login');
    cy.get('input[name="email"]').type(randomEmail);
    cy.get('input[name="password"]').type(password);
    cy.contains('label', 'Remember me').find('input[type="checkbox"]').check();
    cy.get('button[type="submit"]').click();
    cy.url().should('include', '/dashboard');

    cy.getCookie('mockia_rt').then((cookie) => {
      const days = ((cookie as Cypress.Cookie).expiry! * 1000 - Date.now()) / 86_400_000;
      expect(days).to.be.within(6.9, 7.01);
    });
  });
});

// El refresh token vive en la cookie HttpOnly mockia_rt y el access token solo en memoria. Pocos logins por spec:
// /auth/login y /auth/register comparten un limite de 20 por IP y ventana de 15 min en el backend de desarrollo.
describe('Cookie-based session (HttpOnly refresh cookie + in-memory access token)', () => {
  const email = `cookie${Date.now()}@example.com`;
  const password = 'Password123!';

  before(() => {
    cy.request('POST', '/api/auth/register', { email, password, username: 'CookieUser' });
  });

  const loginViaUi = () => {
    cy.visit('/login');
    cy.get('input[name="email"]').type(email);
    cy.get('input[name="password"]').type(password);
    cy.get('button[type="submit"]').click();
    cy.url().should('include', '/dashboard');
    cy.contains('My projects').should('be.visible');
  };

  it('keeps no token in localStorage or sessionStorage, and the cookie is invisible to scripts', () => {
    loginViaUi();

    // (a) nothing token-like in web storage
    cy.window().then((win) => {
      for (const storage of [win.localStorage, win.sessionStorage]) {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i) as string;
          expect(key.toLowerCase(), `storage key ${key}`).not.to.match(/token|refresh|session|user/);
          expect(storage.getItem(key) as string, `storage value of ${key}`).not.to.match(/eyJ[\w-]+\.[\w-]+\./);
        }
      }
      // (c) the refresh cookie exists for the browser but document.cookie cannot see it
      expect(win.document.cookie).not.to.contain('mockia_rt');
    });
    cy.getCookie('mockia_rt').should('exist').and('include', { httpOnly: true, path: '/api/auth' });
  });

  it('keeps the session after a reload (restored from the cookie)', () => {
    loginViaUi();
    cy.intercept('POST', '/api/auth/refresh').as('restore');
    cy.reload();
    // (b) the app restores the session at load: one refresh call, then the protected page renders
    cy.wait('@restore').its('response.statusCode').should('eq', 200);
    cy.url().should('include', '/dashboard');
    cy.contains('My projects').should('be.visible');
  });

  it('removes tokens left in web storage by older versions', () => {
    cy.visit('/', {
      onBeforeLoad: (win) => {
        win.localStorage.setItem('mockia_token', 'legacy.access.token');
        win.localStorage.setItem('mockia_user', '{"id":"x"}');
        win.sessionStorage.setItem('mockia_token', 'legacy.access.token');
        win.sessionStorage.setItem('mockia_refresh', 'legacy.refresh.token');
      },
    });
    cy.contains('h1', 'Stop waiting').should('be.visible');
    cy.window().then((win) => {
      for (const key of ['mockia_token', 'mockia_refresh', 'mockia_user']) {
        expect(win.localStorage.getItem(key), `localStorage ${key}`).to.be.null;
        expect(win.sessionStorage.getItem(key), `sessionStorage ${key}`).to.be.null;
      }
    });
  });

  it('logging out clears the session: the cookie is gone, a reload lands on /login and the token is revoked', () => {
    loginViaUi();
    let oldCookie = '';
    cy.getCookie('mockia_rt').then((c) => {
      oldCookie = (c as Cypress.Cookie).value;
    });
    cy.intercept('POST', '/api/auth/logout').as('logout');

    cy.get('button[aria-label="Profile"]').first().click();
    cy.contains('button', 'Log out').click();
    // (d) the server answers 204 and the browser drops the cookie
    cy.wait('@logout').its('response.statusCode').should('eq', 204);
    cy.getCookie('mockia_rt').should('not.exist');

    cy.visit('/dashboard');
    cy.location('pathname').should('eq', '/login');
    cy.reload();
    cy.location('pathname').should('eq', '/login');

    // The cookie value copied before logging out is dead on the server too (revoked, not just forgotten)
    cy.then(() => cy.setCookie('mockia_rt', oldCookie, { path: '/api/auth', httpOnly: true }));
    cy.request({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { 'X-Requested-With': 'mockia' },
      failOnStatusCode: false,
    })
      .its('status')
      .should('eq', 401);
  });

  it('refresh and logout reject requests without the CSRF header', () => {
    cy.request({ method: 'POST', url: '/api/auth/refresh', failOnStatusCode: false }).its('status').should('eq', 403);
    cy.request({ method: 'POST', url: '/api/auth/logout', failOnStatusCode: false }).its('status').should('eq', 403);
  });
});

// El access token dura 15 min y el refresh token se rota en cada uso (cookie nueva en cada /auth/refresh).
describe('Session renewal (access token of 15 min + rotating refresh cookie)', () => {
  const email = `renewal${Date.now()}@example.com`;
  const password = 'Password123!';

  before(() => {
    cy.request('POST', '/api/auth/register', { email, password, username: 'RenewalUser' });
  });

  const loginViaUi = () => {
    cy.visit('/login');
    cy.get('input[name="email"]').type(email);
    cy.get('input[name="password"]').type(password);
    cy.get('button[type="submit"]').click();
    cy.url().should('include', '/dashboard');
    cy.contains('My projects').should('be.visible');
  };

  /** Replaces the in-memory access token with an expired one (same module instance the app uses: vite dev server). */
  const expireAccessToken = () =>
    cy.window().then(async (win) => {
      const { setAccessToken } = await new win.Function('return import("/src/services/session.ts")')();
      setAccessToken('expired.invalid.token');
    });

  it('renews an expired access token once (even for simultaneous 401s) and rotates the refresh cookie', () => {
    loginViaUi();
    let firstCookie = '';
    cy.getCookie('mockia_rt').then((c) => {
      firstCookie = (c as Cypress.Cookie).value;
    });
    cy.intercept('POST', '/api/auth/refresh').as('refresh');
    cy.intercept('GET', '/api/auth/me').as('me');

    // Three simultaneous requests with an expired token share a single refresh call and each succeeds on its retry
    expireAccessToken();
    cy.window().then(async (win) => {
      const { api } = await new win.Function('return import("/src/services/api.ts")')();
      const responses = await Promise.all([api.get('/auth/me'), api.get('/auth/me'), api.get('/auth/me')]);
      expect(responses.map((r: { status: number }) => r.status)).to.deep.equal([200, 200, 200]);
    });
    cy.get('@refresh.all').should('have.length', 1);
    cy.get('@refresh.all').its('0.response.statusCode').should('eq', 200);
    cy.getCookie('mockia_rt').then((c) => {
      expect((c as Cypress.Cookie).value).to.be.a('string').and.not.equal(firstCookie);
    });

    // The page keeps working afterwards
    cy.reload();
    cy.contains('My projects').should('be.visible');
  });

  it('sends the user to login when the refresh cookie is no longer valid, and clears it', () => {
    cy.setCookie('mockia_rt', 'revoked.invalid.token', { path: '/api/auth', httpOnly: true });
    cy.visit('/dashboard');
    cy.url().should('include', '/login');
    cy.getCookie('mockia_rt').should('not.exist');
  });

  it('stays logged in after changing the password (fresh session; older sessions are revoked server-side)', () => {
    const changer = `changepw${Date.now()}@example.com`;
    const newPassword = 'Changed-Password-456';
    cy.request('POST', '/api/auth/register', { email: changer, password, username: 'ChangePwUser' });
    cy.clearCookies();
    cy.visit('/login');
    cy.get('input[name="email"]').type(changer);
    cy.get('input[name="password"]').type(password);
    cy.get('button[type="submit"]').click();
    cy.url().should('include', '/dashboard');

    cy.intercept('POST', '/api/users/change-password').as('change');
    cy.get('button[aria-label="Profile"]').first().click();
    cy.get('[role="dialog"]').within(() => {
      cy.get('input[placeholder="Current password"]').type(password);
      cy.get('input[placeholder="New password"]').type(newPassword);
      cy.contains('button', /^Save$/).click();
    });
    cy.wait('@change').its('response.statusCode').should('eq', 200);
    cy.contains('Profile updated successfully!').should('be.visible');

    // A reload restores the session from the NEW refresh cookie (the old one was revoked with the others)
    cy.reload();
    cy.location('pathname').should('include', '/dashboard');
    cy.contains('My projects').should('be.visible');
    // ... and the in-memory access token handed back by the change keeps working for API calls
    cy.window().then(async (win) => {
      const { api } = await new win.Function('return import("/src/services/api.ts")')();
      const me = await api.get('/auth/me');
      expect(me.status).to.eq(200);
    });
  });

  it('sends the user to login when a refresh answers with a different account (planted cookie)', () => {
    loginViaUi();
    // The refresh cookie now belongs to someone else (e.g. planted by a cross-site login form): the app must not
    // silently switch accounts
    cy.intercept('POST', '/api/auth/refresh', {
      statusCode: 200,
      body: {
        success: true,
        data: {
          accessToken: 'attacker.access.token',
          user: { id: '000000000000000000000bad', email: 'attacker@example.com', username: 'attacker' },
        },
      },
    }).as('foreignRefresh');
    cy.intercept('POST', '/api/auth/logout').as('logout');
    expireAccessToken();
    cy.window().then(async (win) => {
      const { api } = await new win.Function('return import("/src/services/api.ts")')();
      await api.get('/auth/me').catch(() => undefined);
    });
    cy.wait('@foreignRefresh');
    cy.location('pathname').should('eq', '/login');
    // The foreign cookie is dropped server-side too
    cy.wait('@logout');
  });

  it('sends the user to login when the session is revoked while the page is open', () => {
    loginViaUi();
    // Revoke every session from another client (the Bearer token comes from a separate login)
    cy.request('POST', '/api/auth/login', { email, password }).then((res) => {
      cy.request({
        method: 'POST',
        url: '/api/auth/logout-all',
        headers: { Authorization: `Bearer ${res.body.data.tokens.accessToken}` },
      });
    });
    // The page still holds an access token: expire it so its next call must go through the (now revoked) refresh
    expireAccessToken();
    cy.window().then(async (win) => {
      const { api } = await new win.Function('return import("/src/services/api.ts")')();
      await api.get('/auth/me').catch(() => undefined);
    });
    cy.location('pathname').should('eq', '/login');
  });
});
