// Documentos legales: Aviso Legal (LSSI), Privacidad (RGPD art. 13), Terminos y Cookies, en los tres idiomas.
// El idioma se fuerza con la preferencia guardada, como en el resto de specs.
type Lang = 'es' | 'en' | 'zh';

const PAGES = ['/legal', '/privacy', '/terms', '/cookies'] as const;

const visitIn = (path: string, lang: Lang) =>
  cy.visit(path, { onBeforeLoad: (win) => win.localStorage.setItem('mockia_locale', lang) });

const HTML_LANG: Record<Lang, string> = { es: 'es', en: 'en', zh: 'zh-CN' };

describe('Legal: las cuatro paginas existen y estan completas', () => {
  for (const lang of ['es', 'en', 'zh'] as Lang[]) {
    for (const path of PAGES) {
      it(`${path} (${lang}): h1, fecha de actualizacion y sin la afirmacion falsa de cifrado`, () => {
        visitIn(path, lang);
        cy.location('pathname').should('eq', path);
        cy.get('article[data-legal]').should('have.attr', 'lang', HTML_LANG[lang]);
        cy.get('article h1').should('have.length', 1).and('not.be.empty');
        cy.get('[data-legal-updated]').should('contain.text', '2026');
        cy.get('article').invoke('text').should('not.match', /encrypted at rest/i);
        // el aviso "solo en ingles" ya no existe
        cy.get('[role="note"]').should('not.exist');
      });
    }
  }
});

describe('Legal: contenido segun el idioma', () => {
  it('en espanol los textos estan en espanol y sin el aviso de "solo ingles"', () => {
    for (const path of PAGES) {
      visitIn(path, 'es');
      cy.get('article h1').invoke('text').should('match', /Aviso Legal|Política de Privacidad|Términos|Cookies/);
      cy.get('article').invoke('text').should('not.match', /solo está disponible en inglés|available in English only/i);
    }
    visitIn('/privacy', 'es');
    cy.contains('article h2', /derechos/i).should('exist');
    cy.get('a[href="https://www.aepd.es"]').should('exist');
  });

  it('en chino renderiza texto no latino en todas las paginas', () => {
    for (const path of PAGES) {
      visitIn(path, 'zh');
      cy.get('article h1').invoke('text').should('match', /[一-鿿]/);
      cy.get('article').invoke('text').should('match', /[一-鿿]{20,}/);
    }
  });

  it('Privacidad y Terminos recogen los pagos con Stripe', () => {
    for (const lang of ['es', 'en', 'zh'] as Lang[]) {
      for (const path of ['/privacy', '/terms']) {
        visitIn(path, lang);
        cy.get('article').should('contain.text', 'Stripe');
      }
    }
  });

  it('Cookies lista la cookie de sesion mockia_rt y la clave de idioma que usa la app', () => {
    for (const lang of ['es', 'en', 'zh'] as Lang[]) {
      visitIn('/cookies', lang);
      cy.get('article').should('contain.text', 'mockia_rt').and('contain.text', 'mockia_locale');
    }
  });

  it('Privacidad dice que no se almacenan tokens de GitHub (se clonan repositorios publicos)', () => {
    visitIn('/privacy', 'en');
    cy.get('article').invoke('text').should('match', /public repositor/i);
  });

  it('mientras falten los datos del titular se ven marcadores visibles y el aviso de borrador', () => {
    visitIn('/legal', 'es');
    cy.get('[data-legal-draft]').should('be.visible').and('contain.text', 'Borrador pendiente de revisión jurídica');
    cy.get('[data-legal-placeholder]').should('have.length.at.least', 1).first().should('contain.text', 'pendiente');
    visitIn('/legal', 'en');
    cy.get('[data-legal-draft]').should('contain.text', 'Draft pending legal review');
  });
});

describe('Legal: enlaces desde el footer y el registro', () => {
  it('el footer enlaza a los cuatro documentos', () => {
    visitIn('/', 'es');
    for (const path of PAGES) {
      cy.get('footer a[href="' + path + '"]').should('have.length', 1);
    }
    cy.get('footer a[href="/cookies"]').click();
    cy.location('pathname').should('eq', '/cookies');
    cy.get('article h1').should('contain.text', 'Cookies');
  });

  it('el registro avisa de que se aceptan Terminos y Privacidad, sin casilla bloqueante', () => {
    visitIn('/signup', 'es');
    cy.get('[data-signup-legal]')
      .should('contain.text', 'Al registrarte aceptas')
      .within(() => {
        cy.get('a[href="/terms"]').should('exist');
        cy.get('a[href="/privacy"]').should('exist');
      });
    // sin casilla bloqueante (la de "Recordarme" no es de aceptacion)
    cy.get('form input[type="checkbox"][required]').should('not.exist');
    visitIn('/signup', 'en');
    cy.get('[data-signup-legal]').should('contain.text', 'By signing up you accept');
    visitIn('/signup', 'zh');
    cy.get('[data-signup-legal]').invoke('text').should('match', /[一-鿿]/);
  });
});

describe('Legal: la web no carga recursos de terceros que los textos no mencionen', () => {
  it('la animacion "como funciona" se sirve con GSAP propio y sin Google Fonts ni CDNs', () => {
    cy.request('/como-funciona/index.html').its('body').then((html: string) => {
      expect(html).to.not.match(/fonts\.googleapis|fonts\.gstatic|cdnjs|jsdelivr|unpkg/i);
      expect(html).to.include('vendor/gsap.min.js');
    });
    cy.request('/como-funciona/vendor/gsap.min.js').its('body').should('include', 'GSAP 3.15.0');
  });

  it('Privacidad y Cookies ya no citan Google Fonts', () => {
    for (const lang of ['es', 'en', 'zh'] as Lang[]) {
      for (const path of ['/privacy', '/cookies']) {
        visitIn(path, lang);
        cy.get('article').invoke('text').should('not.match', /google/i);
      }
    }
  });
});
