import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Transactional email (nodemailer).
 *
 * - `SMTP_URL` (e.g. smtp://user:pass@smtp.resend.com:587) + `MAIL_FROM` configure the real transport.
 * - Without SMTP_URL nothing leaves the machine:
 *     NODE_ENV=test, or E2E_EXPOSE_MAIL_OUTBOX=true  -> the message lands in an in-memory outbox (getTestOutbox)
 *     NODE_ENV=development                           -> the action link is printed to the console
 *     NODE_ENV=production                            -> an error is logged and sendMail still resolves, so a request
 *                                                       to /auth/forgot looks the same whether or not mail works
 *                                                       (it must never reveal whether an account exists).
 * - Templates are plain HTML + text in English, Spanish and Chinese, chosen by `data.locale` (default en).
 */

export type MailTemplate = 'verify' | 'reset' | 'payment_failed' | 'trial_will_end';
export type MailLocale = 'en' | 'es' | 'zh';

export const MAIL_LOCALES: readonly MailLocale[] = ['en', 'es', 'zh'];

/** Data a template needs: `link` is mandatory; `username`, `locale` and (billing notices) `date`, already formatted for the reader, are optional. */
export type MailData = Record<string, string> & { link: string };

export interface RenderedMail {
  locale: MailLocale;
  subject: string;
  text: string;
  html: string;
}

export interface OutboxEntry extends RenderedMail {
  to: string;
  template: MailTemplate;
  /** The action link (verification, reset or billing URL) carried by the message. */
  link: string;
  sentAt: string;
}

interface Copy {
  subject: string;
  greeting: (name?: string) => string;
  /** A function when the sentence carries data (the billing notices embed a date). */
  intro: string | ((data: MailData) => string);
  button: string;
  fallback: string;
  expires: string;
  ignore: string;
}

const COPY: Record<MailTemplate, Record<MailLocale, Copy>> = {
  verify: {
    en: {
      subject: 'Verify your email address',
      greeting: (n) => (n ? `Hi ${n},` : 'Hi,'),
      intro: 'Welcome to Mockia. Confirm that this is your email address to unlock AI generation and billing.',
      button: 'Verify email',
      fallback: 'If the button does not work, copy this link into your browser:',
      expires: 'The link works once and expires in 24 hours.',
      ignore: 'If you did not create an account, you can ignore this message.',
    },
    es: {
      subject: 'Verifica tu correo electrónico',
      greeting: (n) => (n ? `Hola ${n},` : 'Hola,'),
      intro: 'Te damos la bienvenida a Mockia. Confirma que este es tu correo para desbloquear la generación con IA y la facturación.',
      button: 'Verificar correo',
      fallback: 'Si el botón no funciona, copia este enlace en tu navegador:',
      expires: 'El enlace funciona una sola vez y caduca en 24 horas.',
      ignore: 'Si no has creado una cuenta, puedes ignorar este mensaje.',
    },
    zh: {
      subject: '验证你的邮箱地址',
      greeting: (n) => (n ? `你好 ${n}，` : '你好，'),
      intro: '欢迎使用 Mockia。请确认这是你的邮箱地址，以解锁 AI 生成和付费功能。',
      button: '验证邮箱',
      fallback: '如果按钮无法使用，请将以下链接复制到浏览器中：',
      expires: '该链接只能使用一次，24 小时后失效。',
      ignore: '如果你没有创建账户，请忽略此邮件。',
    },
  },
  reset: {
    en: {
      subject: 'Reset your Mockia password',
      greeting: (n) => (n ? `Hi ${n},` : 'Hi,'),
      intro: 'We received a request to reset your Mockia password. Use the button below to choose a new one.',
      button: 'Reset password',
      fallback: 'If the button does not work, copy this link into your browser:',
      expires: 'The link works once and expires in 30 minutes. Resetting your password signs you out everywhere.',
      ignore: 'If you did not ask for this, ignore this message: your password has not changed.',
    },
    es: {
      subject: 'Restablece tu contraseña de Mockia',
      greeting: (n) => (n ? `Hola ${n},` : 'Hola,'),
      intro: 'Hemos recibido una solicitud para restablecer tu contraseña de Mockia. Usa el botón para elegir una nueva.',
      button: 'Restablecer contraseña',
      fallback: 'Si el botón no funciona, copia este enlace en tu navegador:',
      expires: 'El enlace funciona una sola vez y caduca en 30 minutos. Al restablecer la contraseña se cierran todas tus sesiones.',
      ignore: 'Si no lo has solicitado, ignora este mensaje: tu contraseña no ha cambiado.',
    },
    zh: {
      subject: '重置你的 Mockia 密码',
      greeting: (n) => (n ? `你好 ${n}，` : '你好，'),
      intro: '我们收到了重置你的 Mockia 密码的请求。请点击下方按钮设置新密码。',
      button: '重置密码',
      fallback: '如果按钮无法使用，请将以下链接复制到浏览器中：',
      expires: '该链接只能使用一次，30 分钟后失效。重置密码会让你在所有设备上退出登录。',
      ignore: '如果这不是你本人的操作，请忽略此邮件：你的密码没有改变。',
    },
  },
  payment_failed: {
    en: {
      subject: "We couldn't charge your card",
      greeting: (n) => (n ? `Hi ${n},` : 'Hi,'),
      intro: (d) =>
        `We couldn't process your latest Mockia payment. Your plan stays active until ${d.date ?? ''}, and Stripe will retry the charge in the meantime. If it is still unpaid by then, your account moves to the Free plan.`,
      button: 'Update payment method',
      fallback: 'If the button does not work, copy this link into your browser:',
      expires: 'Updating your card (or paying the open invoice) is enough: your plan stays as it is.',
      ignore: 'If you have already fixed it, you can ignore this message.',
    },
    es: {
      subject: 'No hemos podido cobrar tu tarjeta',
      greeting: (n) => (n ? `Hola ${n},` : 'Hola,'),
      intro: (d) =>
        `No hemos podido procesar tu último pago de Mockia. Tu plan sigue activo hasta el ${d.date ?? ''} y Stripe volverá a intentar el cobro mientras tanto. Si para entonces sigue sin pagarse, tu cuenta pasará al plan Free.`,
      button: 'Actualizar método de pago',
      fallback: 'Si el botón no funciona, copia este enlace en tu navegador:',
      expires: 'Basta con actualizar la tarjeta (o pagar la factura pendiente): tu plan se queda como está.',
      ignore: 'Si ya lo has solucionado, puedes ignorar este mensaje.',
    },
    zh: {
      subject: '我们无法从你的银行卡扣款',
      greeting: (n) => (n ? `你好 ${n}，` : '你好，'),
      intro: (d) =>
        `我们无法处理你最近一次 Mockia 付款。你的套餐将保留到 ${d.date ?? ''}，期间 Stripe 会重新尝试扣款。如果届时仍未支付，你的账户将转为 Free 套餐。`,
      button: '更新付款方式',
      fallback: '如果按钮无法使用，请将以下链接复制到浏览器中：',
      expires: '只需更新银行卡（或支付未付账单），你的套餐就会保持不变。',
      ignore: '如果你已经处理好了，请忽略此邮件。',
    },
  },
  trial_will_end: {
    en: {
      subject: 'Your Mockia trial ends soon',
      greeting: (n) => (n ? `Hi ${n},` : 'Hi,'),
      intro: (d) =>
        `Your free trial ends on ${d.date ?? ''}. After that your subscription is charged automatically, unless you cancel before then.`,
      button: 'Manage subscription',
      fallback: 'If the button does not work, copy this link into your browser:',
      expires: 'You can cancel at any time before the trial ends and you will not be charged.',
      ignore: 'If you want to keep your plan, you do not need to do anything.',
    },
    es: {
      subject: 'Tu prueba de Mockia termina pronto',
      greeting: (n) => (n ? `Hola ${n},` : 'Hola,'),
      intro: (d) =>
        `Tu prueba gratuita termina el ${d.date ?? ''}. A partir de entonces tu suscripción se cobrará automáticamente, salvo que la canceles antes.`,
      button: 'Gestionar suscripción',
      fallback: 'Si el botón no funciona, copia este enlace en tu navegador:',
      expires: 'Puedes cancelar en cualquier momento antes de que termine la prueba y no se te cobrará.',
      ignore: 'Si quieres conservar tu plan, no tienes que hacer nada.',
    },
    zh: {
      subject: '你的 Mockia 试用即将结束',
      greeting: (n) => (n ? `你好 ${n}，` : '你好，'),
      intro: (d) => `你的免费试用将于 ${d.date ?? ''} 结束。之后将自动扣费，除非你在此之前取消。`,
      button: '管理订阅',
      fallback: '如果按钮无法使用，请将以下链接复制到浏览器中：',
      expires: '你可以在试用结束前随时取消，不会产生任何扣费。',
      ignore: '如果你想保留当前套餐，无需任何操作。',
    },
  },
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Locale of an email: anything that is not en/es/zh falls back to English. */
export function resolveMailLocale(value: string | undefined): MailLocale {
  return MAIL_LOCALES.find((l) => l === value) ?? 'en';
}

/** Renders the subject, plain-text and HTML body of a template. Pure: no I/O. */
export function renderMail(template: MailTemplate, data: MailData): RenderedMail {
  const locale = resolveMailLocale(data.locale);
  const copy = COPY[template][locale];
  const greeting = copy.greeting(data.username);
  const link = data.link;
  const intro = typeof copy.intro === 'function' ? copy.intro(data) : copy.intro;

  const text = [greeting, '', intro, '', link, '', copy.expires, copy.ignore, ''].join('\n');
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2330">',
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>${escapeHtml(intro)}</p>`,
    `<p style="margin:28px 0"><a href="${escapeHtml(link)}" style="background:#6d28d9;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(copy.button)}</a></p>`,
    `<p style="font-size:13px;color:#555b6e">${escapeHtml(copy.fallback)}<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
    `<p style="font-size:13px;color:#555b6e">${escapeHtml(copy.expires)}</p>`,
    `<p style="font-size:13px;color:#555b6e">${escapeHtml(copy.ignore)}</p>`,
    '</div>',
  ].join('');

  return { locale, subject: copy.subject, text, html };
}

// ---------------------------------------------------------------------------------------------------------------------
// In-memory outbox (tests and the e2e suite)
// ---------------------------------------------------------------------------------------------------------------------

const outbox: OutboxEntry[] = [];

/**
 * True when emails may be captured in the in-memory outbox: NODE_ENV=test, or E2E_EXPOSE_MAIL_OUTBOX=true.
 * Never in production (assertProdConfig also refuses to boot with the flag set there).
 */
export function isOutboxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return env.NODE_ENV === 'test' || env.E2E_EXPOSE_MAIL_OUTBOX === 'true';
}

export function getTestOutbox(): readonly OutboxEntry[] {
  return outbox;
}

export function clearTestOutbox(): void {
  outbox.length = 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------------------------------------

const DEFAULT_FROM = 'Mockia.io <no-reply@mockia.io>';

let cached: { url: string; transport: Transporter } | undefined;
function transportFor(url: string): Transporter {
  if (!cached || cached.url !== url) cached = { url, transport: nodemailer.createTransport(url) };
  return cached.transport;
}

/**
 * Sends a transactional email. Resolves without sending when no SMTP_URL is configured (see the file header);
 * rejects when the SMTP server refuses the message, so callers decide whether that matters
 * (register and forgot swallow it: they must not fail, or reveal anything, because of mail).
 */
export async function sendMail(to: string, template: MailTemplate, data: MailData): Promise<void> {
  const rendered = renderMail(template, data);
  const smtpUrl = process.env.SMTP_URL?.trim();

  // Synchronous on purpose: callers that do not await sendMail still see the message in the outbox right away
  if (isOutboxEnabled()) {
    outbox.push({ ...rendered, to, template, link: data.link, sentAt: new Date().toISOString() });
  }

  if (smtpUrl) {
    await transportFor(smtpUrl).sendMail({
      from: process.env.MAIL_FROM?.trim() || DEFAULT_FROM,
      to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    // No address, no link, no token in the log: only the fact that mail is not configured
    console.error(`[Mailer] SMTP_URL is not set: the "${template}" email was NOT sent. Configure SMTP_URL and MAIL_FROM.`);
    return;
  }
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Mailer] SMTP_URL is not set. "${template}" email for ${to}: ${data.link}`);
  }
}
