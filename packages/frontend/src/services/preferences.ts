import type { Locale as SharedLocale } from '@mockia/shared'
import type { Locale } from '../i18n/I18nProvider'
import { api } from './api'

// El idioma del frontend y el que acepta el backend son la misma union: si se desalinean, esto deja de compilar
type SameLocales = [Locale] extends [SharedLocale] ? ([SharedLocale] extends [Locale] ? true : never) : never
export const LOCALES_MATCH_BACKEND: SameLocales = true

/**
 * Guarda el idioma preferido en la cuenta (PATCH /users/me/preferences).
 *
 * Es "dispara y olvida": nunca lanza ni bloquea la interfaz. Sin red o con un error del servidor el idioma sigue
 * aplicado en el navegador (localStorage) y se vuelve a enviar en el siguiente inicio de sesion si el servidor no lo tiene.
 */
export function saveLocalePreference(locale: Locale): void {
  api.patch('/users/me/preferences', { locale }).catch(() => {
    // ignorado a proposito
  })
}
