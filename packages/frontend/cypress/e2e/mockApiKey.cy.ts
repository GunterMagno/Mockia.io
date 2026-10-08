// La UI elige idioma segun el navegador: estos tests fijan ingles
Cypress.on('window:before:load', (win) => win.localStorage.setItem('mockia_locale', 'en'));

/**
 * Claves de API del mock: visibilidad "Requires API key", la clave se muestra una sola vez al crearla o rotarla,
 * y el mock responde 401 sin ella y 200 con ella. Tambien el medidor de peticiones mensuales (sobre un resumen simulado).
 */
const PASSWORD = 'ApiKey-pass-12345';
const STAMP = Date.now();
const EMAIL = `keyuser${STAMP}@example.com`;
const TITLE = `Key Project ${STAMP}`;
const HEADER = 'X-Mockia-API-Key';

let slug = '';
let mockUrl = '';

const openApiAccess = (mobile = false) => {
  if (mobile) {
    // On a phone the header collapses: settings live in the hamburger menu
    cy.get('button[aria-controls="site-nav"]').click();
    cy.contains('button', 'Configuration').click();
  } else {
    cy.get('button[aria-label="Project settings"]').click();
  }
  cy.contains('button', 'API access').click();
  cy.get('[data-testid="visibility-public"]').should('be.visible');
};

/** Reads the key shown in the one-time field. */
const shownKey = () => cy.get('[data-testid="new-api-key-value"]').invoke('val').then((v) => String(v));

const getMock = (key?: string) =>
  cy.request({ url: mockUrl, headers: key === undefined ? {} : { [HEADER]: key }, failOnStatusCode: false });

