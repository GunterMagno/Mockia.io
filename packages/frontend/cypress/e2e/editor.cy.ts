describe('Editor Flow', () => {
  const randomEmail = `editoruser${Date.now()}@example.com`;
  const password = 'Password123!';
  let projectId: string;
  let projectSlug: string;
  let projectApiKey: string;

  before(() => {
    // Setup: Register and Create a Project via API
    cy.request('POST', 'http://localhost:3000/api/auth/register', {
      username: 'EditorUser',
      email: randomEmail,
      password: password
    }).then(() => {
      // Login via API to get access token
      cy.request('POST', 'http://localhost:3000/api/auth/login', {
        email: randomEmail,
        password: password
      }).then((loginRes) => {
        const token = loginRes.body.data.tokens.accessToken;
        cy.request({
          method: 'POST',
          url: 'http://localhost:3000/api/projects',
          headers: { Authorization: `Bearer ${token}` },
          body: { title: 'Editor Test Project', description: 'Test' }
        }).then((projRes) => {
          projectId = projRes.body.data.id;
          projectSlug = projRes.body.data.slug;
          projectApiKey = projRes.body.data.apiKey;
        });
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
    
    // Should be in the editor view (routes by slug)
    cy.url().should('include', `/editor/${projectSlug}`);
    
    // Check if the sidebar or main panels are visible
    cy.contains('Endpoints').should('be.visible');
  });

  it('Should create and configure a new Mock Endpoint', () => {
    // Go to project editor
    cy.contains('Editor Test Project').click();
    
    // Click on New Endpoint button in the sidebar
    cy.contains('button', '+ New Endpoint').click();
    
    // Check that default endpoint is rendered
    cy.contains('/new-endpoint').should('be.visible');
    
    // Update path using custom input wrapper selector
    cy.contains('fieldset', 'Path').find('input').clear().type('/hello');
    
    // Update HTTP method
    cy.contains('article', 'HTTP Method').find('select').select('POST');
    
    // Update status code to 201 Created
    cy.contains('article', 'Status Code').find('select').select('201');
    
    // Save changes
    cy.contains('button', 'Save Changes').click();
    
    // Assert that the unsaved changes dot is no longer present
    cy.contains('• Unsaved changes').should('not.exist');
    cy.contains('POST').should('be.visible');
    cy.contains('/hello').should('be.visible');
  });

  it('Should successfully call and resolve the newly created Mock API endpoint', () => {
    // Perform a request to the Mock Engine with correct project Slug and API Key
    cy.request({
      method: 'POST',
      url: `http://localhost:3000/api/mock/${projectSlug}/hello`,
      headers: {
        'X-Mockia-API-Key': projectApiKey
      },
      failOnStatusCode: false
    }).then((response) => {
      // Validate that the Mock Engine resolved the route and returned correct status
      expect(response.status).to.eq(201);
      expect(response.body).to.deep.eq({});
    });
  });
});
