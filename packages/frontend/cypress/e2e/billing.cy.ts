// La UI elige idioma segun el navegador: estos tests fijan ingles (tambien en los hooks before)
Cypress.on('window:before:load', (win) => win.localStorage.setItem('mockia_locale', 'en'));

const API = 'http://localhost:3000/api';

describe('Billing: planes, limites y facturacion', () => {
  const password = 'Password123!';

  it('elegir un plan sin cuenta lleva al registro y vuelve a facturacion con el plan resaltado', () => {
    const email = `billing${Date.now()}@example.com`;
    cy.clearLocalStorage();
    cy.visit('/');
    cy.get('#pricing-title').scrollIntoView();
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
});
