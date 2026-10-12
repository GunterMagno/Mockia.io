import { NotificationType } from '@mockia/shared';
import { createNotification } from '../../services/notification.service.js';
import { resolveMailLocale, sendMail, type MailLocale } from '../../services/mailer.js';
import { appBaseUrl } from '../auth/passwordReset.js';
import { UserModel } from '../../models/User.js';

/**
 * Security notices when a user adds or removes an AI key: an in-app notification and an email, in the user's language.
 *
 * The notice names the provider and the label the user chose (so they can recognise their own action, or spot someone
 * else's) and NEVER the key, not even its last characters. Nothing here may fail the request: the credential is already
 * stored (or gone) by then. Failures are logged without the address, the label or any detail of the cause.
 */

const LINK_PATH = '/dashboard';

type Text = (provider: string, label: string) => { title: string; message: string };

const TEXT: Record<'added' | 'removed', Record<MailLocale, Text>> = {
  added: {
    en: (provider, label) => ({
      title: 'AI key added',
      message: `A ${provider} API key named "${label}" was added to your account. If this was not you, remove it and change your password.`,
    }),
    es: (provider, label) => ({
      title: 'Clave de IA añadida',
      message: `Se ha añadido a tu cuenta una clave de API de ${provider} llamada "${label}". Si no has sido tú, elimínala y cambia tu contraseña.`,
    }),
    zh: (provider, label) => ({
      title: '已添加 AI 密钥',
      message: `你的账户添加了一个名为“${label}”的 ${provider} API 密钥。如果这不是你本人的操作，请删除它并更改密码。`,
    }),
  },
  removed: {
    en: (provider, label) => ({
      title: 'AI key removed',
      message: `The ${provider} API key named "${label}" was removed from your account. If this was not you, change your password.`,
    }),
    es: (provider, label) => ({
      title: 'Clave de IA eliminada',
      message: `Se ha eliminado de tu cuenta la clave de API de ${provider} llamada "${label}". Si no has sido tú, cambia tu contraseña.`,
    }),
    zh: (provider, label) => ({
      title: '已删除 AI 密钥',
      message: `你的账户删除了名为“${label}”的 ${provider} API 密钥。如果这不是你本人的操作，请更改密码。`,
    }),
  },
};

async function notify(
  kind: 'added' | 'removed',
  userId: string,
  provider: string,
  label: string
): Promise<void> {
  try {
    const user = await UserModel.findById(userId).select('email username locale').lean();
    if (!user) return;
    const locale = resolveMailLocale(user.locale ?? undefined);
    const text = TEXT[kind][locale](provider, label);
    const results = await Promise.allSettled([
      sendMail(user.email, kind === 'added' ? 'ai_key_added' : 'ai_key_removed', {
        link: `${appBaseUrl()}${LINK_PATH}`,
        ...(user.username && { username: user.username }),
        locale,
        provider,
        label,
      }),
      createNotification({
        userId,
        type: NotificationType.SYSTEM,
        title: text.title,
        message: text.message,
        link: LINK_PATH,
      }),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') {
        // Class and code only: an SMTP message usually quotes the recipient's address
        const reason = r.reason as { name?: unknown; code?: unknown } | undefined;
        const kindName = r.reason instanceof Error ? r.reason.name : 'unknown error';
        const code =
          typeof reason?.code === 'string' || typeof reason?.code === 'number'
            ? ` (${reason.code})`
            : '';
        console.error(`[Byok] ${kind} notice failed: ${kindName}${code}`);
      }
    }
  } catch {
    console.error(`[Byok] ${kind} notice failed`);
  }
}

export const notifyKeyAdded = (userId: string, provider: string, label: string) =>
  notify('added', userId, provider, label);

export const notifyKeyRemoved = (userId: string, provider: string, label: string) =>
  notify('removed', userId, provider, label);
