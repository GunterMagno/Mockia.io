import { NotificationType, PAST_DUE_GRACE_DAYS } from '@mockia/shared';
import { createNotification } from '../../services/notification.service.js';
import { resolveMailLocale, sendMail, type MailLocale } from '../../services/mailer.js';
import { appBaseUrl } from '../auth/passwordReset.js';

/**
 * Account notices triggered by Stripe events: an email and/or an in-app notification, in the user's language
 * (en when unknown). Nothing here may fail the webhook: the Stripe state is already stored by the time a notice is
 * sent, and Stripe retrying the whole event would only re-send what already went out. Failures are logged WITHOUT
 * the address, the user id or any Stripe id.
 */

export interface NoticeUser {
  _id: { toString(): string };
  email: string;
  username?: string | null;
  locale?: string | null;
  plan?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const BILLING_PATH = '/billing';

/** Long date in the user's language. UTC so the day does not depend on the server time zone. */
export function formatNoticeDate(date: Date, locale: MailLocale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}

/** "$29.00" in the user's language; zero-decimal currencies (JPY) are handled by the currency's own fraction digits. */
function formatMoney(amountMinor: number, currency: string, locale: MailLocale): string {
  const fmt = new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() });
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  return fmt.format(amountMinor / 10 ** digits);
}

const planLabel = (plan?: string | null) => (plan === 'team' ? 'Team' : plan === 'pro' ? 'Pro' : 'Mockia');

const TEXT = {
  paymentFailed: {
    en: (plan: string, date: string) => ({
      title: 'Payment failed',
      message: `We couldn't charge your card. Your ${plan} features stay active until ${date}. Update your payment method to keep your plan.`,
    }),
    es: (plan: string, date: string) => ({
      title: 'Pago fallido',
      message: `No hemos podido cobrar tu tarjeta. Las funciones de ${plan} siguen activas hasta el ${date}. Actualiza tu método de pago para conservar tu plan.`,
    }),
    zh: (plan: string, date: string) => ({
      title: '付款失败',
      message: `我们无法从你的银行卡扣款。你的 ${plan} 功能将保留到 ${date}。请更新付款方式以保留你的套餐。`,
    }),
  },
  trialWillEnd: {
    en: (date: string) => ({
      title: 'Your trial ends soon',
      message: `Your trial ends on ${date}. After that your subscription is charged automatically, unless you cancel before then.`,
    }),
    es: (date: string) => ({
      title: 'Tu prueba termina pronto',
      message: `Tu prueba termina el ${date}. Después tu suscripción se cobrará automáticamente, salvo que la canceles antes.`,
    }),
    zh: (date: string) => ({
      title: '你的试用即将结束',
      message: `你的试用将于 ${date} 结束。之后将自动扣费，除非你在此之前取消。`,
    }),
  },
  refund: {
    en: (amount: string | null) => ({
      title: 'Refund issued',
      message: `${amount ? `We refunded ${amount}` : 'We issued a refund'} to your card. It can take a few days to show up on your statement.`,
    }),
    es: (amount: string | null) => ({
      title: 'Reembolso emitido',
      message: `${amount ? `Hemos reembolsado ${amount}` : 'Hemos emitido un reembolso'} en tu tarjeta. Puede tardar unos días en aparecer en tu extracto.`,
    }),
    zh: (amount: string | null) => ({
      title: '已退款',
      message: `${amount ? `我们已向你的银行卡退还 ${amount}` : '我们已向你的银行卡发起退款'}。退款可能需要几天才会显示在账单中。`,
    }),
  },
} as const;

/** Runs both deliveries independently: one failing never blocks (or fails) the other. */
async function deliver(label: string, tasks: Array<Promise<unknown>>): Promise<void> {
  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === 'rejected') {
      console.error(`[Billing] ${label} notice failed:`, r.reason instanceof Error ? r.reason.message : 'unknown error');
    }
  }
}

const inApp = (user: NoticeUser, title: string, message: string) =>
  createNotification({ userId: user._id.toString(), type: NotificationType.BILLING, title, message, link: BILLING_PATH });

/** First payment failure of a sequence: email + in-app notice with the end of the grace period. */
export async function notifyPaymentFailed(user: NoticeUser, pastDueSince: Date): Promise<void> {
  const locale = resolveMailLocale(user.locale ?? undefined);
  const date = formatNoticeDate(new Date(pastDueSince.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS), locale);
  const text = TEXT.paymentFailed[locale](planLabel(user.plan), date);
  await deliver('payment-failed', [
    sendMail(user.email, 'payment_failed', {
      link: `${appBaseUrl()}${BILLING_PATH}`,
      ...(user.username && { username: user.username }),
      locale,
      date,
    }),
    inApp(user, text.title, text.message),
  ]);
}

/** Trial ending: email + in-app notice. */
export async function notifyTrialWillEnd(user: NoticeUser, trialEnd: Date): Promise<void> {
  const locale = resolveMailLocale(user.locale ?? undefined);
  const date = formatNoticeDate(trialEnd, locale);
  const text = TEXT.trialWillEnd[locale](date);
  await deliver('trial-ending', [
    sendMail(user.email, 'trial_will_end', {
      link: `${appBaseUrl()}${BILLING_PATH}`,
      ...(user.username && { username: user.username }),
      locale,
      date,
    }),
    inApp(user, text.title, text.message),
  ]);
}

/** Refund issued: in-app notice only (the plan does not change; a cancellation arrives as its own event). */
export async function notifyRefund(user: NoticeUser, refund: { amount?: unknown; currency?: unknown }): Promise<void> {
  const locale = resolveMailLocale(user.locale ?? undefined);
  let amount: string | null = null;
  if (typeof refund.amount === 'number' && refund.amount > 0 && typeof refund.currency === 'string') {
    try {
      amount = formatMoney(refund.amount, refund.currency, locale);
    } catch {
      amount = null; // unknown currency code: fall back to the generic sentence
    }
  }
  const text = TEXT.refund[locale](amount);
  await deliver('refund', [inApp(user, text.title, text.message)]);
}
