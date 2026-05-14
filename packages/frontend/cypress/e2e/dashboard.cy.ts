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
    cy.contains('button', 'New Project').click();
    
    // Fill modal form
    cy.get('input[name="title"]').type(projectName);
    cy.get('textarea[name="description"]').type('E2E Test Project');
    
    // Click submit
    cy.contains('button', 'Create Project').click();
    
    // Project should appear in the dashboard list
    cy.contains(projectName).should('be.visible');
  });
});
