// Aviso informativo de cookies: solo almacenamiento estrictamente necesario, sin consentimiento ni seguimiento.
// El soporte global (cypress/support/e2e.ts) lo deja cerrado en el resto de specs; aqui se activa de verdad.
Cypress.env('showCookieNotice', true);

const KEY = 'mockia_cookie_notice_dismissed';

const visitIn = (path: string, lang: 'es' | 'en' | 'zh', opts: { dismissed?: boolean } = {}) =>
  cy.visit(path, {
    onBeforeLoad: (win) => {
      win.localStorage.setItem('mockia_locale', lang);
      if (opts.dismissed) win.localStorage.setItem(KEY, '1');
    },
  });

describe('Cookie notice', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
  });

  it('shows on the first visit as a labelled, non-modal region with a link to /cookies', () => {
    visitIn('/', 'en');
    cy.get('[data-cookie-notice]')
      .should('be.visible')
      .and('have.attr', 'role', 'region')
      .and('have.attr', 'aria-label', 'Cookie notice')
      .and('contain.text', 'strictly necessary')
      .and('not.have.attr', 'aria-modal');
    cy.get('[data-cookie-notice] a[href="/cookies"]').should('be.visible');
    // no es un dialogo: no bloquea la pagina (se puede seguir usando)
    cy.get('[role="dialog"]').should('not.exist');
    cy.get('[data-cookie-notice] button').should('have.length', 1).and('contain.text', 'Got it');
  });

  it('is translated: es and zh', () => {
    visitIn('/', 'es');
    cy.get('[data-cookie-notice]').should('have.attr', 'aria-label', 'Aviso de cookies').and('contain.text', 'estrictamente necesarios');
    cy.get('[data-cookie-notice] button').should('contain.text', 'Entendido');
    visitIn('/', 'zh');
    cy.get('[data-cookie-notice]').should('have.attr', 'aria-label', 'Cookie 提示');
    cy.get('[data-cookie-notice] button').should('contain.text', '知道了');
  });

  it('dismissing stores the flag and it stays gone after a reload and on other pages', () => {
    visitIn('/', 'en');
    cy.get('[data-cookie-notice] button').click();
    cy.get('[data-cookie-notice]').should('not.exist');
    cy.window().then((win) => expect(win.localStorage.getItem(KEY)).to.eq('1'));
    cy.reload();
    cy.get('main').should('exist');
    cy.get('[data-cookie-notice]').should('not.exist');
    cy.visit('/login');
    cy.get('[data-cookie-notice]').should('not.exist');
  });

  it('does not show to a visitor who already dismissed it', () => {
    visitIn('/', 'en', { dismissed: true });
    cy.get('main').should('exist');
    cy.get('[data-cookie-notice]').should('not.exist');
  });

  it('is operable with the keyboard: Tab reaches the link then a native button with a visible focus ring', () => {
    visitIn('/', 'en');
    cy.get('[data-cookie-notice] a').should('not.have.attr', 'tabindex', '-1').focus();
    cy.focused().should('have.attr', 'href', '/cookies');
    // teclado real (CDP), no un click simulado
    cy.press(Cypress.Keyboard.Keys.TAB);
    // un <button> nativo: Enter y Espacio lo activan sin codigo extra (cy.press no genera el caracter que activa el boton,
    // asi que la activacion se comprueba con el click; el Enter real se verifico a mano en el navegador)
    cy.focused().should('have.prop', 'tagName', 'BUTTON').and('have.attr', 'type', 'button').and('contain.text', 'Got it');
    cy.focused().invoke('css', 'outline-style').should('not.eq', 'none');
    cy.focused().click();
    cy.get('[data-cookie-notice]').should('not.exist');
    cy.window().then((win) => expect(win.localStorage.getItem(KEY)).to.eq('1'));
  });

  it('stays compact on a phone and does not make the sign up button unreachable', () => {
    cy.viewport(375, 667);
    visitIn('/signup', 'en');
    cy.get('[data-cookie-notice]').should('be.visible').invoke('outerHeight').should('be.lessThan', 150);
    cy.get('button[type="submit"]').scrollIntoView().should('be.visible');
    cy.get('[data-cookie-notice] button').click();
    cy.get('[data-cookie-notice]').should('not.exist');
  });

  it('the Cookies page lists the new key and explains the informational notice', () => {
    for (const lang of ['es', 'en', 'zh'] as const) {
      visitIn('/cookies', lang, { dismissed: true });
      cy.get('article').should('contain.text', KEY);
    }
    visitIn('/cookies', 'en', { dismissed: true });
    cy.get('article').should('contain.text', 'informational notice').and('not.contain.text', 'Why we do not show a cookie banner');
  });
});
