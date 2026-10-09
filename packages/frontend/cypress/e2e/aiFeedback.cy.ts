// La UI elige idioma segun el navegador: estos tests fijan ingles (tambien en los hooks before)
Cypress.on('window:before:load', (win) => win.localStorage.setItem('mockia_locale', 'en'));

/**
 * Datos propios con consentimiento: voto "util / no util" bajo un resultado de IA, interruptor de consentimiento
 * (apagado por defecto, con confirmacion al retirarlo) y el texto de privacidad. La generacion se simula con
 * cy.intercept (no hay modelo); el resto de rutas son las reales.
 */
const PASSWORD = 'AiFeedback-pass-12345';
const GENERATION_ID = '8d1c9f0e-5b5a-4a3e-9e63-0f0f6f4f9c11';
let counter = 0;
const uniqueEmail = (prefix: string) => `${prefix}${Date.now()}${counter++}@example.com`;

const fakeGeneration = {
  success: true,
  data: {
    specification: { apiVersion: '1.0.0', title: 'Gym API', description: 'd', endpoints: [], dataModels: [] },
    database: { mockApiId: 'x', endpointsCreated: 1, responsesCreated: 1 },
    usage: { totalTokens: 10 },
    generationId: GENERATION_ID,
  },
};

const loginViaUi = (email: string) => {
  cy.visit('/login');
  cy.get('input[name="email"]').type(email);
  cy.get('input[name="password"]').type(PASSWORD);
  cy.get('button[type="submit"]').click();
  cy.url().should('include', '/dashboard');
};

const openProfile = (mobile = false) => {
  if (mobile) {
    // at 375 px the profile entry lives in the hamburger menu
    cy.get('button[aria-label="Toggle menu"]').click();
    cy.contains('button', 'Profile').click();
  } else {
    cy.get('button[aria-label="Profile"]').first().click();
  }
  cy.get('[role="dialog"]').should('be.visible');
};

