// La UI elige idioma segun el navegador: estos tests fijan ingles (tambien en los hooks before)
Cypress.on('window:before:load', (win) => win.localStorage.setItem('mockia_locale', 'en'));

const API = 'http://localhost:3000/api';

describe('Billing: planes, limites y facturacion', () => {
  const password = 'Password123!';

  it('elegir un plan sin cuenta lleva al registro y vuelve a facturacion con el plan resaltado', () => {
    const email = `billing${Date.now()}@example.com`;
    cy.clearLocalStorage();
    cy.clearCookies();
    cy.visit('/');
    cy.get('#pricing-title').scrollIntoView();
    // Los Terminos prometen precios sin IVA; la nota bajo las tarjetas lo dice
    cy.contains('p', 'excluding VAT where applicable').should('be.visible');
    cy.contains('li', 'Team').within(() => cy.contains('button', 'Choose Team').click());

    cy.location('pathname').should('eq', '/signup');
    cy.get('input[name="username"]').type('BillingUser');
    cy.get('input[name="email"]').type(email);
    cy.get('input[name="new-password"]').type(password);
    cy.get('button[type="submit"]').click();

    cy.location('pathname').should('eq', '/billing');
    cy.location('search').should('eq', '?upgrade=team');
    cy.contains('h1', 'Plan & billing').should('be.visible');
    cy.contains('[aria-current="true"] h3', 'Free').should('exist');
    cy.get('li[class*="highlight"]').should('contain.text', 'Team');
    cy.get('[role="progressbar"][aria-label="Active projects"]').should('have.attr', 'aria-valuemax', '5');
  });

  it('al llegar al limite de proyectos del plan Free ofrece mejorar el plan', () => {
    const email = `limit${Date.now()}@example.com`;
    cy.request('POST', `${API}/auth/register`, { username: 'LimitUser', email, password })
      .then(() => cy.request('POST', `${API}/auth/login`, { email, password }))
      .then((res) => {
        const token = res.body.data.tokens.accessToken;
        for (let i = 1; i <= 5; i++) {
          cy.request({
            method: 'POST',
            url: `${API}/projects`,
            headers: { Authorization: `Bearer ${token}` },
            body: { title: `Limit project ${i}`, description: 'e2e' },
          });
        }
      });
    // The API login above also put a refresh cookie in the browser: the test logs in through the UI like a user
    cy.clearCookies();

    cy.visit('/login');
    cy.get('input[name="email"]').type(email);
    cy.get('input[name="password"]').type(password);
    cy.get('button[type="submit"]').click();
    cy.location('pathname').should('eq', '/dashboard');
    cy.contains('a', '5/5 projects').should('be.visible');

    cy.contains('button', 'New project').click();
    cy.contains('Empty project').click();
    cy.get('input[placeholder="My awesome API"]').type('One too many');
    cy.contains('button', 'Continue').click();
    cy.get('#shouldGenerate').uncheck({ force: true });
    cy.contains('button', 'Create project').click();

    cy.contains('Your Free plan allows 5 active projects').should('be.visible');
    cy.get('a[class*="upgradeLink"]').should('contain.text', 'Upgrade plan').click();
    cy.location('pathname').should('eq', '/billing');
    cy.contains('5 of 5').should('be.visible');
  });
  // La app no puede sembrar la base de datos desde Cypress: el estado de impago se simula interceptando GET /billing/me.
  describe('impago dentro del periodo de gracia', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const email = `pastdue${Date.now()}@example.com`;
    const graceEnd = new Date(Date.now() + 4 * DAY);
    const graceEndText = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(graceEnd);

    const overview = (extra: Record<string, unknown> = {}) => ({
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        plan: 'pro',
        subscribedPlan: 'pro',
        billingStatus: 'past_due',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        pastDueUntil: graceEnd.toISOString(),
        limits: { maxActiveProjects: 50, maxMonthlyRequests: 1_000_000 },
        usage: { activeProjects: 2, monthlyRequests: 120, periodResetAt: new Date(Date.now() + 20 * DAY).toISOString() },
        canManageBilling: true,
        checkoutAvailable: { pro: true, team: true },
        ...extra,
      },
    });

    before(() => {
      cy.request('POST', `${API}/auth/register`, { username: 'PastDueUser', email, password });
    });

    beforeEach(() => {
      cy.clearCookies();
      cy.clearLocalStorage();
      cy.visit('/login');
      cy.get('input[name="email"]').type(email);
      cy.get('input[name="password"]').type(password);
      cy.get('button[type="submit"]').click();
      cy.location('pathname').should('eq', '/dashboard');
    });

    it('la pagina de facturacion avisa de que el plan sigue activo hasta la fecha y abre el portal para actualizar la tarjeta', () => {
      cy.intercept('GET', '**/api/billing/me', overview()).as('overview');
      cy.intercept('POST', '**/api/billing/portal', { success: true, data: { url: '/billing?portal=returned' } }).as('portal');

      cy.visit('/billing');
      cy.wait('@overview');
      cy.get('[role="alert"]')
        .should('contain.text', 'We couldn’t charge your card')
        .and('contain.text', `Your Pro features stay active until ${graceEndText}`)
        .and('contain.text', 'Update your payment method');
      cy.contains('[role="alert"] button', 'Update payment method').click();
      cy.wait('@portal');
      cy.location('search').should('eq', '?portal=returned');
    });

    it('el panel muestra el mismo aviso con el boton al portal y marca el plan como pago fallido', () => {
      cy.intercept('GET', '**/api/billing/me', overview()).as('overview');
      cy.intercept('POST', '**/api/billing/portal', { success: true, data: { url: '/billing?portal=returned' } }).as('portal');

      cy.visit('/dashboard');
      cy.wait('@overview');
      cy.get('[role="alert"]').should('contain.text', `Your Pro features stay active until ${graceEndText}`);
      cy.contains('a', 'Pro plan').should('contain.text', 'Payment failed');
      cy.contains('[role="alert"] button', 'Update payment method').click();
      cy.wait('@portal');
      cy.location('pathname').should('eq', '/billing');
    });

    it('pasada la gracia el aviso dice que la cuenta esta limitada a Free', () => {
      cy.intercept('GET', '**/api/billing/me', overview({
        plan: 'free',
        pastDueUntil: new Date(Date.now() - DAY).toISOString(),
        limits: { maxActiveProjects: 5, maxMonthlyRequests: 10_000 },
      })).as('overview');
      cy.visit('/billing');
      cy.wait('@overview');
      cy.get('[role="alert"]').should('contain.text', 'limited to the Free plan').and('not.contain.text', 'stay active until');
      cy.contains('[role="alert"] button', 'Update payment method').should('be.visible');
    });

    it('con el cobro al dia no hay aviso', () => {
      cy.intercept('GET', '**/api/billing/me', overview({ billingStatus: 'active', pastDueUntil: null })).as('overview');
      cy.visit('/billing');
      cy.wait('@overview');
      cy.contains('h2', 'Pro').should('be.visible');
      cy.get('[data-testid="past-due-banner"]').should('not.exist');
    });
  });
});
