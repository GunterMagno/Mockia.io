// La UI elige idioma segun el navegador: estos tests fijan ingles (tambien en los hooks before)
Cypress.on('window:before:load', (win) => win.localStorage.setItem('mockia_locale', 'en'));

/**
 * Recuperar contrasena y verificar el correo, de punta a punta.
 *
 * No hay SMTP en el entorno de pruebas: el backend debe arrancarse con E2E_EXPOSE_MAIL_OUTBOX=true, lo que guarda los
 * correos en memoria y los sirve en GET /api/__test__/outbox (nunca montado en produccion, assertProdConfig lo
 * rechaza). La spec lee de ahi el enlace de cada correo y lo abre como lo haria el usuario.
 */

interface MailEntry {
  to: string;
  template: 'verify' | 'reset';
  link: string;
}

const PASSWORD = 'Original-pass-123';
const NEW_PASSWORD = 'Brand-new-pass-456';
let counter = 0;
const uniqueEmail = (prefix: string) => `${prefix}${Date.now()}${counter++}@example.com`;

/** Correos enviados a `to` con la plantilla dada, del mas antiguo al mas reciente. */
const mailsFor = (to: string, template: MailEntry['template']) =>
  cy.request('/api/__test__/outbox').then((res) => {
    const all = res.body.data as MailEntry[];
    return all.filter((m) => m.to === to && m.template === template);
  });

/** Abre el enlace de un correo (ruta + query: el host del enlace es APP_URL, el navegador usa baseUrl). */
const visitLink = (link: string) => {
  const url = new URL(link);
  cy.visit(url.pathname + url.search);
};

const registerViaApi = (email: string, username: string) =>
  cy.request('POST', '/api/auth/register', { email, password: PASSWORD, username, locale: 'en' });

describe('Password reset', () => {
  before(() => {
    // Falla pronto y con un mensaje claro si el backend no expone el buzon de pruebas
    cy.request({ url: '/api/__test__/outbox', failOnStatusCode: false }).its('status').should('eq', 200);
  });

  beforeEach(() => {
    cy.clearCookies();
    cy.clearLocalStorage();
  });

  it('login page links to the forgot-password page', () => {
    cy.visit('/login');
    cy.contains('a', 'Forgot your password?').click();
    cy.location('pathname').should('eq', '/forgot-password');
    cy.get('h1').should('contain', 'Reset your password');
  });

  it('an unknown email gets the same confirmation and no email is sent', () => {
    const ghost = uniqueEmail('ghost');
    cy.visit('/forgot-password');
    cy.get('input[name="email"]').type(ghost);
    cy.get('button[type="submit"]').click();

    cy.get('[role="status"]').should('contain', 'If an account exists for that email');
    // Same text a real account would get: nothing reveals whether the email is registered
    cy.focused().should('have.attr', 'role', 'status');
    mailsFor(ghost, 'reset').should('have.length', 0);
  });

  it('request a link, choose a new password with it, log in, and the link cannot be reused', () => {
    const email = uniqueEmail('reset');
    registerViaApi(email, 'resetuser');

    cy.visit('/forgot-password');
    cy.get('input[name="email"]').type(email);
    cy.get('button[type="submit"]').click();
    cy.get('[role="status"]').should('contain', 'If an account exists for that email');

    mailsFor(email, 'reset').then((mails) => {
      expect(mails).to.have.length(1);
      const link = mails[0].link;

      // The page takes the token out of the address bar as soon as it has read it
      visitLink(link);
      cy.location('pathname').should('eq', '/reset-password');
      cy.location('search').should('eq', '');

      // Client-side checks come first and do not burn the token
      cy.get('input[name="new-password"]').type('short');
      cy.get('input[name="confirm-password"]').type('short');
      cy.get('button[type="submit"]').click();
      cy.get('[role="alert"]').should('contain', 'at least 10 characters');

      cy.get('input[name="new-password"]').clear().type(NEW_PASSWORD);
      cy.get('input[name="confirm-password"]').clear().type(`${NEW_PASSWORD}x`);
      cy.get('button[type="submit"]').click();
      cy.get('[role="alert"]').should('contain', 'do not match');

      cy.get('input[name="confirm-password"]').clear().type(NEW_PASSWORD);
      cy.get('button[type="submit"]').click();
      cy.get('[role="status"]').should('contain', 'Your password has been changed');
      cy.focused().should('have.attr', 'role', 'status');

      // The old password is dead, the new one logs in
      cy.request({ method: 'POST', url: '/api/auth/login', body: { email, password: PASSWORD }, failOnStatusCode: false })
        .its('status')
        .should('eq', 401);
      cy.clearCookies();
      cy.contains('a', 'Sign in').click();
      cy.location('pathname').should('eq', '/login');
      cy.get('input[name="email"]').type(email);
      cy.get('input[name="password"]').type(NEW_PASSWORD);
      cy.get('button[type="submit"]').click();
      cy.url().should('include', '/dashboard');

      // The same link a second time: the server refuses it and the page says so
      cy.clearCookies();
      visitLink(link);
      cy.get('input[name="new-password"]').type('Another-pass-789');
      cy.get('input[name="confirm-password"]').type('Another-pass-789');
      cy.get('button[type="submit"]').click();
      cy.get('[role="alert"]').should('contain', 'invalid, has expired or was already used');
    });
  });

  it('a reset link without a token explains the problem and offers a new request', () => {
    cy.visit('/reset-password');
    cy.get('[role="alert"]').should('contain', 'incomplete');
    cy.contains('a', 'Request a new link').click();
    cy.location('pathname').should('eq', '/forgot-password');
  });
});

