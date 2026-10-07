import type { MessageKey } from '../i18n/I18nProvider'

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string

/**
 * Mensajes del backend (en ingles) que el usuario ve a menudo, mapeados a su clave i18n.
 * Lo que no esta aqui se muestra tal cual lo manda el servidor.
 */
const KNOWN: ReadonlyArray<readonly [RegExp, MessageKey]> = [
  [/^Backend server is unreachable/i, 'errors.network'],
  [/^Could not (create checkout session|open the billing portal)$/i, 'billing.errors.stripe'],
  [/^Invalid email or password$/i, 'errors.invalidCredentials'],
  [/is already registered$/i, 'errors.emailTaken'],
  [/^Too many requests/i, 'errors.tooManyRequests'],
  [/^Project not found$/i, 'errors.projectNotFound'],
  [/^Endpoint not found$/i, 'errors.endpointNotFound'],
  [/^User not found$/i, 'errors.userNotFound'],
  [/^You do not have access to this project$/i, 'errors.noProjectAccess'],
  [/^User is already a member of this project$/i, 'errors.alreadyMember'],
  [/^Owners cannot leave the project/i, 'errors.ownerCannotLeave'],
  [/^Invalid GitHub URL format$/i, 'errors.invalidGithubUrl'],
  [/^Invalid or expired refresh token$/i, 'errors.sessionExpired'],
  // Joi (mismos textos que la validacion del frontend)
  [/^Email must be valid$/i, 'validation.emailInvalid'],
  [/^Email is required$/i, 'validation.emailRequired'],
  [/^Email or Username is required$/i, 'validation.emailOrUsernameRequired'],
  [/^(New )?password must be at least 10 characters$/i, 'validation.passwordMin'],
  [/^(New )?password cannot exceed 128 characters$/i, 'validation.passwordMax'],
  [/^Invalid or expired token$/i, 'errors.invalidToken'],
  [/^Password is required$/i, 'validation.passwordRequired'],
  [/^Username must be at least 2 characters$/i, 'validation.usernameMin'],
  [/^Username is required$/i, 'validation.usernameRequired'],
]

const translateKnown = (message: string, t: Translate): string => {
  const hit = KNOWN.find(([re]) => re.test(message.trim()))
  return hit ? t(hit[1]) : message
}

const PLAN_NAMES: Record<string, string> = { free: 'Free', pro: 'Pro', team: 'Team' }

/** Errores de facturacion con codigo propio: sus details son datos (plan, limite), no mensajes. */
function billingError(code: unknown, details: any, t: Translate): string | null {
  switch (code) {
    case 'PLAN_LIMIT_REACHED':
      return t('billing.errors.limitReached', { plan: PLAN_NAMES[details?.plan] ?? String(details?.plan ?? ''), limit: details?.limit ?? '' })
    case 'ALREADY_SUBSCRIBED':
      return t('billing.errors.alreadySubscribed')
    case 'NO_BILLING_ACCOUNT':
      return t('billing.errors.noAccount')
    case 'BILLING_NOT_CONFIGURED':
      return t('billing.errors.notConfigured')
    default:
      return null
  }
}

/** Codigo de error de la API ('PLAN_LIMIT_REACHED'...), si lo hay. */
export const getBackendErrorCode = (err: any): string | undefined => err?.response?.data?.error?.code

export function getBackendErrorMessage(err: any, t: Translate): string {
  // Axios error with response payload
  if (err?.response?.data) {
    const data = err.response.data

    if (data?.error?.code === 'EMAIL_NOT_VERIFIED') return t('errors.emailNotVerified')

    const billing = billingError(data?.error?.code, data?.error?.details, t)
    if (billing) return billing
    
    // 1. Try normalized error structure: { error: { message: "...", details: { ... } } }
    if (data?.error?.message && typeof data.error.message === 'string') {
      // Validation error with details: the details are what the user needs to read
      if (data.error.details && typeof data.error.details === 'object') {
        const messages = Object.values(data.error.details)
          .flat()
          .filter((m): m is string => typeof m === 'string')
        if (messages.length > 0) {
          return messages.map((m) => translateKnown(m, t)).join(', ')
        }
      }
      return translateKnown(data.error.message, t)
    }

    // 2. Try simple message property: { message: "..." }
    if (data?.message && typeof data.message === 'string') {
      return translateKnown(data.message, t)
    }

    // 3. Try legacy error property: { error: "..." }
    if (data?.error && typeof data.error === 'string') {
      return translateKnown(data.error, t)
    }

    // 4. Try array of messages (e.g. class-validator)
    if (Array.isArray(data)) {
      const msgs = data.map((d) => (typeof d?.message === 'string' ? translateKnown(d.message, t) : String(d)))
      if (msgs.length) return msgs.join('; ')
    }

    // 5. Try string body
    if (typeof data === 'string' && data.length > 0 && data.length < 200) {
      return data
    }
  }

  // Network/Timeout errors
  if (err?.code === 'ECONNREFUSED' || err?.code === 'ERR_NETWORK') {
    return t('errors.network')
  }

  // Status-based fallbacks if no data payload
  const status = err?.response?.status
  if (status) {
    if (status === 401) return t('errors.unauthorized')
    if (status === 403) return t('errors.forbidden')
    if (status === 404) return t('errors.notFound')
    if (status === 429) return t('errors.tooManyRequests')
    if (status >= 400 && status < 500) return t('errors.request', { status })
    if (status >= 500) return t('errors.server', { status })
  }

  return t('errors.unexpected')
}

export default getBackendErrorMessage