describe('Mock API keys', () => {
  before(() => {
    cy.request('POST', '/api/auth/register', { email: EMAIL, password: PASSWORD, username: 'keyuser', locale: 'en' });
    cy.request('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD }).then((login) => {
      const headers = { Authorization: `Bearer ${login.body.data.tokens.accessToken}` };
      cy.request({ method: 'POST', url: '/api/projects', headers, body: { title: TITLE, description: 'Keys' } }).then((res) => {
        slug = res.body.data.slug;
        mockUrl = `/api/mock/${slug}/ping`;
        expect(res.body.data).to.include({ visibility: 'public', hasApiKey: false });
        expect(res.body.data).not.to.have.property('apiKey');
        cy.request({ method: 'POST', url: `/api/endpoints/${slug}`, headers, body: { path: '/ping', method: 'GET', description: 'Ping' } })
          .then((ep) => {
            cy.request({ method: 'PUT', url: `/api/endpoints/${ep.body.data.id}`, headers, body: { responseBody: { pong: true }, statusCode: 200 } });
          });
      });
    });
    cy.clearCookies();
  });

  beforeEach(() => {
    cy.visit('/login');
    cy.get('input[name="email"]').type(EMAIL);
    cy.get('input[name="password"]').type(PASSWORD);
    cy.get('button[type="submit"]').click();
  });

  afterEach(() => {
    cy.viewport(1280, 720);
  });

  it('keeps the mock public until a key is issued and the owner asks for it; the key shows once; rotating invalidates the old one', () => {
    getMock().its('status').should('eq', 200);

    cy.contains(TITLE).click();
    cy.url().should('include', `/editor/${slug}`);
    cy.get('[data-testid="editor-auth-info"]').should('contain.text', 'Public mock');
    openApiAccess();

    // Requiring a key is not possible before one exists
    cy.get('[data-testid="visibility-key"]').should('be.disabled');
    cy.contains('Generate an API key first to require it.').should('be.visible');

    // Generate: the full key is shown once, with a clear warning and an aria-live confirmation
    cy.window().then((win) => cy.stub(win.navigator.clipboard, 'writeText').resolves().as('clipboard'));
    cy.get('[data-testid="api-key-generate"]').click();
    cy.get('[data-testid="new-api-key"]').should('contain.text', "Copy it now. You won't see it again.");
    cy.get('[data-testid="api-access-live"]').should('have.attr', 'aria-live', 'polite').and('contain.text', "you won't see it again");
    shownKey().then((first) => {
      expect(first).to.match(/^mk_[0-9a-f]{48}$/);
      cy.get('[data-testid="api-key-copy"]').click();
      cy.get('@clipboard').should('have.been.calledWith', first);
      cy.get('[data-testid="api-access-live"]').should('contain.text', 'API key copied to the clipboard');

      // Still public: no key needed yet
      getMock().its('status').should('eq', 200);

      // Switch to "Requires API key"
      cy.get('[data-testid="api-key-saved"]').click();
      cy.get('[data-testid="new-api-key"]').should('not.exist');
      cy.get('[data-testid="api-key-current"]').should('contain.text', first.slice(0, 9));
      cy.get('[data-testid="api-key-current"]').should('not.contain.text', first);
      cy.get('[data-testid="visibility-key"]').should('not.be.disabled').check();
      cy.get('[data-testid="api-access-live"]').should('contain.text', 'Mock visibility is now: Requires API key');

      getMock().then((res) => {
        expect(res.status).to.eq(401);
        expect(res.body.error.code).to.eq('UNAUTHORIZED');
        expect(res.headers).not.to.have.property('www-authenticate');
      });
      getMock(first).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.deep.eq({ pong: true });
        expect(res.headers['x-ratelimit-limit']).to.match(/^\d+$/);
        expect(res.headers['x-ratelimit-remaining']).to.match(/^\d+$/);
      });
      getMock('mk_' + '0'.repeat(48)).its('status').should('eq', 401);

      // The key is gone from the page once dismissed
      cy.get('body').should('not.contain.text', first);

      // The editor shows which header the mock expects
      cy.get('body').type('{esc}');
      cy.get('[data-testid="editor-auth-info"]').should('contain.text', HEADER);

      // Rotate: a new key, the old one stops working
      openApiAccess();
      cy.contains('[data-testid="api-key-generate"]', 'Rotate key').click();
      shownKey().then((second) => {
        expect(second).not.to.eq(first);
        getMock(first).its('status').should('eq', 401);
        getMock(second).its('status').should('eq', 200);
      });
    });
  });

  it('shows the header in the snippets of a private mock and can revoke the key', () => {
    cy.contains(TITLE).click();
    cy.url().should('include', `/editor/${slug}`);
    cy.contains('/ping').click();
    cy.contains('pre code', HEADER).should('exist');

    openApiAccess();
    cy.get('[data-testid="api-key-current"]').should('contain.text', 'mk_');
    cy.get('[data-testid="api-key-revoke"]').click();
    cy.get('[data-testid="api-key-revoke-confirm"]').click();
    cy.get('[data-testid="api-access-live"]').should('contain.text', 'API key revoked');
    cy.contains('This mock requires a key but none exists').should('be.visible');
    getMock('mk_whatever').its('status').should('eq', 401);

    // Back to public
    cy.get('[data-testid="visibility-public"]').check();
    cy.get('[data-testid="api-access-live"]').should('contain.text', 'Mock visibility is now: Public');
    getMock().its('status').should('eq', 200);
  });

  it('the panel fits a phone and the keyboard reaches the key controls', () => {
    cy.viewport(375, 812);
    cy.contains(TITLE).click();
    cy.url().should('include', `/editor/${slug}`);
    openApiAccess(true);
    cy.get('[data-testid="api-key-generate"]').should('be.visible').focus().should('have.focus');
    cy.document().then((doc) => expect(doc.documentElement.scrollWidth).to.be.at.most(375));
  });

  it('shows the monthly mock request meter on billing and in the dashboard plan chip', () => {
    const overview = {
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        plan: 'free',
        subscribedPlan: 'free',
        billingStatus: 'active',
        interval: null,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        pastDueUntil: null,
        limits: { maxActiveProjects: 5, maxMonthlyRequests: 10_000 },
        usage: { activeProjects: 1, monthlyRequests: 9_500, periodResetAt: new Date(Date.now() + 5 * 86400000).toISOString() },
        canManageBilling: false,
        checkoutAvailable: { pro: true, team: true },
        yearlyCheckoutAvailable: { pro: true, team: true },
      },
    };
    cy.location('pathname').should('eq', '/dashboard'); // the login of beforeEach has finished
    cy.intercept('GET', '**/api/billing/me', overview).as('overview');
    cy.visit('/dashboard');
    cy.wait('@overview');
    cy.get('[data-testid="plan-chip-requests"]').should('contain.text', '9,500/10,000 requests this month');

    cy.visit('/billing');
    cy.wait('@overview');
    cy.get('[role="progressbar"][aria-label="Mock requests"]')
      .should('have.attr', 'aria-valuenow', '9500')
      .and('have.attr', 'aria-valuetext', '9,500 of 10,000');
    cy.contains('The request counter resets on').should('be.visible');
    cy.contains('li', 'Free').should('contain.text', '10K');

    cy.viewport(375, 812);
    cy.visit('/billing');
    cy.wait('@overview');
    cy.document().then((doc) => expect(doc.documentElement.scrollWidth).to.be.at.most(375));
  });
});