describe('AI feedback: thumbs up / down under a result', () => {
  const email = uniqueEmail('fb');
  const title = `Feedback project ${Date.now()}`;

  before(() => {
    cy.request('POST', '/api/auth/register', { email, password: PASSWORD, username: 'fbuser', locale: 'en' }).then(() => {
      cy.request('POST', '/api/auth/login', { email, password: PASSWORD }).then((res) => {
        const headers = { Authorization: `Bearer ${res.body.data.tokens.accessToken}` };
        cy.request({ method: 'POST', url: '/api/projects', headers, body: { title, description: 'x' } });
        // The rating is only offered to users who allowed their generations to be used (R14 drops other votes)
        cy.request({ method: 'PUT', url: '/api/users/me/ai-consent', headers, body: { granted: true } });
      });
    });
    cy.clearCookies();
  });

  beforeEach(() => {
    cy.clearCookies();
    cy.intercept('POST', '/api/ai/generate-and-save', { statusCode: 200, body: fakeGeneration }).as('generate');
    loginViaUi(email);
  });

  const generateInEditor = () => {
    cy.contains(title).click();
    cy.contains('button', 'Generate more with AI').click();
    cy.get('textarea').type('A gym API with members');
    cy.contains('button', /^Generate$/).click();
    cy.wait('@generate');
  };

  it('after generating in the editor the modal offers a labelled rating and posts the right payload', () => {
    cy.intercept('POST', '/api/ai/feedback', { statusCode: 204 }).as('feedback');
    generateInEditor();

    cy.contains('[role="dialog"] h3', 'Endpoints generated').should('be.visible');
    cy.get('[data-ai-feedback]').within(() => {
      cy.contains('Was this useful?').should('be.visible');
      cy.get('[data-ai-feedback-good]').should('have.attr', 'aria-label', 'Yes, it was useful').and('have.attr', 'aria-pressed', 'false');
      cy.get('[data-ai-feedback-bad]').should('have.attr', 'aria-label', 'No, it was not useful');
      cy.get('[role="status"]').should('have.text', '');
    });

    cy.get('[data-ai-feedback-good]').click();
    cy.wait('@feedback').its('request.body').should('deep.equal', { generationId: GENERATION_ID, verdict: 'good' });
    cy.get('[data-ai-feedback] [role="status"]').should('have.text', 'Thanks for your feedback!');
    cy.get('[data-ai-feedback-good]').should('have.attr', 'aria-pressed', 'true');

    // changing your mind sends the new vote (the server keeps the latest one)
    cy.get('[data-ai-feedback-bad]').click();
    cy.wait('@feedback').its('request.body').should('deep.equal', { generationId: GENERATION_ID, verdict: 'bad' });
    cy.get('[data-ai-feedback-bad]').should('have.attr', 'aria-pressed', 'true');
    cy.get('[data-ai-feedback-good]').should('have.attr', 'aria-pressed', 'false');
  });

  it('the rating is reachable with the keyboard', () => {
    cy.intercept('POST', '/api/ai/feedback', { statusCode: 204 }).as('feedback');
    generateInEditor();
    cy.get('[data-ai-feedback-good]').focus().should('be.focused');
    cy.get('[data-ai-feedback-good]').should('have.prop', 'tagName', 'BUTTON');
    cy.get('[data-ai-feedback-good]').click();
    cy.wait('@feedback');
    cy.get('[data-ai-feedback] [role="status"]').should('contain.text', 'Thanks');
  });

  it('a failed vote shows an alert and can be retried', () => {
    cy.intercept('POST', '/api/ai/feedback', { statusCode: 500, body: { success: false } }).as('failing');
    generateInEditor();
    cy.get('[data-ai-feedback-bad]').click();
    cy.wait('@failing');
    cy.get('[data-ai-feedback] [role="alert"]').should('contain.text', 'could not send your feedback');
    cy.get('[data-ai-feedback-bad]').should('have.attr', 'aria-pressed', 'false').and('not.be.disabled');

    cy.intercept('POST', '/api/ai/feedback', { statusCode: 204 }).as('ok');
    cy.get('[data-ai-feedback-bad]').click();
    cy.wait('@ok').its('request.body.verdict').should('eq', 'bad');
    cy.get('[data-ai-feedback] [role="alert"]').should('have.text', '');
  });

  it('a server without generationId (older version) shows no rating', () => {
    cy.intercept('POST', '/api/ai/generate-and-save', {
      statusCode: 200,
      body: { success: true, data: { ...fakeGeneration.data, generationId: undefined } },
    }).as('generate');
    generateInEditor();
    cy.contains('[role="dialog"] h3', 'Endpoints generated').should('be.visible');
    cy.get('[data-ai-feedback]').should('not.exist');
  });

  it('creating a project with AI shows the rating on the success screen', () => {
    cy.intercept('POST', '/api/ai/feedback', { statusCode: 204 }).as('feedback');
    cy.contains('button', 'New project').click();
    cy.contains('Empty project').click();
    cy.get('input[placeholder="My awesome API"]').type(`Created with AI ${Date.now()}`);
    cy.contains('button', 'Continue').click();
    cy.contains('button', 'Create project').click();
    cy.wait('@generate');
    cy.contains('button', 'Go to editor').should('be.visible');
    cy.get('[data-ai-feedback-good]').click();
    cy.wait('@feedback').its('request.body').should('deep.equal', { generationId: GENERATION_ID, verdict: 'good' });
  });
});

