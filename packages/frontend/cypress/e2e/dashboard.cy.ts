// La UI elige idioma segun el navegador: estos tests fijan ingles (tambien en los hooks before)
Cypress.on('window:before:load', (win) => win.localStorage.setItem('mockia_locale', 'en'));

describe('Dashboard Flow', () => {
  const randomEmail = `dashuser${Date.now()}@example.com`;
  const password = 'Password123!';

  before(() => {
    // Register and login before tests
    cy.request('POST', 'http://localhost:3000/api/auth/register', {
      username: 'DashUser',
      email: randomEmail,
      password: password
    }).then(() => {
      // Login via UI to set local storage / cookies properly
      cy.visit('/login');
      cy.get('input[name="email"]').type(randomEmail);
      cy.get('input[name="password"]').type(password);
      cy.get('button[type="submit"]').click();
      cy.url().should('include', '/dashboard');
    });
  });

  it('Should create a new project', () => {
    const projectName = `New Project ${Date.now()}`;
    
    // Click on create project button
    cy.contains('button', 'New project').click();
    
    // Step 1: Select Empty Project card
    cy.contains('Empty project').click();
    
    // Step 2: Fill Details (using placeholder selectors as name attribute is not present)
    cy.get('input[placeholder="My awesome API"]').type(projectName);
    cy.get('input[placeholder="A short description of what this API does…"]').type('E2E Test Project');
    
    // Click Continue
    cy.contains('button', 'Continue').click();
    
    // Step 3: Skip AI generation for fast testing
    cy.get('#shouldGenerate').uncheck({ force: true });
    
    // Click Create Project
    cy.contains('button', 'Create project').click();
    
    // Step 4: Click Go to Editor on success screen
    cy.contains('button', 'Go to editor').click();
    
    // Should be redirected to the editor view
    cy.url().should('include', '/editor/');
  });
});
