describe('Editor Flow', () => {
  const randomEmail = `editoruser${Date.now()}@example.com`;
  const password = 'Password123!';
  let projectId: string;

  before(() => {
    // Setup: Register and Create a Project via API
    cy.request('POST', 'http://localhost:3000/api/auth/register', {
      username: 'EditorUser',
      email: randomEmail,
      password: password
    }).then((res) => {
      const token = res.body.data.tokens.accessToken;
      cy.request({
        method: 'POST',
        url: 'http://localhost:3000/api/projects',
        headers: { Authorization: `Bearer ${token}` },
        body: { title: 'Editor Test Project', description: 'Test' }
      }).then((projRes) => {
        projectId = projRes.body.data.id;
      });
    });
  });

  beforeEach(() => {
    cy.visit('/login');
    cy.get('input[name="email"]').type(randomEmail);
    cy.get('input[name="password"]').type(password);
    cy.get('button[type="submit"]').click();
  });

  it('Should open editor and display Mock API setup area', () => {
    // Navigate to project
    cy.contains('Editor Test Project').click();
    
    // Should be in the editor view
    cy.url().should('include', `/editor/${projectId}`);
    
    // Check if the sidebar or main panels are visible
    cy.contains('Endpoints').should('be.visible');
  });
});
