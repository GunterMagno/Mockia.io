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
});
