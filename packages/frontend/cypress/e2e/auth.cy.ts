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

  it('Keeps a working session without "Remember me" (token in sessionStorage)', () => {
    cy.visit('/login');
    cy.get('input[name="email"]').type(randomEmail);
    cy.get('input[name="password"]').type(password);
    cy.contains('label', 'Remember me').find('input[type="checkbox"]').uncheck();
    cy.intercept('GET', '/api/projects*').as('projects');
    cy.get('button[type="submit"]').click();

    cy.url().should('include', '/dashboard');
    // Antes el cliente HTTP solo leia localStorage: esta llamada salia sin token y daba 401
    cy.wait('@projects').its('response.statusCode').should('eq', 200);
    cy.window().then((win) => {
      expect(win.localStorage.getItem('mockia_token')).to.be.null;
      expect(win.sessionStorage.getItem('mockia_token')).to.be.a('string');
    });
    cy.reload();
    cy.contains('My projects').should('be.visible');
  });
});

// El access token dura 15 min y el refresh token se rota en cada uso. Pocos logins por spec: /auth/login y /auth/register
// comparten un limite de 20 por IP y ventana de 15 min en el backend de desarrollo.
describe('Session renewal (access token of 15 min + rotating refresh token)', () => {
  const email = `renewal${Date.now()}@example.com`;
  const password = 'Password123!';

  before(() => {
    cy.request('POST', '/api/auth/register', { email, password, username: 'RenewalUser' });
  });

  const loginViaUi = () => {
    cy.visit('/login');
    cy.get('input[name="email"]').type(email);
    cy.get('input[name="password"]').type(password);
    // Tokens in sessionStorage keep each test isolated
    cy.contains('label', 'Remember me').find('input[type="checkbox"]').uncheck();
    cy.get('button[type="submit"]').click();
    cy.url().should('include', '/dashboard');
    cy.contains('My projects').should('be.visible');
  };

  it('renews an expired access token once (even for simultaneous 401s) and rotates the refresh token', () => {
    loginViaUi();
    let firstRefresh = '';
    cy.window().then((win) => {
      firstRefresh = win.sessionStorage.getItem('mockia_refresh') as string;
      expect(firstRefresh).to.be.a('string');
      win.sessionStorage.setItem('mockia_token', 'expired.invalid.token');
    });
    cy.intercept('POST', '/api/auth/refresh').as('refresh');

    // Startup check (/auth/me) hits a 401, renews the session and retries
    cy.reload();
    cy.wait('@refresh').its('response.statusCode').should('eq', 200);
    cy.contains('My projects').should('be.visible');
    cy.get('@refresh.all').should('have.length', 1);
    cy.window().then((win) => {
      expect(win.sessionStorage.getItem('mockia_token')).to.not.equal('expired.invalid.token');
      expect(win.sessionStorage.getItem('mockia_refresh')).to.be.a('string').and.not.equal(firstRefresh);
    });

    // Three simultaneous requests with an expired token share a single refresh call and each succeeds on its retry
    cy.window().then(async (win) => {
      win.sessionStorage.setItem('mockia_token', 'expired.invalid.token');
      // Same module instance the app uses (the vite dev server serves it at this URL)
      const { api } = await new win.Function('return import("/src/services/api.ts")')();
      const responses = await Promise.all([api.get('/auth/me'), api.get('/auth/me'), api.get('/auth/me')]);
      expect(responses.map((r: { status: number }) => r.status)).to.deep.equal([200, 200, 200]);
    });
    cy.get('@refresh.all').should('have.length', 2);
  });

  it('sends the user to login when the refresh token is no longer valid', () => {
    cy.visit('/dashboard', {
      onBeforeLoad: (win) => {
        win.sessionStorage.setItem('mockia_token', 'expired.invalid.token');
        win.sessionStorage.setItem('mockia_refresh', 'revoked.invalid.token');
      },
    });
    cy.url().should('include', '/login');
    cy.window().then((win) => {
      expect(win.sessionStorage.getItem('mockia_token')).to.be.null;
      expect(win.sessionStorage.getItem('mockia_refresh')).to.be.null;
    });
  });

  it('logging out revokes the refresh token on the server', () => {
    loginViaUi();
    let refreshToken = '';
    cy.window().then((win) => {
      refreshToken = win.sessionStorage.getItem('mockia_refresh') as string;
    });
    cy.intercept('POST', '/api/auth/logout').as('logout');

    cy.get('button[aria-label="Profile"]').first().click();
    cy.contains('button', 'Log out').click();

    cy.wait('@logout').its('response.statusCode').should('eq', 204);
    // cy.then: the body must be built after refreshToken was read from the page
    cy.then(() =>
      cy
        .request({ method: 'POST', url: '/api/auth/refresh', body: { refreshToken }, failOnStatusCode: false })
        .its('status')
        .should('eq', 401)
    );
  });
});
