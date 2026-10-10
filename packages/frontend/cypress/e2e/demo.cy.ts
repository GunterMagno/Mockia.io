import { solvePow } from '../../src/workers/pow';

// La UI elige idioma segun el navegador: estos tests fijan ingles (tambien en los hooks before); los de es/zh cambian `uiLocale`
type Lang = 'en' | 'es' | 'zh';
let uiLocale: Lang = 'en';
Cypress.on('window:before:load', (win) => win.localStorage.setItem('mockia_locale', uiLocale));

const MAX_CHARS = 6000;
const DEMO_ID = 'a1b2c3d4e5f6';

const envelope = <T>(data: T) => ({ success: true, data, timestamp: new Date().toISOString() });
const failure = (code: string, message: string) => ({ success: false, error: { code, message }, timestamp: new Date().toISOString() });

const leadingZeroBits = async (text: string): Promise<number> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let zeros = 0;
  for (const byte of digest) {
    if (byte === 0) {
      zeros += 8;
      continue;
    }
    return zeros + Math.clz32(byte) - 24;
  }
  return zeros;
};

const generated = (overrides: Record<string, unknown> = {}) =>
  envelope({
    demoId: DEMO_ID,
    baseUrl: `http://localhost:5173/api/demo-mock/${DEMO_ID}`,
    endpoints: [
      { method: 'GET', path: '/products', statusCode: 200, body: { items: [{ id: 1, name: 'Ceramic mug', price: 9.5 }], total: 1 } },
      { method: 'GET', path: '/products/:id', statusCode: 200, body: { id: 1, name: 'Ceramic mug', price: 9.5 } },
      { method: 'POST', path: '/orders', statusCode: 201, body: { id: 77, status: 'created' } },
    ],
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    remainingToday: 1,
    ...overrides,
  });

