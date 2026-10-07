// La UI elige idioma segun el navegador: estos tests fijan ingles
Cypress.on('window:before:load', (win) => win.localStorage.setItem('mockia_locale', 'en'));

/**
 * Derechos RGPD desde el modal de perfil: descargar los datos (JSON sin hash) y eliminar la cuenta.
 */
const PASSWORD = 'Gdpr-pass-12345';
let counter = 0;
const uniqueEmail = (prefix: string) => `${prefix}${Date.now()}${counter++}@example.com`;

const registerViaApi = (email: string, username: string) =>
  cy.request('POST', '/api/auth/register', { email, password: PASSWORD, username, locale: 'en' });

const loginViaUi = (email: string, password = PASSWORD) => {
  cy.visit('/login');
  cy.get('input[name="email"]').type(email);
  cy.get('input[name="password"]').type(password);
  cy.get('button[type="submit"]').click();
};

const openProfile = () => {
  cy.get('button[aria-label="Profile"]').first().click();
  cy.get('[role="dialog"]').should('be.visible');
};

describe('GDPR: export and delete the account', () => {
  beforeEach(() => {
    cy.clearCookies();
    cy.clearLocalStorage();
  });

  it('downloads a JSON file with the user data and never the password hash', () => {
    const email = uniqueEmail('export');
    registerViaApi(email, 'exportuser');
    loginViaUi(email);
    cy.url().should('include', '/dashboard');

    cy.intercept('GET', '/api/users/me/export').as('export');
    openProfile();
    cy.contains('[role="dialog"] h3', 'Your data').should('be.visible');
    cy.contains('button', 'Download my data').click();

    cy.wait('@export').then(({ response }) => {
      expect(response?.statusCode).to.eq(200);
      const disposition = String(response?.headers['content-disposition']);
      expect(disposition).to.match(/^attachment; filename="mockia-export-\d{4}-\d{2}-\d{2}\.json"$/);
      const text = typeof response?.body === 'string' ? response.body : JSON.stringify(response?.body);
      expect(text).not.to.contain('passwordHash');
      const data = JSON.parse(text);
      expect(data.account.email).to.eq(email);
      expect(data.schemaVersion).to.eq(1);

      // El archivo llega realmente a la carpeta de descargas y es el mismo JSON valido
      const filename = /filename="([^"]+)"/.exec(disposition)![1];
      cy.readFile(`cypress/downloads/${filename}`, { timeout: 15000 }).then((file) => {
        const saved = typeof file === 'string' ? JSON.parse(file) : file;
        expect(saved.account.email).to.eq(email);
        expect(JSON.stringify(saved)).not.to.contain('passwordHash');
      });
    });
    cy.get('[role="dialog"] [role="status"]').should('contain.text', 'downloaded');
  });

  it('the delete confirmation needs the exact email; a wrong password changes nothing; the right one deletes everything', () => {
    const email = uniqueEmail('delete');
    registerViaApi(email, 'deleteuser');
    loginViaUi(email);
    cy.url().should('include', '/dashboard');

    openProfile();
    cy.contains('button', 'Delete account').click();

    // Warning about subscriptions and permanence, labelled fields, focus moves to the first one
    cy.contains('[role="dialog"] form', 'cancelled immediately').should('be.visible');
    cy.get('input[name="confirm-email"]').should('be.focused');
    cy.contains('label', 'Type your email').should('be.visible');
    const confirmButton = () => cy.contains('button', 'Delete my account permanently');

    // Wrong email blocks the button even with a password
    cy.get('input[name="confirm-email"]').type('someone-else@example.com');
    cy.get('input[name="delete-password"]').type('Wrong-password-1');
    confirmButton().should('be.disabled');

    // Right email, wrong password: error in the alert region, still signed in, account still works
    cy.get('input[name="confirm-email"]').clear().type(email);
    confirmButton().should('not.be.disabled').click();
    cy.get('[role="dialog"] [role="alert"]').should('contain.text', 'password is not correct');
    cy.get('[role="dialog"]').should('be.visible');
    cy.url().should('include', '/dashboard');
    cy.request({ method: 'POST', url: '/api/auth/login', body: { email, password: PASSWORD } }).its('status').should('eq', 200);

    // Right password: account gone, back on the landing with a confirmation, login no longer works
    cy.get('input[name="delete-password"]').clear().type(PASSWORD);
    confirmButton().click();
    cy.location('pathname').should('eq', '/');
    cy.get('[data-account-deleted]').should('be.visible').and('contain.text', 'deleted');
    cy.request({ method: 'POST', url: '/api/auth/login', body: { email, password: PASSWORD }, failOnStatusCode: false })
      .its('status')
      .should('eq', 401);
    loginViaUi(email);
    cy.url().should('include', '/login');
    cy.get('[role="alert"]').should('exist');
  });

  it('cancelling the confirmation keeps the account and returns the focus to the delete button', () => {
    const email = uniqueEmail('keep');
    registerViaApi(email, 'keepuser');
    loginViaUi(email);
    cy.url().should('include', '/dashboard');

    openProfile();
    cy.contains('button', 'Delete account').click();
    cy.get('input[name="confirm-email"]').type(email);
    cy.get('[role="dialog"] form').contains('button', 'Cancel').click();
    cy.get('form input[name="confirm-email"]').should('not.exist');
    cy.contains('button', 'Delete account').should('be.focused');
    cy.request({ method: 'POST', url: '/api/auth/login', body: { email, password: PASSWORD } }).its('status').should('eq', 200);
  });
});
