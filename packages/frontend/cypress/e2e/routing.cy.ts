// La UI elige idioma segun el navegador: estos tests fijan ingles (tambien en los hooks before)
Cypress.on('window:before:load', (win) => win.localStorage.setItem('mockia_locale', 'en'));

describe('Routing: home publico y login solo donde hace falta', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    cy.clearCookies();
  });

  it('la ruta por defecto es el home publico, no el login', () => {
    cy.visit('/');
    cy.location('pathname').should('eq', '/');
    cy.contains('h1', 'Stop waiting').should('be.visible');
  });

  it('las paginas publicas cargan sin sesion', () => {
    for (const p of ['/terms', '/privacy', '/legal', '/cookies']) {
      cy.visit(p);
      cy.location('pathname').should('eq', p);
    }
  });

  it('dashboard y editor piden login y recuerdan el destino', () => {
    cy.visit('/dashboard');
    cy.location('pathname').should('eq', '/login');
    cy.visit('/editor/algo');
    cy.location('pathname').should('eq', '/login');
  });

  it('una ruta desconocida muestra 404, no login', () => {
    cy.visit('/no-existe', { failOnStatusCode: false });
    cy.location('pathname').should('eq', '/no-existe');
  });
});
