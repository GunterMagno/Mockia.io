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