describe('Demo publica: probar Mockia sin registrarse', () => {
  const stubStatus = (body: Record<string, unknown> = {}, statusCode = 200) =>
    cy.intercept('GET', '**/api/demo/status', { statusCode, body: envelope({ available: true, remainingToday: 2, maxEndpoints: 5, ttlMinutes: 30, ...body }) }).as('status');
  const stubChallenge = (bits = 6) =>
    cy
      .intercept('POST', '**/api/demo/challenge', {
        body: envelope({ challenge: 'cGF5bG9hZA.c2lnbmF0dXJl', bits, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() }),
      })
      .as('challenge');
  const stubGenerate = (response: Record<string, unknown> = { statusCode: 201, body: generated() }) =>
    cy.intercept('POST', '**/api/demo/generate', response).as('generate');
  const stubMock = () =>
    cy
      .intercept('GET', `**/api/demo-mock/${DEMO_ID}/**`, {
        statusCode: 200,
        headers: { 'x-mockia-demo': 'true', 'content-type': 'application/json; charset=utf-8', 'x-total-count': '1' },
        body: { id: 1, name: 'Ceramic mug', price: 9.5 },
      })
      .as('mock');
  const stubAll = () => {
    stubStatus();
    stubChallenge();
    stubGenerate();
    stubMock();
  };
  const generateButton = () => cy.contains('button', 'Generate mock API');

  beforeEach(() => {
    cy.clearLocalStorage();
    cy.clearCookies();
  });
  afterEach(() => {
    uiLocale = 'en';
  });

  describe('prueba de trabajo (modulo del worker)', () => {
    it('encuentra un nonce que cumple los bits pedidos', () => {
      cy.wrap(null).then(async () => {
        const result = await solvePow('payload.signature', 12);
        expect(result).to.have.property('nonce');
        const nonce = (result as { nonce: string }).nonce;
        expect(nonce).to.match(/^[A-Za-z0-9_-]{1,64}$/);
        expect(await leadingZeroBits(`payload.signature:${nonce}`)).to.be.at.least(12);
      });
    });

    it('se detiene con timeout cuando no hay solucion a tiempo y con aborted si se cancela', () => {
      cy.wrap(null).then(async () => {
        expect(await solvePow('payload.signature', 60, { maxMs: 150 })).to.deep.equal({ error: 'timeout' });
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 50);
        expect(await solvePow('payload.signature', 60, { signal: controller.signal })).to.deep.equal({ error: 'aborted' });
        const already = new AbortController();
        already.abort();
        expect(await solvePow('payload.signature', 1, { signal: already.signal })).to.deep.equal({ error: 'aborted' });
      });
    });
  });

  it('(a) /demo es accesible sin sesion, no redirige a login y no envia credenciales ni se rompe con un 401', () => {
    stubChallenge();
    stubGenerate();
    stubMock();
    // Aunque el servidor contestara 401 a la demo, la pagina sigue ahi (no usa el cliente con refresco de sesion)
    cy.intercept('GET', '**/api/demo/status', { statusCode: 401, body: failure('UNAUTHORIZED', 'No session') }).as('status');
    cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: failure('UNAUTHORIZED', 'No session') });
    cy.visit('/demo');
    cy.wait('@status');
    cy.location('pathname').should('eq', '/demo');
    cy.contains('h1', 'Try Mockia without signing up').should('be.visible');
    generateButton().should('be.enabled');
    generateButton().click();
    cy.wait('@generate').then(({ request }) => {
      expect(request.headers).not.to.have.property('authorization');
      expect(request.headers['content-type']).to.match(/application\/json/);
    });
    cy.window().then((win) => {
      // La demo no usa almacenamiento propio: solo existe la preferencia de idioma de toda la app
      const keys = Object.keys(win.localStorage).filter((k) => k !== 'mockia_locale' && k !== 'mockia_cookie_notice_dismissed');
      expect(keys, 'claves de localStorage').to.deep.equal([]);
      expect(Object.keys(win.sessionStorage), 'claves de sessionStorage').to.deep.equal([]);
    });
    cy.location('pathname').should('eq', '/demo');
  });

  it('(b) plantilla -> Generar resuelve el reto, lista los endpoints y el panel Probar hace la llamada real', () => {
    stubAll();
    cy.visit('/demo');
    cy.wait('@status');
    cy.contains('Attempts left today: 2').should('be.visible');

    cy.get('input[type="radio"][value="blog"]').check({ force: true });
    generateButton().click();

    cy.wait('@generate').then(async ({ request }) => {
      expect(request.body.source).to.deep.equal({ type: 'template', id: 'blog' });
      expect(request.body.challenge).to.eq('cGF5bG9hZA.c2lnbmF0dXJl');
      expect(request.body.nonce).to.match(/^[A-Za-z0-9_-]{1,64}$/);
      // El nonce que viaja es una solucion real del reto (6 bits)
      expect(await leadingZeroBits(`${request.body.challenge}:${request.body.nonce}`)).to.be.at.least(6);
    });

    cy.get('[data-testid="demo-endpoint-list"]').within(() => {
      cy.get('li').should('have.length', 3);
      cy.contains('li', '/products/:id').should('contain.text', 'GET');
      cy.contains('li', '/orders').should('contain.text', 'POST');
    });
    cy.contains('Attempts left today: 1').should('be.visible');
    cy.contains(/Expires in \d{1,2}:\d{2}/).should('be.visible');
    cy.contains(`/api/demo-mock/${DEMO_ID}`).should('be.visible');

    // Seleccionar un endpoint con parametro: el panel pide el valor, la llamada va a la ruta real del mock efimero
    cy.get('[data-testid="demo-endpoint-list"]').contains('button', '/products/:id').click();
    cy.get('input[name="param-id"]').clear().type('42');
    cy.contains('button', 'Send request').click();
    cy.wait('@mock').then(({ request }) => {
      expect(request.url).to.match(new RegExp(`/api/demo-mock/${DEMO_ID}/products/42$`));
      expect(request.headers).not.to.have.property('authorization');
    });
    cy.get('[data-testid="demo-response"]').within(() => {
      cy.contains('200').should('be.visible');
      cy.contains('x-mockia-demo').should('be.visible');
      cy.contains('true').should('be.visible');
      cy.get('pre').should('contain.text', '"name": "Ceramic mug"');
    });
    // CTA de registro
    cy.contains('a', 'Create your free account').should('have.attr', 'href', '/signup');
  });

  it('(b2) texto propio: viaja como {type:text}; el reto invalido se reintenta UNA vez con un reto nuevo', () => {
    stubStatus();
    stubMock();
    let challenges = 0;
    cy.intercept('POST', '**/api/demo/challenge', (req) => {
      challenges += 1;
      req.reply(envelope({ challenge: `payload${challenges}.sig`, bits: 4, expiresAt: new Date(Date.now() + 60000).toISOString() }));
    }).as('challenge');
    let attempts = 0;
    cy.intercept('POST', '**/api/demo/generate', (req) => {
      attempts += 1;
      if (attempts === 1) req.reply({ statusCode: 400, body: failure('DEMO_CHALLENGE_INVALID', 'The challenge is not valid') });
      else req.reply({ statusCode: 201, body: generated() });
    }).as('generate');

    cy.visit('/demo');
    cy.get('input[type="radio"][value="text"]').check({ force: true });
    cy.get('textarea').type('type User = { id: string }', { delay: 0, parseSpecialCharSequences: false });
    generateButton().click();
    cy.wait('@generate').its('request.body').should('deep.include', { challenge: 'payload1.sig', source: { type: 'text', text: 'type User = { id: string }' } });
    cy.wait('@generate').its('request.body.challenge').should('eq', 'payload2.sig');
    cy.get('[data-testid="demo-endpoint-list"] li').should('have.length', 3);
  });

  it('(b3) dos retos invalidos seguidos: error generico, solo dos envios', () => {
    stubStatus();
    stubChallenge(4);
    cy.intercept('POST', '**/api/demo/generate', { statusCode: 400, body: failure('DEMO_CHALLENGE_INVALID', 'The challenge is not valid') }).as('generate');
    cy.visit('/demo');
    generateButton().click();
    cy.contains('[role="alert"]', 'Something went wrong').should('be.visible');
    cy.get('@generate.all').should('have.length', 2);
    generateButton().should('be.enabled');
  });

  it('(c) el reto se resuelve en un Web Worker: la barra responde, "Cancelar" aborta y no se envia nada', () => {
    stubStatus();
    stubChallenge(40); // imposible de resolver en este test: solo termina si se cancela
    stubGenerate();
    cy.visit('/demo', {
      onBeforeLoad(win) {
        const NativeWorker = win.Worker;
        (win as unknown as { __workers: number }).__workers = 0;
        win.Worker = class extends NativeWorker {
          constructor(...args: ConstructorParameters<typeof Worker>) {
            super(...args);
            (win as unknown as { __workers: number }).__workers += 1;
          }
        };
      },
    });
    generateButton().click();
    cy.get('[role="progressbar"]').should('be.visible').and('not.have.attr', 'aria-valuenow');
    cy.get('[aria-live="polite"]').should('contain.text', 'proof of work');
    cy.window().its('__workers').should('eq', 1);
    // Mientras el worker trabaja, el hilo principal sigue vivo: el boton de cancelar atiende el clic enseguida
    cy.contains('button', 'Cancel').should('be.enabled').click();
    cy.get('[role="progressbar"]').should('not.exist');
    generateButton().should('be.enabled');
    cy.contains('Cancelled').should('be.visible');
    cy.wait(300);
    cy.get('@generate.all').should('have.length', 0);
  });

  it('(d) 503 DEMO_UNAVAILABLE: mensaje claro con enlace a registrarse y sin errores en consola', () => {
    stubStatus();
    stubChallenge(4);
    stubGenerate({ statusCode: 503, headers: { 'retry-after': '10' }, body: failure('DEMO_UNAVAILABLE', 'The public demo is not available right now') });
    cy.visit('/demo', {
      onBeforeLoad(win) {
        cy.spy(win.console, 'error').as('consoleError');
      },
    });
    generateButton().click();
    cy.wait('@generate');
    cy.get('[role="alert"]').within(() => {
      cy.contains('not available right now').should('be.visible');
      cy.contains('a', 'Create your free account').should('have.attr', 'href', '/signup');
    });
    generateButton().should('be.enabled'); // si solo estaba ocupada, se puede reintentar (con un reto nuevo)
    cy.get('@consoleError').should('not.have.been.called');
  });

  it('(d2) si el estado dice que la demo no esta disponible, se explica y no se puede generar', () => {
    stubStatus({ available: false, remainingToday: null });
    cy.visit('/demo');
    cy.wait('@status');
    cy.contains('[role="alert"]', 'not available right now').should('be.visible');
    generateButton().should('be.disabled');
    cy.contains('a', 'Create your free account').should('have.attr', 'href', '/signup');
  });

  it('(e) 429 DEMO_LIMIT_REACHED: muestra a que hora vuelve el cupo (Retry-After); DEMO_RATE_LIMIT es otro aviso', () => {
    const now = Date.UTC(2026, 9, 9, 10, 0, 0);
    cy.clock(now, ['Date']);
    stubStatus();
    stubChallenge(4);
    stubGenerate({ statusCode: 429, headers: { 'retry-after': '7200' }, body: failure('DEMO_LIMIT_REACHED', 'Daily limit reached') });
    cy.visit('/demo');
    generateButton().click();
    cy.wait('@generate');
    const back = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(now + 7200 * 1000));
    cy.contains('[role="alert"]', "today's attempts").should('contain.text', back);
    cy.contains('[role="alert"] a', 'Create your free account').should('have.attr', 'href', '/signup');
    generateButton().should('be.disabled');

    // Demasiadas peticiones: esperar un momento, no es el cupo diario
    cy.intercept('POST', '**/api/demo/challenge', { statusCode: 429, headers: { 'retry-after': '120' }, body: failure('DEMO_RATE_LIMIT', 'Too many') });
    cy.visit('/demo');
    generateButton().click();
    cy.contains('[role="alert"]', 'Too many requests').should('be.visible').and('not.contain.text', "today's attempts");
    generateButton().should('be.enabled');
  });

  it('(e2) sin intentos hoy (remainingToday 0): avisa antes de pulsar y 502 explica que el intento cuenta', () => {
    stubStatus({ remainingToday: 0 });
    cy.visit('/demo');
    cy.wait('@status');
    cy.contains("today's attempts").should('be.visible');
    generateButton().should('be.disabled');

    stubStatus();
    stubChallenge(4);
    stubGenerate({ statusCode: 502, body: failure('EXTERNAL_SERVICE_ERROR', 'The AI returned something unusable') });
    cy.visit('/demo');
    generateButton().click();
    cy.contains('[role="alert"]', 'counted').should('be.visible');
  });

  it('(f) un texto de mas de 6000 caracteres bloquea el envio con un mensaje accesible', () => {
    stubAll();
    cy.visit('/demo');
    cy.get('input[type="radio"][value="text"]').check({ force: true });
    const setText = (text: string) =>
      cy.get('textarea').then(($el) => {
        const el = $el[0] as HTMLTextAreaElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
        setter.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });

    generateButton().should('be.disabled'); // vacio
    setText('x'.repeat(MAX_CHARS));
    generateButton().should('be.enabled');
    cy.get('textarea').should('have.attr', 'aria-invalid', 'false');

    setText('x'.repeat(MAX_CHARS + 1));
    generateButton().should('be.disabled');
    cy.get('textarea')
      .should('have.attr', 'aria-invalid', 'true')
      .invoke('attr', 'aria-describedby')
      .then((ids) => {
        const described = ids!.split(' ').map((id) => Cypress.$(`#${id}`).text()).join(' ');
        expect(described).to.contain('6,001').and.to.contain('6,000');
      });
    cy.get('[role="alert"]').should('contain.text', 'too long');
    cy.get('@generate.all').should('have.length', 0);
  });

  it('(g) a 375 px no desborda y todo el flujo se maneja con el teclado', () => {
    stubAll();
    cy.viewport(375, 812);
    cy.visit('/demo');
    cy.wait('@status');
    const noOverflow = () => cy.document().then((doc) => expect(doc.documentElement.scrollWidth).to.be.at.most(375));
    noOverflow();

    // Teclado: las plantillas son radios nativos; Tab sale del grupo directo al boton (la activacion con Enter/Espacio
    // de un boton nativo es del navegador, que Cypress no emula)
    cy.get('input[type="radio"][value="blog"]').check({ force: true }).focus();
    cy.press(Cypress.Keyboard.Keys.TAB);
    cy.focused().should('contain.text', 'Generate mock API').click();
    cy.wait('@generate').its('request.body.source').should('deep.equal', { type: 'template', id: 'blog' });

    // Con el resultado, el orden de tabulacion recorre los endpoints, "Enviar" y el enlace de registro; nada tiene tabindex negativo
    cy.get('[data-testid="demo-endpoint-list"] li').should('have.length', 3);
    noOverflow();
    cy.get('main [tabindex="-1"]').should('not.exist');
    cy.contains('button', 'Generate mock API').focus();
    for (const expected of ['/products', '/products/:id', '/orders', 'Send request', 'Create your free account']) {
      cy.press(Cypress.Keyboard.Keys.TAB);
      cy.focused().should('contain.text', expected);
    }
    cy.get('[data-testid="demo-endpoint-list"]').contains('button', '/products/:id').click();
    cy.contains('button', 'Send request').click();
    cy.get('[data-testid="demo-response"] pre').should('contain.text', 'Ceramic mug').and('have.attr', 'tabindex', '0');
    noOverflow();
    // Nada dentro de la pagina se sale de la pantalla
    cy.get('[data-testid="demo-page"] *').each(($el) => {
      const rect = $el[0].getBoundingClientRect();
      if (rect.width === 0) return;
      expect(rect.right, `${$el[0].tagName}.${$el[0].className}`).to.be.at.most(376);
    });
  });

  it('(g2) 768 y 1440 px sin desbordes con el resultado a la vista', () => {
    stubAll();
    for (const [width, height] of [[768, 1024], [1440, 900]]) {
      cy.viewport(width, height);
      cy.visit('/demo');
      generateButton().click();
      cy.get('[data-testid="demo-endpoint-list"] li').should('have.length', 3);
      cy.document().then((doc) => expect(doc.documentElement.scrollWidth, `ancho ${width}`).to.be.at.most(width));
    }
  });

  it('(h) los textos estan en espanol', () => {
    stubAll();
    cy.then(() => {
      uiLocale = 'es';
    });
    cy.visit('/demo');
    cy.contains('h1', 'Prueba Mockia sin registrarte').should('be.visible');
    cy.contains('button', 'Generar API mock').should('be.visible');
    cy.contains('Intentos restantes hoy: 2').should('be.visible');
    cy.contains('button', 'Generar API mock').click();
    cy.contains('Caduca en').should('be.visible');
    cy.contains('a', 'Crea tu cuenta gratis').should('have.attr', 'href', '/signup');
  });

  it('(h2) los textos estan en chino', () => {
    stubAll();
    cy.then(() => {
      uiLocale = 'zh';
    });
    cy.visit('/demo');
    cy.get('main h1').invoke('text').should('match', /[一-鿿]/);
    cy.get('main').invoke('text').should('not.contain', 'Try Mockia');
    cy.get('main button[type="button"]').first().invoke('text').should('match', /[一-鿿]/);
    cy.get('main button[type="button"]').first().click();
    cy.contains(/\d+:\d{2} 后过期/).should('be.visible');
  });

  it('(i) el enlace "Probar gratis" de la cabecera y el boton de la landing llevan a /demo', () => {
    stubStatus();
    cy.visit('/');
    cy.get('header').contains('a', 'Try for free').should('have.attr', 'href', '/demo').click();
    cy.location('pathname').should('eq', '/demo');

    cy.visit('/');
    cy.get('#hero-title').parents('section').first().within(() => {
      cy.contains('a', 'Try without signing up').should('have.attr', 'href', '/demo').click();
    });
    cy.location('pathname').should('eq', '/demo');
  });
});
