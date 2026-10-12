import type { AdminMetrics } from '@mockia/shared';

// Panel del titular (/admin). La API se intercepta entera (sesion incluida): no hace falta backend ni cuenta real.
type Lang = 'en' | 'es' | 'zh';
let uiLocale: Lang = 'en';
Cypress.on('window:before:load', (win) => win.localStorage.setItem('mockia_locale', uiLocale));

/** Los tres graficos del panel (el resto de la pagina tambien tiene <figure> decorativos). */
const CHARTS = '[data-testid="admin-charts"] figure';

const DAY_MS = 86_400_000;
const LAST_DAY = Date.UTC(2026, 9, 12); // 2026-10-12

const dayKeys = (days: number) =>
  Array.from({ length: days }, (_, i) =>
    new Date(LAST_DAY - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10)
  );

/** Cifras conocidas: 10 llamadas de IA por dia (6 users, 3 demo, 1 byok) con 1 error; 2 + (indice % 3) altas por dia. */
const metricsFor = (days: number, extra: Partial<AdminMetrics['ai']> = {}): AdminMetrics => {
  const keys = dayKeys(days);
  return {
    generatedAt: '2026-10-12T10:00:00.000Z',
    days,
    users: {
      total: 1234,
      verified: 900,
      byPlan: { free: 1100, starter: 80, pro: 40, team: 14 },
      newPerDay: keys.map((day, i) => ({ day, count: 2 + (i % 3) })),
    },
    funnel: { registered: 400, verified: 320, withProject: 200, withAiGeneration: 100 },
    billing: { paying: { starter: 3, pro: 2, team: 1 }, mrrUsdEstimate: 172.42 },
    ai: {
      perDay: keys.map((day) => ({
        day,
        calls: 10,
        errors: 1,
        byScope: { users: 6, demo: 3, byok: 1 },
      })),
      tokens: { input: 1_200_000, output: 340_000 },
      errorRatio: 0.1,
      estimatedCostUsd: 12.34,
      unpriced: [],
      ...extra,
    },
    demo: { generationsPerDay: keys.map((day, i) => ({ day, count: i % 4 })) },
  };
};

const envelope = (data: unknown) => ({
  success: true,
  data,
  timestamp: '2026-10-12T10:00:00.000Z',
});

/** Sesion falsa: el refresh devuelve un usuario, asi ProtectedRoute deja pasar sin tocar el backend real. */
const stubSession = () => {
  cy.intercept('POST', '/api/auth/refresh', {
    statusCode: 200,
    body: envelope({
      accessToken: 'e2e-access-token',
      user: {
        id: 'owner-1',
        email: 'owner@example.com',
        username: 'Owner',
        emailVerifiedAt: '2026-01-01T00:00:00.000Z',
      },
    }),
  });
  cy.intercept('GET', '/api/notifications*', { statusCode: 200, body: envelope([]) });
  cy.intercept('GET', '/api/demo/availability*', { statusCode: 200, body: envelope({}) });
  cy.intercept('GET', '/api/users/profile', {
    statusCode: 200,
    body: { email: 'owner@example.com', username: 'Owner' },
  });
};

/** Administrador con metricas; responde con la ventana pedida en `?days=`. */
const stubAdmin = (extra: Partial<AdminMetrics['ai']> = {}) => {
  cy.intercept('GET', '/api/admin/me', { statusCode: 200, body: envelope({ isAdmin: true }) }).as(
    'me'
  );
  cy.intercept('GET', '/api/admin/metrics*', (req) => {
    const days = Number(new URL(req.url).searchParams.get('days') ?? 30);
    req.reply({ statusCode: 200, body: envelope(metricsFor(days, extra)) });
  }).as('metrics');
};