// Without consent a vote is never stored (R14): instead of buttons that would silently do nothing, the result says so
// and links to the consent switch (Profile -> My data).
describe('AI feedback without consent', () => {
  const email = uniqueEmail('nofb');
  const title = `No consent project ${Date.now()}`;

  before(() => {
    cy.request('POST', '/api/auth/register', { email, password: PASSWORD, username: 'nofbuser', locale: 'en' }).then(() => {
      cy.request('POST', '/api/auth/login', { email, password: PASSWORD }).then((res) => {
        cy.request({
          method: 'POST',
          url: '/api/projects',
          headers: { Authorization: `Bearer ${res.body.data.tokens.accessToken}` },
          body: { title, description: 'x' },
        });
      });
    });
    cy.clearCookies();
  });

  it('shows no thumbs but a link to the consent setting, which opens Profile -> My data', () => {
    cy.clearCookies();
    cy.intercept('POST', '/api/ai/generate-and-save', { statusCode: 200, body: fakeGeneration }).as('generate');
    cy.intercept('POST', '/api/ai/feedback').as('feedback');
    loginViaUi(email);
    cy.contains(title).click();
    cy.contains('button', 'Generate more with AI').click();
    cy.get('textarea').type('A gym API with members');
    cy.contains('button', /^Generate$/).click();
    cy.wait('@generate');
    cy.contains('[role="dialog"] h3', 'Endpoints generated').should('be.visible');
    cy.get('[data-ai-feedback-good]').should('not.exist');
    cy.get('[data-ai-feedback-consent]')
      .should('contain.text', 'improve the AI')
      .find('a')
      .should('have.attr', 'href', '/dashboard?profile=data')
      .then(($a) => cy.visit($a.attr('href')!));
    cy.get('[role="dialog"]').should('be.visible');
    cy.get('[data-ai-consent-switch]').scrollIntoView().should('be.visible').and('have.attr', 'aria-checked', 'false');
    cy.location('search').should('eq', '');
    cy.get('@feedback.all').should('have.length', 0);
  });
});

describe('AI consent: optional, off by default, withdrawal asks first', () => {
  beforeEach(() => {
    cy.clearCookies();
    cy.clearLocalStorage();
  });

  it('is off by default; turning it on and off calls the API, explains the deletion and announces the result', () => {
    const email = uniqueEmail('consent');
    cy.request('POST', '/api/auth/register', { email, password: PASSWORD, username: 'consentuser', locale: 'en' });
    loginViaUi(email);
    cy.intercept('PUT', '/api/users/me/ai-consent').as('consent');
    openProfile();

    cy.contains('[role="dialog"] h4', 'Help improve Mockia’s AI with my generations (optional)').scrollIntoView().should('be.visible');
    cy.get('[data-ai-consent-switch]')
      .should('have.attr', 'role', 'switch')
      .and('have.attr', 'aria-checked', 'false')
      .and('have.attr', 'aria-labelledby')
      .and('not.be.empty');
    // short explanation + link to the privacy section
    cy.get('[data-ai-consent]').should('contain.text', 'off by default').and('contain.text', 'repository and project names').and('contain.text', 'not detected');
    cy.get('[data-ai-consent] a[href="/privacy#ai-training"]').should('have.attr', 'target', '_blank').and('have.attr', 'rel').and('contain', 'noopener');

    // on: immediate, announced
    cy.get('[data-ai-consent-switch]').click();
    cy.wait('@consent').then(({ request, response }) => {
      expect(request.body).to.deep.equal({ granted: true });
      expect(response?.statusCode).to.eq(200);
      expect(response?.body.aiTrainingConsent.granted).to.eq(true);
    });
    cy.get('[data-ai-consent] [role="status"]').should('contain.text', 'Thanks!');
    cy.get('[data-ai-consent-switch]').should('have.attr', 'aria-checked', 'true');

    // the choice survives closing and reopening the modal (it comes from the server)
    cy.get('body').type('{esc}');
    cy.get('[role="dialog"]').should('not.exist');
    openProfile();
    cy.get('[data-ai-consent-switch]').should('have.attr', 'aria-checked', 'true');

    // off: asks first, explains the deletion, and "keep it on" changes nothing
    cy.get('[data-ai-consent-switch]').click();
    cy.get('[data-ai-consent] [role="group"]')
      .should('be.visible')
      .and('contain.text', 'deleted now')
      .and('contain.text', 'cannot be undone');
    cy.contains('[data-ai-consent] button', 'Keep it on').should('be.focused').click();
    cy.get('[data-ai-consent] [role="group"]').should('not.exist');
    cy.get('[data-ai-consent-switch]').should('have.attr', 'aria-checked', 'true').and('be.focused');

    cy.get('[data-ai-consent-switch]').click();
    cy.get('[data-ai-consent-confirm]').click();
    cy.wait('@consent').then(({ request, response }) => {
      expect(request.body).to.deep.equal({ granted: false });
      expect(response?.statusCode).to.eq(204);
    });
    cy.get('[data-ai-consent] [role="status"]').should('contain.text', 'was deleted');
    cy.get('[data-ai-consent-switch]').should('have.attr', 'aria-checked', 'false');
    cy.get('[data-ai-consent] [role="group"]').should('not.exist');
  });

  it('a failed save keeps the switch where it was and shows an alert', () => {
    const email = uniqueEmail('consentfail');
    cy.request('POST', '/api/auth/register', { email, password: PASSWORD, username: 'consentfail', locale: 'en' });
    loginViaUi(email);
    cy.intercept('PUT', '/api/users/me/ai-consent', { statusCode: 500, body: { success: false, error: { message: 'boom' } } }).as('consent');
    openProfile();
    cy.get('[data-ai-consent-switch]').click();
    cy.wait('@consent');
    cy.get('[data-ai-consent] [role="alert"]').should('not.have.text', '');
    cy.get('[data-ai-consent-switch]').should('have.attr', 'aria-checked', 'false').and('not.be.disabled');
  });

  it('works at 375 px without horizontal overflow and with a 44 px tap target', () => {
    cy.viewport(375, 812);
    const email = uniqueEmail('consentmobile');
    cy.request('POST', '/api/auth/register', { email, password: PASSWORD, username: 'consentmobile', locale: 'en' });
    loginViaUi(email);
    openProfile(true);
    cy.get('[data-ai-consent-switch]').scrollIntoView().then(($el) => {
      // layout size (offsetWidth/Height): getBoundingClientRect would include the modal's opening scale animation
      expect($el[0].offsetHeight).to.be.at.least(44);
      expect($el[0].offsetWidth).to.be.at.least(44);
    });
    cy.document().then((doc) => {
      expect(doc.documentElement.scrollWidth).to.be.at.most(doc.documentElement.clientWidth);
    });
  });
});

