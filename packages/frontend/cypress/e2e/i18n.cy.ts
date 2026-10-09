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

  it('las paginas legales se traducen al idioma activo (el detalle esta en legal.cy.ts)', () => {
    cy.visit('/terms', { onBeforeLoad: (win) => win.localStorage.setItem('mockia_locale', 'zh') });
    cy.contains('article h1', '服务条款').should('be.visible');
    cy.get('article[lang="zh-CN"]').should('exist');
    cy.get('[role="note"]').should('not.exist');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Idioma guardado en la cuenta, selector en las paginas de auth y estetica morada del heroe
// ---------------------------------------------------------------------------------------------------------------

const PASSWORD = 'Locale-pass-123';
let counter = 0;
const uniqueEmail = (prefix: string) => `${prefix}${Date.now()}${counter++}@example.com`;

/** Crea una cuenta por API; con `locale` la deja guardada en el servidor. Sin cookies al terminar: el test inicia sesion por la UI. */
const createAccount = (email: string, locale?: 'en' | 'es' | 'zh') => {
  cy.request('POST', '/api/auth/register', { email, password: PASSWORD, username: email.split('@')[0] });
  if (locale) {
    cy.request('POST', '/api/auth/login', { email, password: PASSWORD }).then((res) => {
      cy.request({
        method: 'PATCH',
        url: '/api/users/me/preferences',
        headers: { Authorization: `Bearer ${res.body.data.tokens.accessToken}` },
        body: { locale },
      });
    });
  }
  cy.clearCookies();
};

/** Visita una ruta con el navegador en `browserLocale` (localStorage vacio salvo que se pida otra cosa). */
const visitAs = (path: string, browserLocale: string, saved?: string) =>
  cy.visit(path, {
    onBeforeLoad: (win) => {
      Object.defineProperty(win.navigator, 'languages', { value: [browserLocale] });
      if (saved) win.localStorage.setItem('mockia_locale', saved);
    },
  });

const uiLogin = (email: string) => {
  cy.get('input[name="email"]').type(email);
  cy.get('input[name="password"]').type(PASSWORD, { log: false });
  cy.get('form button[type="submit"]').click();
};

describe('i18n: idioma guardado por usuario', () => {
  beforeEach(() => {
    cy.clearCookies();
    cy.clearLocalStorage();
  });

  it('un usuario con idioma guardado (es) entra con el navegador en ingles y ve la UI en espanol', () => {
    const email = uniqueEmail('saved-es');
    createAccount(email, 'es');

    visitAs('/login', 'en-US', 'en');
    cy.contains('h1', 'Log in').should('be.visible');
    uiLogin(email);

    cy.location('pathname').should('eq', '/dashboard');
    cy.get('html').should('have.attr', 'lang', 'es');
    cy.window().its('localStorage').invoke('getItem', 'mockia_locale').should('eq', 'es');

    // Tambien al recuperar la sesion al recargar (la cookie de refresh trae el usuario con su idioma)
    cy.window().then((win) => win.localStorage.setItem('mockia_locale', 'en'));
    cy.reload();
    cy.get('html').should('have.attr', 'lang', 'es');
    cy.visit('/');
    cy.contains('h1', 'Deja de esperar').should('be.visible');
  });

  it('cambiar a zh con sesion iniciada guarda el idioma en el servidor y sobrevive a borrar el almacenamiento', () => {
    const email = uniqueEmail('switch-zh');
    createAccount(email, 'en');
    cy.intercept('PATCH', '/api/users/me/preferences').as('savePreference');

    visitAs('/login', 'en-US', 'en');
    uiLogin(email);
    cy.location('pathname').should('eq', '/dashboard');

    languageSelect().select('zh');
    cy.wait('@savePreference').then(({ request, response }) => {
      expect(request.body).to.deep.equal({ locale: 'zh' });
      expect(response?.statusCode).to.eq(200);
    });
    cy.get('html').should('have.attr', 'lang', 'zh-CN');

    cy.reload();
    cy.get('html').should('have.attr', 'lang', 'zh-CN');

    // Sin preferencia en el navegador gana la del servidor
    cy.clearLocalStorage();
    cy.reload();
    cy.get('html').should('have.attr', 'lang', 'zh-CN');
  });

  it('una cuenta sin idioma guardado envia el actual una sola vez al iniciar sesion', () => {
    const email = uniqueEmail('legacy');
    createAccount(email);
    cy.intercept('PATCH', '/api/users/me/preferences').as('savePreference');

    visitAs('/login', 'es-ES');
    cy.contains('h1', 'Iniciar sesión').should('be.visible');
    uiLogin(email);

    cy.wait('@savePreference').its('request.body').should('deep.equal', { locale: 'es' });
    cy.location('pathname').should('eq', '/dashboard');
    cy.get('@savePreference.all').should('have.length', 1);
    cy.get('html').should('have.attr', 'lang', 'es');
  });

  it('sin sesion cambiar de idioma no llama al servidor', () => {
    cy.intercept('PATCH', '/api/users/me/preferences', cy.spy().as('anyPatch'));
    visitAs('/', 'en-US', 'en');
    languageSelect().select('es');
    cy.contains('h1', 'Deja de esperar').should('be.visible');
    cy.get('@anyPatch').should('not.have.been.called');
  });

  it('si el servidor no responde al guardar, la interfaz sigue funcionando sin errores visibles', () => {
    const email = uniqueEmail('offline');
    createAccount(email, 'en');
    visitAs('/login', 'en-US', 'en');
    uiLogin(email);
    cy.location('pathname').should('eq', '/dashboard');

    cy.intercept('PATCH', '/api/users/me/preferences', { forceNetworkError: true }).as('failingSave');
    languageSelect().select('es');
    cy.wait('@failingSave');
    cy.get('html').should('have.attr', 'lang', 'es');
    cy.get('[role="alert"]').should('not.exist');
    languageSelect().should('not.be.disabled');
  });
});

describe('i18n: selector de idioma en las paginas de auth', () => {
  const viewports = [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ];

  const rectOf = ($el: JQuery<HTMLElement>) => $el[0].getBoundingClientRect();
  const intersects = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  beforeEach(() => {
    cy.clearCookies();
    cy.clearLocalStorage();
  });

  for (const path of ['/login', '/signup']) {
    for (const { width, height } of viewports) {
      it(`${path} a ${width}px: selector visible, dentro del viewport y sin solapar logo ni formulario`, () => {
        cy.viewport(width, height);
        visitAs(path, 'en-US', 'en');

        languageSelect().should('be.visible').then(($select) => {
          const select = rectOf($select);
          expect(select.left, 'left').to.be.at.least(0);
          expect(select.top, 'top').to.be.at.least(0);
          expect(select.right, 'right').to.be.at.most(width);
          expect(select.width, 'ancho legible').to.be.at.least(100);
          expect(select.height, 'objetivo tactil').to.be.at.least(40);

          cy.get('header a[href="/"]').should('be.visible').then(($logo) => {
            expect(intersects(select, rectOf($logo)), 'solapa el logo').to.eq(false);
          });
          cy.get('main form').first().then(($form) => {
            expect(intersects(select, rectOf($form)), 'solapa el formulario').to.eq(false);
          });
        });

        // Sin desbordamiento horizontal de la pagina
        cy.document().then((doc) => {
          expect(doc.documentElement.scrollWidth).to.be.at.most(width);
        });

        // Cambiar el idioma desde aqui funciona y no mueve el selector fuera de la pantalla
        languageSelect().select('es');
        cy.get('html').should('have.attr', 'lang', 'es');
        languageSelect().should('be.visible').then(($select) => {
          expect(rectOf($select).right).to.be.at.most(width);
        });
      });
    }
  }
});

describe('Estetica morada del heroe', () => {
  const PURPLE_TEXT = 'rgb(165, 180, 252)'; // --color-accent-text
  const PURPLE_SOLID = 'rgb(79, 70, 229)'; // --color-accent-solid

  beforeEach(() => {
    cy.clearCookies();
    cy.clearLocalStorage();
  });

  it('la palabra Backend del titulo usa el acento morado', () => {
    visitAs('/', 'en-US', 'en');
    cy.get('#hero-title em').should('have.text', 'Backend.').and('have.css', 'color', PURPLE_TEXT);
  });

  it('el boton principal del heroe con sesion iniciada (Go to dashboard) es morado con texto blanco', () => {
    const email = uniqueEmail('hero');
    createAccount(email);
    visitAs('/login', 'en-US', 'en');
    uiLogin(email);
    cy.location('pathname').should('eq', '/dashboard');

    cy.visit('/');
    cy.contains('main button', 'Go to dashboard')
      .should('be.visible')
      .and('have.css', 'background-color', PURPLE_SOLID)
      .and('have.css', 'color', 'rgb(255, 255, 255)');
    cy.get('#hero-title em').should('have.css', 'color', PURPLE_TEXT);
  });

  it('el boton principal del heroe sin sesion (Start for free) tambien es morado', () => {
    visitAs('/', 'en-US', 'en');
    cy.get('nav[aria-label] button').first().should('have.css', 'background-color', PURPLE_SOLID);
  });

  it('el boton Sign up de la cabecera sin sesion es morado con texto blanco (ya no queda ningun CTA verde)', () => {
    visitAs('/', 'en-US', 'en');
    cy.contains('header a', 'Sign up')
      .should('be.visible')
      .and('have.css', 'background-color', PURPLE_SOLID)
      .and('have.css', 'color', 'rgb(255, 255, 255)');
  });
});

// The "how it works" iframe is lazy: a language change made before it loads used to be posted to an empty frame and lost,
// leaving the animation in the first language. The page re-sends the language when the iframe finishes loading.
describe('i18n: la animacion "como funciona" sigue el idioma aunque se cambie antes de que cargue', () => {
  it('cambiar a espanol antes de que cargue el iframe lo deja en espanol', () => {
    // The animation document arrives late (a slow network, or the lazy iframe not loaded yet)
    cy.intercept({ method: 'GET', pathname: '/como-funciona/index.html' }, (req) => {
      req.on('response', (res) => {
        res.setDelay(2500);
      });
    });
    cy.visit('/', { onBeforeLoad: (win) => win.localStorage.setItem('mockia_locale', 'en') });
    cy.contains('h1', 'Stop waiting').should('be.visible');
    languageSelect().select('es');
    cy.contains('h1', 'Deja de esperar').should('be.visible');
    cy.get('#how-title').scrollIntoView();
    cy.get('section[aria-labelledby="how-title"] iframe', { timeout: 15000 }).should(($frame) => {
      const doc = ($frame[0] as HTMLIFrameElement).contentDocument!;
      expect(doc.URL, 'the animation document has loaded').to.include('/como-funciona/index.html');
      expect(doc.documentElement.lang).to.eq('es');
    });
  });
});