describe('Panel del titular /admin', () => {
  afterEach(() => {
    uiLocale = 'en';
  });

  it('un administrador ve tarjetas, graficos y embudo con las cifras de la API, y el selector reenvia days', () => {
    stubSession();
    stubAdmin();
    cy.visit('/admin');

    cy.wait('@metrics').its('request.url').should('include', 'days=30');
    cy.contains('h1', 'Owner panel').should('be.visible');

    cy.get('[data-testid="stat-users"]').should('contain.text', '1,234').and('contain.text', '900');
    cy.get('[data-testid="stat-paying"]').should('contain.text', '6');
    cy.get('[data-testid="stat-mrr"]')
      .should('contain.text', '$172.42')
      .and('contain.text', 'estimate, check Stripe');
    cy.get('[data-testid="stat-ai-calls"]').should('contain.text', '300');
    cy.get('[data-testid="stat-error-rate"]').should('contain.text', '10%');
    cy.get('[data-testid="stat-cost"]').should('contain.text', '$12.34');

    // Embudo: cada paso con su cifra y el porcentaje sobre los registrados
    cy.get('[data-testid="funnel"]').within(() => {
      cy.contains('li', 'Registered').should('contain.text', '400');
      cy.contains('li', 'Created a project')
        .should('contain.text', '200')
        .and('contain.text', '50%');
      cy.contains('li', 'Generated with AI')
        .should('contain.text', '100')
        .and('contain.text', '25%');
    });

    cy.get(`${CHARTS} svg[role="img"]`).should('have.length', 3);

    cy.contains('button', 'Last 30 days').should('have.attr', 'aria-pressed', 'true');
    cy.contains('button', 'Last 7 days').click();
    cy.wait('@metrics').its('request.url').should('include', 'days=7');
    cy.contains('button', 'Last 7 days').should('have.attr', 'aria-pressed', 'true');
    cy.get('[data-testid="stat-ai-calls"]').should('contain.text', '70');

    cy.contains('button', 'Last 90 days').click();
    cy.wait('@metrics').its('request.url').should('include', 'days=90');
    cy.get('[data-testid="stat-ai-calls"]').should('contain.text', '900');
  });

  it('un usuario que no es administrador ve la 404 y nunca se piden las metricas', () => {
    stubSession();
    cy.intercept('GET', '/api/admin/me', { statusCode: 200, body: envelope({ isAdmin: false }) });
    cy.intercept('GET', '/api/admin/metrics*', {
      statusCode: 200,
      body: envelope(metricsFor(30)),
    }).as('metrics');
    cy.visit('/admin');

    cy.contains('h1', '404').should('be.visible');
    cy.contains('Lost in the').should('be.visible');
    cy.contains('Owner panel').should('not.exist');
    cy.get('@metrics.all').should('have.length', 0);

    // Tampoco hay enlace en el menu de usuario
    cy.get('[aria-label="Profile"]').first().click({ force: true });
    cy.get('a[href="/billing"]').should('exist'); // el menu se abrio y esta cargado
    cy.get('a[href="/admin"]').should('not.exist');
  });

  it('el menu de usuario muestra el enlace al panel solo al administrador', () => {
    stubSession();
    stubAdmin();
    cy.visit('/billing', {
      onBeforeLoad: (win) => win.localStorage.setItem('mockia_locale', 'en'),
    });
    cy.get('[aria-label="Profile"]').first().click({ force: true });
    cy.get('a[href="/admin"]').should('be.visible').and('contain.text', 'Owner panel').click();
    cy.location('pathname').should('eq', '/admin');
    cy.contains('h1', 'Owner panel').should('be.visible');
  });

  it('sin AI_PRICES_JSON el coste dice "sin precios configurados"; con modelos sin precio los lista', () => {
    stubSession();
    stubAdmin({ estimatedCostUsd: null, unpriced: [] });
    cy.visit('/admin');
    cy.wait('@metrics');
    cy.get('[data-testid="stat-cost"]').should('contain.text', 'No prices configured');
    cy.get('[data-testid="stat-cost"]').should('not.contain.text', '$');
    cy.get('[data-testid="unpriced"]').should('not.exist');
    // Los tokens se siguen mostrando aunque no haya precios
    cy.get('[data-testid="stat-cost"]').should('contain.text', '1,200,000');

    stubAdmin({ estimatedCostUsd: 8.5, unpriced: ['groq/llama-x', 'openai/gpt-new'] });
    cy.reload();
    cy.wait('@metrics');
    cy.get('[data-testid="stat-cost"]').should('contain.text', '$8.50');
    cy.get('[data-testid="unpriced"]')
      .should('contain.text', 'groq/llama-x')
      .and('contain.text', 'openai/gpt-new');
  });

  it('cada grafico tiene role="img" con aria-label y una tabla equivalente con los mismos datos', () => {
    stubSession();
    stubAdmin();
    cy.visit('/admin');
    cy.wait('@metrics');

    cy.get(CHARTS).should('have.length', 3);
    cy.get(CHARTS).each(($fig) => {
      const svg = $fig.find('svg[role="img"]');
      expect(svg, 'svg role=img').to.have.length(1);
      expect(svg.attr('aria-label'), 'aria-label').to.match(/\S{3,}/);
      expect($fig.find('table'), 'tabla').to.have.length(1);
      expect($fig.find('table caption').text(), 'caption').to.match(/\S/);
    });

    // La tabla de altas: 30 filas + cabecera, valores del fixture y fechas como texto
    cy.get(CHARTS)
      .first()
      .within(() => {
        cy.get('table tbody tr').should('have.length', 30);
        cy.get('table tbody tr').first().should('contain.text', 'Sep 13');
        cy.get('table tbody tr').last().should('contain.text', 'Oct 12');
        cy.get('table th[scope="col"]').should('have.length.at.least', 2);
      });
    // La de IA por ambito lleva una columna por serie
    cy.get(CHARTS)
      .eq(1)
      .within(() => {
        cy.get('table th[scope="col"]').should('have.length', 5); // dia + users + demo + byok + errores
        cy.get('table tbody tr').first().should('contain.text', '6').and('contain.text', '3');
      });

    // La tabla se abre con el teclado: el resumen recibe el foco y Enter la despliega
    cy.get(`${CHARTS} details summary`)
      .first()
      .then(($summary) => $summary[0].focus());
    cy.focused().should('match', 'summary');
    cy.press(Cypress.Keyboard.Keys.SPACE);
    cy.get(`${CHARTS} details`).first().should('have.attr', 'open');
    cy.get(`${CHARTS} details`).first().find('table').should('be.visible');
  });

  it('a 375 px no hay desbordes horizontales', () => {
    cy.viewport(375, 812);
    stubSession();
    stubAdmin({
      estimatedCostUsd: 8.5,
      unpriced: ['groq/a-very-long-model-name-that-keeps-going'],
    });
    cy.visit('/admin');
    cy.wait('@metrics');
    cy.get(`${CHARTS} svg[role="img"]`).should('have.length', 3);
    cy.get(`${CHARTS} svg[role="img"]`).each(($svg) => {
      expect($svg[0].getBoundingClientRect().width).to.be.at.most(375);
    });
    cy.get(`${CHARTS} details summary`).each(($s) => cy.wrap($s).click());
    cy.document().then((doc) => {
      const root = doc.documentElement;
      expect(root.scrollWidth, 'scrollWidth').to.be.at.most(root.clientWidth);
      const wide = Array.from(doc.querySelectorAll('[data-testid="admin-content"] *')).filter(
        (el) =>
          el.getBoundingClientRect().right > root.clientWidth + 1 && !el.closest('[role="region"]')
      );
      expect(wide.map((el) => el.tagName + '.' + el.className)).to.deep.equal([]);
    });
  });

  it('a 768 y 1440 px tampoco desborda', () => {
    stubSession();
    stubAdmin();
    for (const width of [768, 1440]) {
      cy.viewport(width, 900);
      cy.visit('/admin');
      cy.wait('@metrics');
      cy.get(`${CHARTS} svg[role="img"]`).should('have.length', 3);
      cy.document().then((doc) => {
        expect(doc.documentElement.scrollWidth).to.be.at.most(doc.documentElement.clientWidth);
      });
    }
  });

  it('esta en espanol y en chino con paridad de textos', () => {
    stubSession();
    stubAdmin({ estimatedCostUsd: null });
    cy.then(() => {
      uiLocale = 'es';
    });
    cy.visit('/admin');
    cy.wait('@metrics');
    cy.contains('h1', 'Panel del titular').should('be.visible');
    cy.get('[data-testid="stat-mrr"]').should('contain.text', 'estimación, consulta Stripe');
    cy.get('[data-testid="stat-cost"]').should('contain.text', 'Sin precios configurados');
    cy.contains('button', 'Últimos 7 días').should('be.visible');
    cy.get(CHARTS)
      .first()
      .find('svg')
      .should('have.attr', 'aria-label')
      .and('match', /usuarios/i);
    cy.contains('li', 'Registrados').should('be.visible');

    cy.then(() => {
      uiLocale = 'zh';
    });
    cy.visit('/admin');
    cy.wait('@metrics');
    cy.contains('h1', '站长面板').should('be.visible');
    cy.contains('button', '最近 7 天').should('be.visible');
    cy.get('[data-testid="stat-mrr"]').should('contain.text', '估算');
    cy.get(CHARTS).first().find('svg').should('have.attr', 'aria-label').and('match', /用户/);
  });

  it('si el endpoint falla (5xx) muestra un mensaje con reintento, nunca una pantalla en blanco', () => {
    stubSession();
    cy.intercept('GET', '/api/admin/me', { statusCode: 200, body: envelope({ isAdmin: true }) });
    cy.intercept('GET', '/api/admin/metrics*', {
      statusCode: 503,
      body: { success: false, error: { code: 'INTERNAL_ERROR', message: 'down' } },
    }).as('metricsFail');
    cy.visit('/admin');
    cy.wait('@metricsFail');

    cy.contains('h1', 'Owner panel').should('be.visible');
    cy.get('[role="alert"]').should('contain.text', 'Could not load the metrics');
    cy.get('[data-testid="stat-users"]').should('not.exist');

    stubAdmin();
    cy.contains('button', 'Try again').click();
    cy.wait('@metrics');
    cy.get('[role="alert"]').should('not.exist');
    cy.get('[data-testid="stat-users"]').should('contain.text', '1,234');
  });

  it('si no se puede comprobar el acceso (5xx en /admin/me) tambien hay reintento y no se piden metricas', () => {
    stubSession();
    cy.intercept('GET', '/api/admin/me', { statusCode: 500, body: {} }).as('meFail');
    cy.intercept('GET', '/api/admin/metrics*', {
      statusCode: 200,
      body: envelope(metricsFor(30)),
    }).as('metrics');
    cy.visit('/admin');
    cy.wait('@meFail');
    cy.get('[role="alert"]').should('be.visible');
    cy.get('@metrics.all').should('have.length', 0);

    stubAdmin();
    cy.contains('button', 'Try again').click();
    cy.contains('h1', 'Owner panel').should('be.visible');
    cy.get('[data-testid="stat-users"]').should('contain.text', '1,234');
  });

  it('lleva noindex mientras esta montada y lo quita al salir', () => {
    stubSession();
    stubAdmin();
    cy.visit('/admin');
    cy.wait('@metrics');
    cy.get('head meta[name="robots"][content="noindex"]').should('have.length', 1);
    cy.get('a[aria-label="Mockia home"]').first().click();
    cy.location('pathname').should('eq', '/');
    cy.get('head meta[name="robots"][content="noindex"]').should('not.exist');
  });

  it('sin sesion /admin lleva al login', () => {
    cy.clearCookies();
    cy.visit('/admin');
    cy.location('pathname').should('eq', '/login');
  });
});