describe('Email verification', () => {
  before(() => {
    cy.request({ url: '/api/__test__/outbox', failOnStatusCode: false }).its('status').should('eq', 200);
  });

  beforeEach(() => {
    cy.clearCookies();
    cy.clearLocalStorage();
  });

  const signUp = (email: string) => {
    cy.visit('/signup');
    cy.get('input[name="username"]').type('Verifier');
    cy.get('input[name="email"]').type(email);
    cy.get('input[name="new-password"]').type(PASSWORD);
    cy.get('button[type="submit"]').click();
    cy.url().should('include', '/dashboard');
  };

  it('sign-up sends a link; the dashboard notice offers a resend; the link verifies the account and hides the notice', () => {
    const email = uniqueEmail('verify');
    signUp(email);

    cy.contains('Verify your email address to unlock AI generation and billing').should('be.visible');
    mailsFor(email, 'verify').should('have.length', 1);

    cy.contains('button', 'Resend email').click();
    cy.get('[role="status"]').should('contain', 'Verification email sent');
    mailsFor(email, 'verify').should('have.length', 2);

    mailsFor(email, 'verify').then((mails) => {
      visitLink(mails[mails.length - 1].link);
    });
    cy.location('pathname').should('eq', '/verify-email');
    cy.location('search').should('eq', '');
    cy.get('[role="status"]').should('contain', 'Your email address is verified');

    cy.contains('a', 'Continue to your projects').click();
    cy.url().should('include', '/dashboard');
    cy.contains('My projects').should('be.visible');
    cy.contains('Verify your email address to unlock').should('not.exist');
  });

  it('the first link still works after a resend, once; the second use fails', () => {
    const email = uniqueEmail('twice');
    registerViaApi(email, 'twiceuser');

    mailsFor(email, 'verify').then((mails) => {
      expect(mails).to.have.length(1);
      visitLink(mails[0].link);
      cy.get('[role="status"]').should('contain', 'Your email address is verified');
      visitLink(mails[0].link);
      cy.get('[role="alert"]').should('contain', 'invalid, has expired or was already used');
    });
  });

  it('the notice can be dismissed and stays dismissed after a reload', () => {
    signUp(uniqueEmail('dismiss'));
    cy.contains('Verify your email address to unlock').should('be.visible');
    cy.contains('button', 'Dismiss').click();
    cy.contains('Verify your email address to unlock').should('not.exist');
    cy.reload();
    cy.contains('My projects').should('be.visible');
    cy.contains('Verify your email address to unlock').should('not.exist');
  });

  it('a verification link without a token says so', () => {
    cy.visit('/verify-email');
    cy.get('[role="alert"]').should('contain', 'incomplete');
  });
});
