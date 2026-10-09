import { ANNUAL_DISCOUNT_PERCENT, PLAN_LIMITS, PLAN_PRICE_USD, annualMonthlyEquivalentUsd } from '@mockia/shared';

// La UI elige idioma segun el navegador: estos tests fijan ingles (tambien en los hooks before); los de es/zh cambian `uiLocale`
type Lang = 'en' | 'es' | 'zh';
let uiLocale: Lang = 'en';
Cypress.on('window:before:load', (win) => win.localStorage.setItem('mockia_locale', uiLocale));

const API = 'http://localhost:3000/api';

describe('Billing: planes, limites y facturacion', () => {
  const password = 'Password123!';

  afterEach(() => {
    uiLocale = 'en';
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
  // Limites tal como los manda la API (null = sin tope), leidos del catalogo compartido
  const limitsOf = (plan: keyof typeof PLAN_LIMITS) => {
    const l = PLAN_LIMITS[plan];
    return {
      maxActiveProjects: Number.isFinite(l.maxActiveProjects) ? l.maxActiveProjects : null,
      maxMonthlyRequests: l.maxMonthlyRequests,
      maxMonthlyAiGenerations: l.maxMonthlyAiGenerations,
    };
  };
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
      limits: limitsOf('free'),
      usage: { activeProjects: 0, monthlyRequests: 0, aiGenerations: 0, periodResetAt: new Date(Date.now() + 20 * day).toISOString() },
      canManageBilling: false,
      checkoutAvailable: { starter: true, pro: true, team: true },
      yearlyCheckoutAvailable: { starter: true, pro: true, team: false },
      ...extra,
    },
  });

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

    it('las cinco tarjetas (Free, Starter, Pro, Team y Enterprise) caben sin desbordar en 375, 768 y 1440 px', () => {
      for (const [width, height] of [[375, 812], [768, 1024], [1440, 900]]) {
        cy.viewport(width, height);
        cy.visit('/');
        cy.get('#pricing-title').scrollIntoView();
        cy.get('ul[class*="grid"] > li').should('have.length', 5);
        cy.document().then((doc) => {
          expect(doc.documentElement.scrollWidth, `ancho ${width}`).to.be.at.most(width);
        });
      }
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
        limits: limitsOf('pro'),
        canManageBilling: true,
        yearlyCheckoutAvailable: { starter: true, pro: true, team: true },
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

  describe('plan Starter, medidor de IA y cuota mensual', () => {
    // Todo lo numerico sale del catalogo compartido (@mockia/shared): si cambia un precio o un limite, estos tests lo siguen
    const money = (amount: number) => {
      const digits = Number.isInteger(amount) ? 0 : 2;
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
    };
    const count = (n: number) => new Intl.NumberFormat('en-US').format(n);
    const compact = (n: number) => new Intl.NumberFormat('en-US', { notation: 'compact' }).format(n);
    const aiLine = (plan: 'free' | 'starter' | 'pro' | 'team') => `${count(PLAN_LIMITS[plan].maxMonthlyAiGenerations)} AI generations per month`;
    const toggle = () => cy.get('[role="group"][aria-label="Billing period"]');
    const card = (plan: string) => cy.get(`[data-testid="plan-${plan}"]`);

    // (a) cinco tarjetas en /billing y rejilla 1 -> 2 -> 3+2 (o 5 en linea) sin desbordes ni texto cortado
    it('/billing muestra cinco tarjetas y la rejilla pasa de 1 a 2 y a 3 o mas columnas sin cortar texto', () => {
      loginFresh('GridUser');
      cy.intercept('GET', '**/api/billing/me', overviewOf({})).as('overview');
      for (const [width, height, columns] of [[375, 812, 1], [768, 1024, 2], [1440, 900, 0]]) {
        cy.viewport(width, height);
        cy.visit('/billing');
        cy.wait('@overview');
        cy.get('#billing-plans-title').scrollIntoView();
        cy.get('ul[class*="grid"] > li').should('have.length', 5).then(($li) => {
          const rects = [...$li].map((el) => el.getBoundingClientRect());
          const lefts = new Set(rects.map((r) => Math.round(r.left)));
          if (columns) expect(lefts.size, `columnas a ${width}px`).to.eq(columns);
          else expect(lefts.size, `columnas a ${width}px`).to.be.at.least(3);
          for (const r of rects) {
            expect(r.left, `izquierda a ${width}px`).to.be.at.least(0);
            expect(r.right, `derecha a ${width}px`).to.be.at.most(width);
          }
          // Ningun texto de las tarjetas queda cortado: ni la tarjeta ni un elemento de bloque con mas contenido que caja
          for (const li of [...$li]) {
            expect(li.scrollWidth, `tarjeta ${li.querySelector('h3')?.textContent} a ${width}px`).to.be.at.most(li.clientWidth + 1);
            for (const el of [...li.querySelectorAll<HTMLElement>('*')]) {
              if (el.clientWidth === 0) continue; // en linea: lo mide su contenedor
              expect(el.scrollWidth, `${el.tagName}.${el.className} "${el.textContent?.slice(0, 20)}" a ${width}px`).to.be.at.most(el.clientWidth + 1);
            }
          }
        });
        cy.document().then((doc) => expect(doc.documentElement.scrollWidth, `pagina a ${width}px`).to.be.at.most(width));
      }
    });

    // (b) copia honesta y precios de Starter
    it('la tarjeta Starter ensena su precio, el equivalente anual y solo lo que existe; la etiqueta "Most affordable" es la del plan de pago mas barato', () => {
      loginFresh('StarterCopy');
      cy.intercept('GET', '**/api/billing/me', overviewOf({})).as('overview');
      cy.visit('/billing');
      cy.wait('@overview');

      const starter = PLAN_PRICE_USD.starter;
      card('starter').within(() => {
        cy.contains('h3', 'Starter').should('be.visible');
        cy.get('[data-testid="price-starter"]').should('have.text', money(starter.monthly));
        cy.get('[data-testid="billed-starter"]').should('have.text', 'Billed monthly');
        cy.contains('li', `${PLAN_LIMITS.starter.maxActiveProjects} active projects`).should('exist');
        cy.contains('li', `${compact(PLAN_LIMITS.starter.maxMonthlyRequests)} mock requests per month`).should('exist');
        cy.contains('li', aiLine('starter')).should('exist');
        cy.contains('li', 'Community support').should('exist');
        // Nada que no exista: ni correo ni soporte prioritario
        cy.get('li').filter(':contains("Email support"), :contains("Priority support")').should('not.exist');
        cy.contains('Most affordable').should('be.visible');
      });
      for (const other of ['free', 'pro', 'team', 'enterprise']) card(other).contains('Most affordable').should('not.exist');

      // Cada tarjeta con precio ensena su tope mensual de generaciones de IA
      for (const plan of ['free', 'starter', 'pro', 'team'] as const) card(plan).contains('li', aiLine(plan)).should('exist');

      toggle().contains('button', 'Yearly').click();
      card('starter').within(() => {
        cy.get('[data-testid="price-starter"]').should('have.text', money(annualMonthlyEquivalentUsd('starter')));
        cy.get('[data-testid="billed-starter"]')
          .should('contain.text', `Billed yearly ${money(starter.annual)}`)
          .and('contain.text', `Save ${ANNUAL_DISCOUNT_PERCENT}%`);
      });
    });

    // (c) el boton de Starter inicia el checkout con plan e intervalo
    it('el boton de Starter envia plan e intervalo a /billing/checkout', () => {
      loginFresh('StarterCheckout');
      cy.intercept('GET', '**/api/billing/me', overviewOf({})).as('overview');
      cy.intercept('POST', '**/api/billing/checkout', { success: true, data: { id: 'cs_1', url: '/billing?checkout=cancel' } }).as('checkout');
      cy.visit('/billing');
      cy.wait('@overview');
      card('starter').contains('button', 'Upgrade to Starter').click();
      cy.wait('@checkout').its('request.body').should('deep.equal', { plan: 'starter', interval: 'month' });

      cy.visit('/billing');
      cy.wait('@overview');
      toggle().contains('button', 'Yearly').click();
      card('starter').contains('button', 'Upgrade to Starter').click();
      cy.wait('@checkout').its('request.body').should('deep.equal', { plan: 'starter', interval: 'year' });
    });

    it('sin el precio de Starter configurado la tarjeta no ofrece comprar, y un suscriptor Starter ve su plan actual', () => {
      loginFresh('StarterOff');
      cy.intercept('GET', '**/api/billing/me', overviewOf({ checkoutAvailable: { starter: false, pro: true, team: true } })).as('overview');
      cy.visit('/billing');
      cy.wait('@overview');
      card('starter').contains('button', 'Not available yet').should('be.disabled');

      cy.intercept('GET', '**/api/billing/me', overviewOf({
        plan: 'starter',
        subscribedPlan: 'starter',
        interval: 'month',
        currentPeriodEnd: new Date(Date.now() + 10 * day).toISOString(),
        limits: limitsOf('starter'),
        canManageBilling: true,
      })).as('starterOverview');
      cy.visit('/billing');
      cy.wait('@starterOverview');
      cy.contains('h2', 'Starter').should('be.visible');
      card('starter').contains('button', 'Current plan').should('be.disabled');
      card('pro').contains('button', 'Switch to Pro').should('be.enabled');
      card('free').contains('button', 'Change in billing portal').should('exist');
    });

    // (d) medidor de IA
    describe('medidor de generaciones de IA', () => {
      const limit = PLAN_LIMITS.starter.maxMonthlyAiGenerations;
      const meter = () => cy.get('[role="progressbar"][aria-label="AI generations"]');
      const warning = () => cy.get('[data-testid="ai-quota-warning"]');
      const starterWith = (aiGenerations: number) =>
        overviewOf({
          plan: 'starter',
          subscribedPlan: 'starter',
          interval: 'month',
          currentPeriodEnd: new Date(Date.now() + 10 * day).toISOString(),
          limits: limitsOf('starter'),
          usage: { activeProjects: 2, monthlyRequests: 120, aiGenerations, periodResetAt: '2026-10-31T23:30:00.000Z' },
          canManageBilling: true,
        });

      it('muestra X de Y y la fecha de reinicio en UTC, sin aviso por debajo del 80 %', () => {
        loginFresh('MeterLow');
        const used = Math.floor(limit * 0.5);
        cy.intercept('GET', '**/api/billing/me', starterWith(used)).as('overview');
        cy.visit('/billing');
        cy.wait('@overview');
        meter()
          .should('have.attr', 'aria-valuenow', String(used))
          .and('have.attr', 'aria-valuemax', String(limit))
          .and('have.attr', 'aria-valuetext')
          .and('contain', `${used} of ${limit}`)
          .and('contain', 'October 31, 2026');
        cy.contains(`${used} of ${limit}`).should('be.visible');
        cy.contains('Resets on October 31, 2026').should('be.visible');
        warning().should('not.exist');
      });

      it('avisa con role=status desde el 80 % y con un mensaje mas fuerte al llegar al tope', () => {
        loginFresh('MeterHigh');
        const near = Math.ceil(limit * 0.8);
        cy.intercept('GET', '**/api/billing/me', starterWith(near)).as('overview');
        cy.visit('/billing');
        cy.wait('@overview');
        warning()
          .should('have.attr', 'role', 'status')
          .and('contain.text', `${near} of your ${limit} AI generations`)
          .and('contain.text', 'October 31, 2026');
        // El aviso es un mensaje de estado, no una alerta de error
        warning().find('[role="alert"]').should('not.exist');

        cy.intercept('GET', '**/api/billing/me', starterWith(limit)).as('full');
        cy.visit('/billing');
        cy.wait('@full');
        warning()
          .should('have.attr', 'role', 'status')
          .and('contain.text', `You have used all ${limit} AI generations of your Starter plan`)
          .and('contain.text', 'October 31, 2026');
        warning().contains('button', 'See plans').click();
        cy.get('#billing-plans-title').should('be.visible');
        meter().should('have.attr', 'aria-valuenow', String(limit));
      });

      it('un plan sin tope de IA lo dice y no avisa; sin el contador en la respuesta no hay medidor', () => {
        loginFresh('MeterNone');
        const unlimited = starterWith(500);
        (unlimited.data as any).limits = { ...limitsOf('starter'), maxMonthlyAiGenerations: null };
        cy.intercept('GET', '**/api/billing/me', unlimited).as('overview');
        cy.visit('/billing');
        cy.wait('@overview');
        meter().should('have.attr', 'aria-valuetext').and('contain', 'Unlimited');
        warning().should('not.exist');

        const old = starterWith(0);
        delete (old.data as any).usage.aiGenerations;
        cy.intercept('GET', '**/api/billing/me', old).as('old');
        cy.visit('/billing');
        cy.wait('@old');
        cy.get('[role="progressbar"][aria-label="Mock requests"]').should('exist');
        meter().should('not.exist');
      });

      it('en 375 px el medidor y su aviso caben sin desbordar', () => {
        loginFresh('MeterMobile');
        cy.viewport(375, 812);
        cy.intercept('GET', '**/api/billing/me', starterWith(limit)).as('overview');
        cy.visit('/billing');
        cy.wait('@overview');
        warning().should('be.visible');
        cy.document().then((doc) => expect(doc.documentElement.scrollWidth).to.be.at.most(375));
      });
    });

    // (e) la API responde 429 AI_QUOTA_EXCEEDED: aviso traducido con uso, limite, fecha de reinicio y enlace a /billing
    describe('cuota de IA agotada al generar', () => {
      const quotaBody = {
        success: false,
        error: { code: 'AI_QUOTA_EXCEEDED', message: 'Monthly AI generation limit reached', used: 5, limit: 5, resetsAt: '2026-11-01T00:00:00.000Z' },
      };
      type Texts = { newProject: string; empty: string; placeholder: string; cont: string; create: string; genMore: string; gen: RegExp; date: string; text: RegExp; link: string; generic: RegExp };
      const T: Record<Lang, Texts> = {
        en: {
          newProject: 'New project', empty: 'Empty project', placeholder: 'My awesome API', cont: 'Continue', create: 'Create project',
          genMore: 'Generate more with AI', gen: /^Generate$/, date: 'November 1, 2026', link: 'See plans',
          text: /You’ve used 5 of the 5 AI generations included in your plan this month/, generic: /Too many requests|AI generation failed/i,
        },
        es: {
          newProject: 'Nuevo proyecto', empty: 'Proyecto vacío', placeholder: 'Mi API increíble', cont: 'Continuar', create: 'Crear proyecto',
          genMore: 'Generar más con IA', gen: /^Generar$/, date: '1 de noviembre de 2026', link: 'Ver planes',
          text: /Has usado 5 de las 5 generaciones con IA incluidas en tu plan este mes/, generic: /Demasiadas peticiones|Falló la generación/i,
        },
        zh: {
          newProject: '新建项目', empty: '空项目', placeholder: '我的超棒 API', cont: '继续', create: '创建项目',
          genMore: '用 AI 生成更多', gen: /^生成$/, date: '2026年11月1日', link: '查看方案',
          text: /本月你的方案包含的 5 次 AI 生成已用 5 次/, generic: /请求过于频繁|AI 生成失败/,
        },
      };
      const email = `aiquota${Date.now()}@example.com`;
      const title = `Quota project ${Date.now()}`;

      before(() => {
        cy.request('POST', `${API}/auth/register`, { username: 'AiQuotaUser', email, password });
        cy.request('POST', `${API}/auth/login`, { email, password }).then((res) => {
          cy.request({
            method: 'POST',
            url: `${API}/projects`,
            headers: { Authorization: `Bearer ${res.body.data.tokens.accessToken}` },
            body: { title, description: 'e2e' },
          });
        });
        cy.clearCookies();
      });

      beforeEach(() => {
        cy.clearCookies();
        cy.intercept('POST', '**/api/ai/generate-and-save', { statusCode: 429, headers: { 'Retry-After': '86400' }, body: quotaBody }).as('generate');
        // Un 429 no es un 401: no debe pedir una sesion nueva
        cy.intercept('POST', '**/api/auth/refresh').as('refresh');
      });

      const login = () => {
        cy.visit('/login');
        // El arranque de la app pide una sesion (refresh) y su respuesta limpia la sesion local: se espera a que termine antes de entrar
        cy.wait('@refresh');
        cy.get('input[name="email"]').type(email);
        cy.get('input[name="password"]').type(password);
        cy.get('button[type="submit"]').click();
        cy.location('pathname').should('eq', '/dashboard');
        // El idioma se cambia dentro de la app (sin recargar): asi se prueba lo que ve quien lo ha elegido en el selector
        // (tambien en ingles: un test anterior pudo dejar guardado otro idioma en la cuenta)
        cy.get('select:has(option[value="zh"])').filter(':visible').first().select(uiLocale);
      };

      // Se cuentan justo antes de pulsar "Generar": el arranque de la sesion puede refrescar antes, lo que importa es el 429
      let refreshesBefore = 0;
      const countRefreshes = () => cy.get('@refresh.all').then((calls) => { refreshesBefore = calls.length; });

      const expectQuotaNotice = (lang: Lang) => {
        const tx = T[lang];
        cy.get('@refresh.all').should((calls) => expect(calls.length, 'refrescos de sesion tras el 429').to.eq(refreshesBefore));
        cy.get('[role="dialog"]').within(() => {
          cy.get('[role="alert"]').should('contain.text', tx.date).invoke('text').should('match', tx.text).and('not.match', tx.generic);
          cy.get('a[href="/billing"]').should('contain.text', tx.link).and('be.visible');
        });
        cy.location('pathname').should('not.eq', '/login');
      };

      for (const lang of ['en', 'es', 'zh'] as Lang[]) {
        it(`crear un proyecto con IA (${lang}): el aviso de cuota lleva la fecha y el enlace a /billing`, () => {
          uiLocale = lang;
          const tx = T[lang];
          login();
          cy.contains('button', tx.newProject).click();
          cy.contains(tx.empty).click();
          cy.get(`input[placeholder="${tx.placeholder}"]`).type(`Over quota ${lang} ${Date.now()}`);
          cy.contains('button', tx.cont).click();
          countRefreshes();
          cy.contains('button', tx.create).click();
          cy.wait('@generate');
          expectQuotaNotice(lang);
          // La pagina de planes es la salida natural: el enlace funciona
          cy.get('[role="dialog"] a[href="/billing"]').click();
          cy.location('pathname').should('eq', '/billing');
        });

        it(`el panel de IA del editor (${lang}) muestra el mismo aviso en el panel, no una alerta del navegador`, () => {
          uiLocale = lang;
          const tx = T[lang];
          login();
          cy.window().then((win) => cy.stub(win, 'alert').as('alert'));
          cy.contains(title).click();
          cy.contains('button', tx.genMore).click();
          cy.get('textarea').type('A gym API with members');
          countRefreshes();
          cy.contains('button', tx.gen).click();
          cy.wait('@generate');
          expectQuotaNotice(lang);
          cy.get('@alert').should('not.have.been.called');
          cy.get('[role="dialog"] a[href="/billing"]').click();
          cy.location('pathname').should('eq', '/billing');
        });
      }

      it('otros errores de IA siguen mostrandose como antes (traducidos) y sin enlace de planes', () => {
        login();
        cy.intercept('POST', '**/api/ai/generate-and-save', {
          statusCode: 429,
          body: { success: false, error: { message: 'Too many AI generation requests. Please wait a moment.' } },
        }).as('rate');
        cy.contains(title).click();
        cy.contains('button', 'Generate more with AI').click();
        cy.get('textarea').type('A gym API');
        cy.contains('button', /^Generate$/).click();
        cy.wait('@rate');
        cy.get('[role="dialog"] [role="alert"]').should('contain.text', 'AI generation failed');
        cy.get('[role="dialog"] a[href="/billing"]').should('not.exist');
      });
    });

    // (f) los Terminos nombran los cuatro planes y el limite mensual de IA
    it('los Terminos (es, en y zh) nombran Free, Starter, Pro y Team y el limite mensual de generaciones de IA', () => {
      const EXPECT: Record<Lang, { plans: RegExp; ai: RegExp }> = {
        es: { plans: /planes Free, Starter, Pro y Team/, ai: /generaciones de IA al mes/ },
        en: { plans: /Free, Starter, Pro and Team plans/, ai: /AI generations per month/ },
        zh: { plans: /Free、Starter、Pro 和 Team 套餐/, ai: /每月 AI 生成次数/ },
      };
      for (const lang of ['es', 'en', 'zh'] as Lang[]) {
        cy.then(() => {
          uiLocale = lang;
        });
        cy.visit('/terms');
        cy.get('article[data-legal]').invoke('text').should('match', EXPECT[lang].plans).and('match', EXPECT[lang].ai);
      }
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
        interval: 'month',
        limits: limitsOf('pro'),
        usage: { activeProjects: 2, monthlyRequests: 120, aiGenerations: 12, periodResetAt: new Date(Date.now() + 20 * DAY).toISOString() },
        canManageBilling: true,
        checkoutAvailable: { starter: true, pro: true, team: true },
        yearlyCheckoutAvailable: { starter: true, pro: true, team: true },
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
        limits: limitsOf('free'),
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
        usage: { activeProjects: 2, monthlyRequests: 120, aiGenerations: 12, periodResetAt: '2026-10-31T23:30:00.000Z' },
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
