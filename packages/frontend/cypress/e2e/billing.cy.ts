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
  describe('precio mensual / anual y Enterprise', () => {
    // Importes del catalogo compartido (@mockia/shared PLAN_PRICE_USD): Pro 29 / 290 al ano, Team 99 / 990 al ano; el anual son 10 meses (ahorro 17 %)
    const toggle = () => cy.get('[role="group"][aria-label="Billing period"]');

    it('en la landing el selector cambia los importes mostrados y los avisa con texto', () => {
      cy.visit('/');
      cy.get('#pricing-title').scrollIntoView();

      toggle().contains('button', 'Monthly').should('have.attr', 'aria-pressed', 'true');
      toggle().contains('button', 'Yearly').should('have.attr', 'aria-pressed', 'false');
      cy.get('[data-testid="price-pro"]').should('have.text', '$29');
      cy.get('[data-testid="price-team"]').should('have.text', '$99');
      cy.get('[data-testid="price-free"]').should('have.text', '$0');
      cy.get('[data-testid="billed-pro"]').should('have.text', 'Billed monthly');

      // Teclado: Tab desde el segmento mensual llega al anual (son <button> nativos: Enter y Espacio los activan en el navegador;
      // cy.press envia la tecla pero no ejecuta la accion por defecto, asi que la activacion se prueba con click)
      toggle().contains('button', 'Monthly').focus();
      cy.press(Cypress.Keyboard.Keys.TAB);
      cy.focused().should('contain.text', 'Yearly');
      cy.focused().click();
      toggle().contains('button', 'Yearly').should('have.attr', 'aria-pressed', 'true');
      toggle().contains('button', 'Monthly').should('have.attr', 'aria-pressed', 'false');
      // 290 / 12 = 24,17 y 990 / 12 = 82,50 al mes; se cobra el ano entero
      cy.get('[data-testid="price-pro"]').should('have.text', '$24.17');
      cy.get('[data-testid="price-team"]').should('have.text', '$82.50');
      cy.get('[data-testid="price-free"]').should('have.text', '$0');
      cy.get('[data-testid="billed-pro"]').should('contain.text', 'Billed yearly $290').and('contain.text', 'Save 17%');
      cy.get('[data-testid="billed-team"]').should('contain.text', 'Billed yearly $990').and('contain.text', 'Save 17%');

      toggle().contains('button', 'Monthly').click();
      cy.get('[data-testid="price-pro"]').should('have.text', '$29');
    });

    it('Enterprise no tiene precio ni checkout: solo un enlace mailto para hablar', () => {
      cy.visit('/');
      cy.get('#pricing-title').scrollIntoView();
      cy.get('[data-testid="plan-enterprise"]').within(() => {
        cy.contains('h3', 'Enterprise').should('be.visible');
        cy.contains('Custom').should('be.visible');
        cy.contains('SSO or an SLA').should('be.visible');
        cy.contains('a', 'Contact us').should('have.attr', 'href').and('match', /^mailto:[^?\s]+@[^?\s]+\?subject=/);
        cy.get('button').should('not.exist');
      });
    });

    it('las cuatro tarjetas caben sin desbordar en 375, 768 y 1440 px', () => {
      for (const [width, height] of [[375, 812], [768, 1024], [1440, 900]]) {
        cy.viewport(width, height);
        cy.visit('/');
        cy.get('#pricing-title').scrollIntoView();
        cy.get('ul[class*="grid"] > li').should('have.length', 4);
        cy.document().then((doc) => {
          expect(doc.documentElement.scrollWidth, `ancho ${width}`).to.be.at.most(width);
        });
      }
    });

    const loginFresh = (username: string) => {
      const email = `${username.toLowerCase()}${Date.now()}@example.com`;
      cy.request('POST', `${API}/auth/register`, { username, email, password });
      cy.clearCookies();
      cy.visit('/login');
      cy.get('input[name="email"]').type(email);
      cy.get('input[name="password"]').type(password);
      cy.get('button[type="submit"]').click();
      cy.location('pathname').should('eq', '/dashboard');
    };
    const day = 86400000;
    const overviewOf = (extra: Record<string, unknown>) => ({
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
        usage: { activeProjects: 0, monthlyRequests: 0, periodResetAt: new Date(Date.now() + 20 * day).toISOString() },
        canManageBilling: false,
        checkoutAvailable: { pro: true, team: true },
        yearlyCheckoutAvailable: { pro: true, team: false },
        ...extra,
      },
    });

    it('en facturacion el checkout viaja con el intervalo elegido', () => {
      loginFresh('IntervalUser');
      cy.intercept('GET', '**/api/billing/me', overviewOf({})).as('overview');
      // Respuesta simulada hacia una pagina propia: no se sale de la app
      cy.intercept('POST', '**/api/billing/checkout', { success: true, data: { id: 'cs_1', url: '/billing?checkout=cancel' } }).as('checkout');

      cy.visit('/billing');
      cy.wait('@overview');
      toggle().contains('button', 'Yearly').click();
      cy.contains('li', 'Pro').within(() => cy.contains('button', 'Upgrade to Pro').click());
      cy.wait('@checkout').its('request.body').should('deep.equal', { plan: 'pro', interval: 'year' });

      // Sin el precio anual de Team configurado, el anual de Team no se ofrece, pero el mensual si (y en movil la pagina no desborda)
      cy.viewport(375, 812);
      cy.visit('/billing');
      cy.wait('@overview');
      cy.get('#billing-plans-title').should('exist');
      cy.document().then((doc) => expect(doc.documentElement.scrollWidth).to.be.at.most(375));
      toggle().contains('button', 'Yearly').click();
      cy.contains('li', 'Team').within(() => cy.contains('button', 'Not available yet').should('be.disabled'));
      toggle().contains('button', 'Monthly').click();
      cy.contains('li', 'Team').within(() => cy.contains('button', 'Upgrade to Team').click());
      cy.wait('@checkout').its('request.body').should('deep.equal', { plan: 'team', interval: 'month' });
    });

    it('un suscriptor anual ve su intervalo y puede pasar al mensual desde el portal', () => {
      loginFresh('YearlyUser');
      const pro = overviewOf({
        plan: 'pro',
        subscribedPlan: 'pro',
        interval: 'year',
        currentPeriodEnd: new Date(Date.now() + 200 * day).toISOString(),
        limits: { maxActiveProjects: 50, maxMonthlyRequests: 1_000_000 },
        canManageBilling: true,
        yearlyCheckoutAvailable: { pro: true, team: true },
      });
      cy.intercept('GET', '**/api/billing/me', pro).as('overview');
      cy.intercept('POST', '**/api/billing/portal', { success: true, data: { url: '/billing?portal=returned' } }).as('portal');
      cy.visit('/billing');
      cy.wait('@overview');
      cy.get('[data-testid="billing-interval"]').should('have.text', 'Billed yearly');
      // El selector arranca en el intervalo que ya paga: su tarjeta es el plan actual
      toggle().contains('button', 'Yearly').should('have.attr', 'aria-pressed', 'true');
      cy.contains('li', 'Pro').within(() => cy.contains('button', 'Current plan').should('be.disabled'));
      toggle().contains('button', 'Monthly').click();
      cy.contains('li', 'Pro').within(() => cy.contains('button', 'Switch to monthly billing').click());
      cy.wait('@portal');
      cy.location('search').should('eq', '?portal=returned');
    });

    it('el intervalo elegido en la landing llega a facturacion tras registrarse', () => {
      const email = `landing-interval${Date.now()}@example.com`;
      cy.clearLocalStorage();
      cy.clearCookies();
      cy.visit('/');
      cy.get('#pricing-title').scrollIntoView();
      toggle().contains('button', 'Yearly').click();
      cy.contains('li', 'Pro').within(() => cy.contains('button', 'Choose Pro').click());
      cy.location('pathname').should('eq', '/signup');
      cy.get('input[name="username"]').type('LandingInterval');
      cy.get('input[name="email"]').type(email);
      cy.get('input[name="new-password"]').type(password);
      cy.get('button[type="submit"]').click();
      cy.location('pathname').should('eq', '/billing');
      cy.location('search').should('eq', '?upgrade=pro&interval=year');
      toggle().contains('button', 'Yearly').should('have.attr', 'aria-pressed', 'true');
    });
  });

  describe('landing sin cifras ni testimonios inventados', () => {
    // Tampoco se anuncian capacidades que no existen: no hay CLI (en/es/zh: CLI, terminal, linea de comandos)
    const FAKE = /Sarah Chen|Veloce|100\+|99\.9|edge locations|CLI-first|(^|[^a-z])CLI([^a-z]|$)|terminal|终端|命令行/i;

    it('no muestra regiones, uptime ni la cita falsa, y no desborda en 375 px', () => {
      cy.viewport(375, 812);
      cy.visit('/');
      cy.get('#pricing-title').should('exist');
      cy.document().then((doc) => {
        expect(doc.body.innerText).not.to.match(FAKE);
        expect(doc.documentElement.scrollWidth).to.be.at.most(375);
      });
      cy.get('blockquote').should('not.exist');
      // Los enlaces de la cabecera y las secciones siguen existiendo
      for (const id of ['how-title', 'builder-title', 'features-title', 'pricing-title', 'story-title']) cy.get(`#${id}`).should('exist');
    });

    it('tampoco en espanol ni en chino, y el selector de precios esta traducido', () => {
      cy.visit('/');
      for (const [locale, group, yearly, billed] of [
        ['es', 'Periodo de facturación', 'Anual', 'Facturado anualmente: 290'],
        ['zh', '计费周期', '按年', '按年计费'],
      ]) {
        cy.get('select:has(option[value="zh"])').filter(':visible').first().select(locale);
        cy.get('#pricing-title').scrollIntoView();
        cy.get(`[role="group"][aria-label="${group}"]`).contains('button', yearly).click();
        cy.get('[data-testid="billed-pro"]').should('contain.text', billed);
        cy.document().then((doc) => {
          expect(doc.body.innerText).not.to.match(FAKE);
        });
      }
    });
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
      cy.get('[data-testid="past-due-banner"][role="status"]')
        .should('contain.text', 'We couldn’t charge your card')
        .and('contain.text', `Your Pro features stay active until ${graceEndText}`)
        .and('contain.text', 'Update your payment method');
      cy.contains('[data-testid="past-due-banner"][role="status"] button', 'Update payment method').click();
      cy.wait('@portal');
      cy.location('search').should('eq', '?portal=returned');
    });

    it('el panel muestra el mismo aviso con el boton al portal y marca el plan como pago fallido', () => {
      cy.intercept('GET', '**/api/billing/me', overview()).as('overview');
      cy.intercept('POST', '**/api/billing/portal', { success: true, data: { url: '/billing?portal=returned' } }).as('portal');

      cy.visit('/dashboard');
      cy.wait('@overview');
      cy.get('[data-testid="past-due-banner"][role="status"]').should('contain.text', `Your Pro features stay active until ${graceEndText}`);
      cy.contains('a', 'Pro plan').should('contain.text', 'Payment failed');
      cy.contains('[data-testid="past-due-banner"][role="status"] button', 'Update payment method').click();
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
      cy.get('[data-testid="past-due-banner"][role="status"]').should('contain.text', 'limited to the Free plan').and('not.contain.text', 'stay active until');
      cy.contains('[data-testid="past-due-banner"][role="status"] button', 'Update payment method').should('be.visible');
    });

    // The counter restarts at 00:00 UTC of the 1st and Stripe periods end at UTC instants: the dates are shown in UTC,
    // not in the browser's zone (in UTC+2, 23:30 UTC on the 31st would read as the 1st of the next month)
    it('las fechas de renovacion y de reinicio del contador se muestran en UTC', () => {
      cy.intercept('GET', '**/api/billing/me', overview({
        billingStatus: 'active',
        pastDueUntil: null,
        currentPeriodEnd: '2026-11-30T23:30:00.000Z',
        usage: { activeProjects: 2, monthlyRequests: 120, periodResetAt: '2026-10-31T23:30:00.000Z' },
      })).as('overview');
      cy.visit('/billing');
      cy.wait('@overview');
      cy.contains('The request counter resets on October 31, 2026.').should('be.visible');
      cy.contains('Renews on November 30, 2026').should('be.visible');
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
