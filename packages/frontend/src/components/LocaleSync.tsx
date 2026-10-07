import { useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n, type Locale } from '../i18n/I18nProvider'
import { saveLocalePreference } from '../services/preferences'

/**
 * Sincroniza el idioma de la interfaz con el de la cuenta. No pinta nada.
 *
 * Prioridad: idioma del usuario (servidor) > preferencia guardada en el navegador > idioma del navegador > ingles.
 * - Al aparecer un usuario (inicio de sesion o sesion recuperada al cargar): si su cuenta tiene idioma y es otro, se aplica
 *   (setLocale tambien lo guarda en el navegador para la proxima visita anonima); si la cuenta no tiene ninguno
 *   (cuentas anteriores a esta funcion) se envia el actual una vez.
 * - Despues, cada cambio de idioma hecho con la sesion iniciada se guarda en segundo plano.
 */
export const LocaleSync: React.FC = () => {
  const { user } = useAuth()
  const { locale, setLocale } = useI18n()
  const syncedUserId = useRef<string | null>(null)
  // Ultimo idioma que el servidor tiene (o que ya se le ha enviado)
  const serverLocale = useRef<Locale | undefined>(undefined)

  useEffect(() => {
    if (!user) {
      syncedUserId.current = null
      serverLocale.current = undefined
      return
    }

    if (syncedUserId.current !== user.id) {
      syncedUserId.current = user.id
      if (user.locale) {
        // El servidor manda: se aplica y, una vez cargado el diccionario, `locale` coincidira y no se reenvia nada
        serverLocale.current = user.locale
        if (user.locale !== locale) void setLocale(user.locale)
        return
      }
      serverLocale.current = locale
      saveLocalePreference(locale)
      return
    }

    if (locale !== serverLocale.current) {
      serverLocale.current = locale
      saveLocalePreference(locale)
    }
  }, [user, locale, setLocale])

  return null
}

export default LocaleSync
