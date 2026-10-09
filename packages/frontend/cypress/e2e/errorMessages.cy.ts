// La UI elige idioma segun el navegador: estos tests fijan ingles
Cypress.on('window:before:load', (win) => win.localStorage.setItem('mockia_locale', 'en'));

/**
 * The AI and request errors added in the final pass (per-user AI limit, deadline, provider down, invalid answer,
 * upstream failure, non-JSON body, oversized body) are shown translated instead of in raw backend English.
 * The module is loaded from the vite dev server (same instance the app uses).
 */
const err = (status: number, message: string) => ({ response: { status, data: { success: false, error: { message } } } });

const CASES: Array<[number, string, string]> = [
  [429, 'Too many AI generation requests. Please wait a moment.', 'errors.aiRateLimit'],
  [504, 'The AI request took too long and was cancelled. Please try again.', 'errors.aiTimeout'],
  [503, 'AI service temporarily unavailable. Please try again later.', 'errors.aiUnavailable'],
  [503, 'OpenRouter API temporarily unavailable. Please try again later.', 'errors.aiUnavailable'],
  [429, 'OpenRouter API rate limited. Please try again later.', 'errors.aiUnavailable'],
  [502, 'The AI returned an invalid answer. Please try again.', 'errors.aiInvalidAnswer'],
  [500, 'Failed to parse AI output as JSON', 'errors.aiInvalidAnswer'],
  [500, 'Invalid JSON response from AI: Unexpected token', 'errors.aiInvalidAnswer'],
  [502, 'OpenRouter API error (upstream status 404). Please try again later.', 'errors.aiUpstream'],
  [502, 'OpenRouter API authentication failed', 'errors.aiUpstream'],
  [415, 'Content-Type must be application/json', 'errors.unsupportedMediaType'],
  [413, 'request entity too large', 'errors.tooLarge'],
  [400, 'requirement is too long (4000 characters maximum)', 'errors.tooLarge'],
];

describe('Error messages: the new AI / request errors are translated', () => {
  it('maps each backend message to its i18n key', () => {
    cy.visit('/');
    cy.window().then(async (win) => {
      const { getBackendErrorMessage } = await new win.Function('return import("/src/utils/error.ts")')();
      for (const [status, message, key] of CASES) {
        expect(getBackendErrorMessage(err(status, message), (k: string) => k), message).to.eq(key);
      }
      // A bare 413 without a body is translated too
      expect(getBackendErrorMessage({ response: { status: 413 } }, (k: string) => k)).to.eq('errors.tooLarge');
    });
  });

  it('every key has a non-empty text in en, es and zh', () => {
    cy.visit('/');
    cy.window().then(async (win) => {
      for (const lang of ['en', 'es', 'zh']) {
        const mod = await new win.Function(`return import("/src/i18n/locales/${lang}.ts")`)();
        const errors = (mod.default ?? mod[lang]).errors as Record<string, string>;
        for (const key of new Set(CASES.map(([, , k]) => k.replace('errors.', '')))) {
          expect(errors[key], `${lang}.errors.${key}`).to.be.a('string').and.not.be.empty;
        }
      }
    });
  });

  // 402 PLAN_LIMIT_REACHED names the plan through the same keys as the pricing cards (Starter used to show as "starter")
  it('names every plan in the project limit error, Starter included', () => {
    cy.visit('/');
    cy.window().then(async (win) => {
      const { getBackendErrorMessage } = await new win.Function('return import("/src/utils/error.ts")')();
      const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}|${JSON.stringify(vars)}` : key);
      const limit = (plan: string) => ({ response: { status: 402, data: { success: false, error: { code: 'PLAN_LIMIT_REACHED', message: 'x', details: { plan, limit: 15 } } } } });
      for (const plan of ['free', 'starter', 'pro', 'team']) {
        expect(getBackendErrorMessage(limit(plan), t)).to.eq(`billing.errors.limitReached|${JSON.stringify({ plan: `pricing.plans.${plan}.name`, limit: 15 })}`);
      }
      // An unknown plan is shown as the server sent it
      expect(getBackendErrorMessage(limit('enterprise'), t)).to.contain('"plan":"enterprise"');
    });
  });

  // 429 AI_QUOTA_EXCEEDED carries used / limit / resetsAt: the message gets them, the date in UTC
  it('turns AI_QUOTA_EXCEEDED into the quota message with used, limit and the reset date', () => {
    cy.visit('/');
    cy.window().then(async (win) => {
      const { getBackendErrorMessage, getAiQuotaInfo } = await new win.Function('return import("/src/utils/error.ts")')();
      const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}|${JSON.stringify(vars)}` : key);
      const quota = (error: Record<string, unknown>) => ({ response: { status: 429, data: { success: false, error: { code: 'AI_QUOTA_EXCEEDED', message: 'Monthly AI generation limit reached', ...error } } } });
      const ok = quota({ used: 1500, limit: 1500, resetsAt: '2026-10-31T23:30:00.000Z' });
      expect(getBackendErrorMessage(ok, t)).to.eq(`billing.errors.aiQuota|${JSON.stringify({ used: '1,500', limit: '1,500', date: 'October 31, 2026' })}`);
      expect(getAiQuotaInfo(ok)).to.deep.eq({ used: 1500, limit: 1500, resetsAt: '2026-10-31T23:30:00.000Z' });
      // Anything else is not a quota error: no quota info, and a malformed body falls back to the server text
      expect(getAiQuotaInfo(quota({ used: 1, limit: 5 }))).to.eq(null);
      expect(getAiQuotaInfo(quota({ used: 1, limit: 5, resetsAt: 'soon' }))).to.eq(null);
      expect(getAiQuotaInfo({ response: { status: 429, data: { error: { message: 'Too many AI generation requests. Please wait a moment.' } } } })).to.eq(null);
      expect(getBackendErrorMessage(quota({ used: 1, limit: 5 }), t)).to.eq('Monthly AI generation limit reached');
    });
  });

  it('the plan names and the quota message exist in en, es and zh', () => {
    cy.visit('/');
    cy.window().then(async (win) => {
      for (const lang of ['en', 'es', 'zh']) {
        const mod = await new win.Function(`return import("/src/i18n/locales/${lang}.ts")`)();
        const messages = mod.default ?? mod[lang];
        expect(messages.billing.errors.aiQuota, `${lang}.billing.errors.aiQuota`).to.be.a('string').and.match(/\{used\}/).and.match(/\{limit\}/).and.match(/\{date\}/);
        for (const plan of ['free', 'starter', 'pro', 'team']) expect(messages.pricing.plans[plan].name, `${lang} ${plan}`).to.be.a('string').and.not.be.empty;
      }
    });
  });
});
