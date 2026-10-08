// La UI elige idioma segun el navegador: estos tests fijan ingles
Cypress.on('window:before:load', (win) => win.localStorage.setItem('mockia_locale', 'en'));

// La campana consulta GET /api/notifications cada 10 s mientras la pestana esta visible y se detiene al ocultarla
// (antes cada 2,5 s siempre: 360 peticiones / 15 min por pestana agotaban el limitador global compartido).
describe('Notification polling', () => {
  const email = `poll${Date.now()}@example.com`;
  const password = 'Password123!';

  before(() => {
    cy.request('POST', '/api/auth/register', { email, password, username: 'PollUser' });
  });

  it('polls every 10 s while visible, pauses while the tab is hidden and resumes when it is shown', () => {
    let notificationCalls = 0;
    cy.intercept('GET', '/api/notifications', (req) => {
      notificationCalls += 1;
      req.reply({ statusCode: 200, body: { success: true, data: [] } });
    }).as('notifications');

    // Log in through the API: the refresh cookie lets the dashboard restore the session on load
    cy.clearCookies();
    cy.request('POST', '/api/auth/login', { email, password });

    const visibility = { state: 'visible' as DocumentVisibilityState };
    cy.clock(Date.now(), ['setInterval', 'clearInterval']);
    cy.visit('/dashboard', {
      onBeforeLoad(win) {
        Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => visibility.state });
        Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => visibility.state === 'hidden' });
      },
    });
    cy.contains('My projects').should('be.visible');
    cy.wait('@notifications');
    // Several bells may be mounted (desktop + mobile header, StrictMode in dev): compare deltas, not absolute counts
    let base = 0;
    let perTick = 0;
    cy.wait(500).then(() => {
      base = notificationCalls;
      expect(base, 'fetched on mount').to.be.greaterThan(0);
    });

    // 2.5 s (the old interval) is not enough for another call; 10 s is
    cy.tick(2500);
    cy.wait(300).then(() => expect(notificationCalls - base, 'after 2.5 s').to.eq(0));
    cy.tick(7500);
    cy.wait('@notifications');
    cy.wait(300).then(() => {
      perTick = notificationCalls - base;
      expect(perTick, 'after 10 s').to.be.greaterThan(0);
      base = notificationCalls;
    });

    // Hidden tab: no polling at all
    cy.document().then((doc) => {
      visibility.state = 'hidden';
      doc.dispatchEvent(new Event('visibilitychange'));
    });
    cy.tick(60_000);
    cy.wait(300).then(() => expect(notificationCalls - base, 'while hidden').to.eq(0));

    // Visible again: an immediate refresh, then every 10 s
    cy.document().then((doc) => {
      visibility.state = 'visible';
      doc.dispatchEvent(new Event('visibilitychange'));
    });
    cy.wait('@notifications');
    cy.wait(300).then(() => {
      expect(notificationCalls - base, 'on becoming visible').to.be.greaterThan(0);
      base = notificationCalls;
    });
    cy.tick(10_000);
    cy.wait('@notifications');
    cy.wait(300).then(() => expect(notificationCalls - base, '10 s after becoming visible').to.eq(perTick));
  });
});
