describe('Authentication Flow', () => {
  const randomEmail = `testuser${Date.now()}@example.com`;
  const password = 'Password123!';

  it('Should successfully register a new user', () => {
    cy.visit('/signup');
    
    // Fill the signup form
    cy.get('input[name="username"]').type('TestUser');
    cy.get('input[name="email"]').type(randomEmail);
    cy.get('input[name="password"]').type(password);
    
    // Submit
    cy.get('button[type="submit"]').click();
    
    // Should be redirected to login
    cy.url().should('include', '/login');
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
    cy.contains('Proyectos').should('be.visible');
  });
});
