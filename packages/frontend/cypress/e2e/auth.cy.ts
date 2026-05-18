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
    cy.contains('My Projects').should('be.visible');
  });
});
