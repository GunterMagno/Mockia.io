/**
 * Id de la demo que el visitante QUIERE conservar al registrarse. Es el unico sitio de la demo que toca el
 * almacenamiento del navegador, y solo escribe cuando el visitante pulsa el boton de guardar el proyecto (nunca al
 * generar). Vive en sessionStorage, no en la URL: se borra al reclamar la demo, al comprobar que ya no existe y al
 * cerrar la pestana. Los textos legales (Privacidad y Cookies, seccion "demo") lo declaran tal cual.
 *
 * Todo va en try/catch: sin almacenamiento (modo privado, bloqueado) la demo se pierde al navegar, nada se rompe.
 */
const KEY = 'mockia_demo_pending'
const DEMO_ID = /^[0-9a-f]{32}$/

/** Guarda el id para reclamarlo tras el registro. Solo debe llamarse desde la accion explicita de guardar. */
export function rememberPendingDemo(demoId: string): void {
  if (!DEMO_ID.test(demoId)) return
  try {
    window.sessionStorage.setItem(KEY, demoId)
  } catch {
    // sin almacenamiento: no hay nada que recordar
  }
}

/** El id pendiente, o null. Un valor que no parece un id (manipulado a mano) se ignora y se borra. */
export function readPendingDemo(): string | null {
  try {
    const value = window.sessionStorage.getItem(KEY)
    if (value === null) return null
    if (DEMO_ID.test(value)) return value
    window.sessionStorage.removeItem(KEY)
    return null
  } catch {
    return null
  }
}

export function clearPendingDemo(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    // nada que borrar
  }
}
