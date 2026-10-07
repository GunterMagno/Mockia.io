// La UI elige idioma segun el navegador: estos tests fijan ingles
Cypress.on('window:before:load', (win) => win.localStorage.setItem('mockia_locale', 'en'));

/**
 * Exportar los mocks de un proyecto desde la cabecera del editor: OpenAPI 3.1, coleccion Postman v2.1 y handlers MSW.
 * Los archivos llegan de verdad a cypress/downloads (carpeta ignorada por git) y se comprueba su contenido.
 */
const PASSWORD = 'Export-pass-12345';
const STAMP = Date.now();
const EMAIL = `exporter${STAMP}@example.com`;
const TITLE = `Export Project ${STAMP}`;
const API_KEY_PATTERN = /[0-9a-f]{48}/;

let slug = '';
let apiKey = '';

const parse = (file: unknown) => (typeof file === 'string' ? JSON.parse(file) : file) as Record<string, any>;

const openMenu = () => {
  cy.contains('button', 'Export').as('exportBtn').click();
  cy.get('[role="menu"]').should('be.visible');
};

const chooseItem = (label: string) => {
  openMenu();
  cy.contains('[role="menuitem"]', label).click();
  cy.get('[role="menu"]').should('not.exist');
};

describe('Export the project mocks', () => {
  before(() => {
    cy.request('POST', '/api/auth/register', { email: EMAIL, password: PASSWORD, username: 'exporter', locale: 'en' });
    cy.request('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD }).then((login) => {
      const headers = { Authorization: `Bearer ${login.body.data.tokens.accessToken}` };
      cy.request({ method: 'POST', url: '/api/projects', headers, body: { title: TITLE, description: 'Exported by Cypress' } }).then((res) => {
        slug = res.body.data.slug;
        apiKey = res.body.data.apiKey;
        expect(apiKey).to.match(API_KEY_PATTERN);
        cy.request({ method: 'POST', url: `/api/endpoints/${slug}`, headers, body: { path: '/users/:id', method: 'GET', description: 'Get a user' } })
          .then((ep) => {
            cy.request({ method: 'PUT', url: `/api/endpoints/${ep.body.data.id}`, headers, body: { responseBody: { id: 1, name: 'Ana' }, statusCode: 200 } });
          });
        cy.request({ method: 'POST', url: `/api/endpoints/${slug}`, headers, body: { path: '/users', method: 'POST', description: 'Create a user' } });
      });
    });
    // The API login put a refresh cookie in the browser: every test logs in through the UI like a user
    cy.clearCookies();
  });

  beforeEach(() => {
    cy.visit('/login');
    cy.get('input[name="email"]').type(EMAIL);
    cy.get('input[name="password"]').type(PASSWORD);
    cy.get('button[type="submit"]').click();
    cy.contains(TITLE).click();
    cy.url().should('include', '/editor/');
  });

  afterEach(() => {
    // a test may leave a narrow viewport behind
    cy.viewport(1280, 720);
  });

  it('is an accessible menu button: expanded state, arrow keys, Escape returns the focus', () => {
    cy.contains('button', 'Export').as('exportBtn')
      .should('have.attr', 'aria-haspopup', 'menu')
      .and('have.attr', 'aria-expanded', 'false');

    cy.get('@exportBtn').click().should('have.attr', 'aria-expanded', 'true');
    cy.get('[role="menu"]').should('be.visible').find('[role="menuitem"]').should('have.length', 3);
    cy.get('[role="menuitem"]').eq(0).should('have.focus').and('contain.text', 'OpenAPI (.json)');

    cy.press(Cypress.Keyboard.Keys.DOWN);
    cy.get('[role="menuitem"]').eq(1).should('have.focus').and('contain.text', 'Postman collection');
    cy.press(Cypress.Keyboard.Keys.DOWN);
    cy.get('[role="menuitem"]').eq(2).should('have.focus').and('contain.text', 'MSW handlers (.ts)');
    cy.press(Cypress.Keyboard.Keys.DOWN);
    cy.get('[role="menuitem"]').eq(0).should('have.focus');
    cy.press(Cypress.Keyboard.Keys.UP);
    cy.get('[role="menuitem"]').eq(2).should('have.focus');

    cy.press(Cypress.Keyboard.Keys.ESC);
    cy.get('[role="menu"]').should('not.exist');
    cy.get('@exportBtn').should('have.focus').and('have.attr', 'aria-expanded', 'false');
  });

  it('a click outside closes the menu', () => {
    openMenu();
    cy.get('body').click(0, 0);
    cy.get('[role="menu"]').should('not.exist');
  });

  it('downloads a valid OpenAPI 3.1 document with the routes, the server and no API key', () => {
    cy.intercept('GET', '/api/projects/*/export*').as('export');
    chooseItem('OpenAPI (.json)');
    cy.wait('@export').its('response.statusCode').should('eq', 200);

    cy.readFile(`cypress/downloads/${slug}-openapi.json`, { timeout: 15000 }).then((file) => {
      const doc = parse(file);
      expect(doc.openapi).to.eq('3.1.0');
      expect(doc.info.title).to.eq(TITLE);
      expect(doc.servers[0].url).to.match(new RegExp(`/api/mock/${slug}$`));
      expect(Object.keys(doc.paths)).to.include.members(['/users', '/users/{id}']);
      expect(doc.paths['/users/{id}'].get.parameters[0]).to.include({ name: 'id', in: 'path', required: true });
      expect(doc.paths['/users/{id}'].get.responses['200'].content['application/json'].examples.example_1.value).to.deep.eq({ id: 1, name: 'Ana' });
      expect(doc.paths['/users'].post).to.exist;
      expect(JSON.stringify(doc)).not.to.contain(apiKey);
    });
    cy.get('[role="status"]').should('contain.text', `${slug}-openapi.json downloaded`);
  });

  it('downloads a Postman v2.1 collection', () => {
    chooseItem('Postman collection');
    cy.readFile(`cypress/downloads/${slug}.postman_collection.json`, { timeout: 15000 }).then((file) => {
      const col = parse(file);
      expect(col.info.schema).to.eq('https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
      expect(col.variable.map((v: { key: string }) => v.key)).to.include('baseUrl');
      expect(col.item.map((i: { name: string }) => i.name)).to.include.members(['GET /users/:id', 'POST /users']);
      expect(JSON.stringify(col)).not.to.contain(apiKey);
    });
  });

  it('downloads MSW handlers as a TypeScript file', () => {
    chooseItem('MSW handlers (.ts)');
    cy.readFile(`cypress/downloads/${slug}-handlers.ts`, { timeout: 15000 }).then((code) => {
      const text = String(code);
      expect(text).to.contain("from 'msw'");
      expect(text).to.contain('http.get("/users/:id"');
      expect(text).to.contain('http.post("/users"');
      expect(text).to.contain('export const handlers');
      expect(text).not.to.contain(apiKey);
    });
  });

  it('shows an error message (and keeps working) when the export fails', () => {
    cy.intercept('GET', '/api/projects/*/export*', { statusCode: 429, body: { success: false, error: { code: 'RATE_LIMIT_ERROR', message: 'Too many requests. Try again later.' } } }).as('limited');
    chooseItem('OpenAPI (.json)');
    cy.wait('@limited');
    cy.get('[role="alert"]').should('contain.text', 'Could not export').and('be.visible');
    cy.contains('button', 'Export').should('not.be.disabled');
  });

  it('works on a phone-sized screen', () => {
    cy.viewport(375, 812);
    cy.contains('button', 'Export').scrollIntoView().should('be.visible').click();
    cy.get('[role="menu"]').should('be.visible').then(($menu) => {
      const rect = $menu[0].getBoundingClientRect();
      expect(rect.left, 'menu inside the viewport (left)').to.be.at.least(0);
      expect(rect.right, 'menu inside the viewport (right)').to.be.at.most(375);
    });
    cy.contains('[role="menuitem"]', 'MSW handlers (.ts)').should('be.visible');
    cy.press(Cypress.Keyboard.Keys.ESC);
    cy.get('[role="menu"]').should('not.exist');
  });
});
