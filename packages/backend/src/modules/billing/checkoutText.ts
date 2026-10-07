import { SUPPORTED_LOCALES, type Locale } from '@mockia/shared';

/** Stripe limit for custom_text[...][message] (Checkout renders a subset of markdown, links included). */
export const STRIPE_CUSTOM_TEXT_MAX = 1200;

const isLocale = (value: unknown): value is Locale => (SUPPORTED_LOCALES as readonly unknown[]).includes(value);

/** Checkout locale: the user's saved language, or Stripe's own detection (`auto`) when we do not know it. */
export function stripeCheckoutLocale(saved: unknown): Locale | 'auto' {
  return isLocale(saved) ? saved : 'auto';
}

/**
 * Text shown next to the mandatory "accept the Terms" checkbox of Checkout. It is where the consumer requests
 * immediate access and acknowledges losing the 14-day withdrawal right once supply begins (art. 103.m TRLGDCU), as
 * the Terms ("Derecho de desistimiento") promise. Keep it in line with legalContent/{es,en,zh}.ts.
 */
export const TERMS_ACCEPTANCE_MESSAGES: Record<Locale, (termsUrl: string) => string> = {
  en: (termsUrl) =>
    `By ticking this box you accept the [Terms of Service](${termsUrl}) and expressly request immediate access to the service. ` +
    `You acknowledge that, once the service has begun to be supplied, you lose your 14-day right of withdrawal (art. 103 of the Spanish consumer law, TRLGDCU).`,
  es: (termsUrl) =>
    `Al marcar esta casilla aceptas los [Términos del Servicio](${termsUrl}) y solicitas expresamente el acceso inmediato al servicio. ` +
    `Reconoces que, una vez comenzado el suministro, pierdes el derecho de desistimiento de 14 días (art. 103 TRLGDCU).`,
  zh: (termsUrl) =>
    `勾选此框即表示你接受[服务条款](${termsUrl}),并明确要求立即开通服务。` +
    `你确认:服务一经开始提供,你将丧失 14 天的撤销权(西班牙《消费者法》TRLGDCU 第 103 条)。`,
};

/** Withdrawal-waiver message in the user's language (English when the language is unknown). */
export function termsAcceptanceMessage(locale: unknown, termsUrl: string): string {
  return TERMS_ACCEPTANCE_MESSAGES[isLocale(locale) ? locale : 'en'](termsUrl);
}