describe('Privacy page covers the optional AI training', () => {
  const visitIn = (lang: 'es' | 'en' | 'zh', hash = '') =>
    cy.visit(`/privacy${hash}`, { onBeforeLoad: (win) => win.localStorage.setItem('mockia_locale', lang) });

  it('es: names the purpose, the legal basis (consentimiento, art. 6.1.a), retention, withdrawal and the untraining limit', () => {
    visitIn('es');
    cy.get('article')
      .should('contain.text', 'mejorar el modelo de IA de Mockia')
      .and('contain.text', 'art. 6.1.a')
      .and('contain.text', '180 días')
      .and('contain.text', 'Mis datos')
      .and('contain.text', 'no puede «desentrenarlo»')
      // says precisely what is NOT removed, and that a vote without consent is not stored at all
      .and('contain.text', 'No se detectan')
      .and('contain.text', 'el nombre del repositorio')
      .and('contain.text', 'no se almacena en ningún caso')
      .and('not.contain.text', 'se guarda siempre');
  });

  it('the section is an anchor target: /privacy#ai-training scrolls to it', () => {
    visitIn('es', '#ai-training');
    cy.get('section#ai-training h2').should('contain.text', 'Mejorar la IA con tus generaciones');
    // smooth scrolling: retry until the section has arrived near the top of the viewport
    cy.get('section#ai-training').should(($s) => {
      expect($s[0].getBoundingClientRect().top).to.be.lessThan(300);
    });
  });

  it('en and zh carry the same section', () => {
    visitIn('en');
    cy.get('section#ai-training').should('contain.text', 'explicit consent').and('contain.text', '180 days').and('contain.text', 'untrain').and('contain.text', 'Not detected').and('contain.text', 'not stored at all');
    visitIn('zh');
    cy.get('section#ai-training').invoke('text').should('match', /同意/).and('match', /180/);
  });

  it('the old claim that no processing relies on consent is gone in all three languages', () => {
    for (const [lang, old] of [['es', 'Hoy ningún tratamiento se basa en tu consentimiento'], ['en', 'Today no processing is based on your consent'], ['zh', '目前没有任何处理基于你的同意']] as const) {
      visitIn(lang);
      cy.get('article').invoke('text').should('not.contain', old);
    }
  });
});
