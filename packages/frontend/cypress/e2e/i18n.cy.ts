const languageSelect = () => cy.get('select:has(option[value="zh"])').filter(':visible').first();

describe('i18n: idioma de la interfaz', () => {
  it('cambia textos, lang y titulo, y recuerda la eleccion al recargar', () => {
    cy.visit('/', { onBeforeLoad: (win) => win.localStorage.setItem('mockia_locale', 'en') });
    cy.contains('h1', 'Stop waiting').should('be.visible');
    cy.get('html').should('have.attr', 'lang', 'en');

    languageSelect().select('zh');
    cy.contains('h1', '不必再等').should('be.visible');
    cy.get('html').should('have.attr', 'lang', 'zh-CN');
    cy.title().should('include', '模拟 API');

    cy.reload();
    cy.contains('h1', '不必再等').should('be.visible');

    languageSelect().select('es');
    cy.contains('h1', 'Deja de esperar').should('be.visible');
    cy.contains('a', 'Iniciar sesión').should('be.visible');
  });

  it('sin preferencia guardada usa el idioma del navegador', () => {
    cy.clearLocalStorage();
    cy.visit('/', {
      onBeforeLoad: (win) => {
        Object.defineProperty(win.navigator, 'languages', { value: ['es-ES', 'es'] });
      },
    });
    cy.contains('h1', 'Deja de esperar').should('be.visible');
    cy.get('html').should('have.attr', 'lang', 'es');
  });

  it('las paginas legales avisan de que el texto solo esta en ingles', () => {
    cy.visit('/terms', { onBeforeLoad: (win) => win.localStorage.setItem('mockia_locale', 'zh') });
    cy.get('[role="note"]').should('contain.text', '仅提供英文版本');
    cy.get('article[lang="en"]').should('exist');
  });
});
