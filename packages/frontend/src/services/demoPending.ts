/**
 * La demo que el visitante QUIERE conservar al registrarse: su id publico y el secreto de reclamo (`claimToken`, que el
 * servidor entrega una sola vez, en la respuesta de generar). Es el unico sitio de la demo que toca el almacenamiento del
 * navegador, y solo escribe cuando el visitante pulsa el boton de guardar el proyecto (nunca al generar). Vive en
 * sessionStorage, no en la URL: se borra al reclamar la demo, al comprobar que ya no existe y al cerrar la pestana. Los
 * textos legales (Privacidad y Cookies, seccion "demo") lo declaran tal cual.
 *
 * El id publico va en la URL del mock y puede compartirse; solo el secreto permite reclamar. Por eso se guardan juntos
 * como JSON `{ demoId, claimToken }` y una entrada que no tenga exactamente esa forma (el formato anterior, que guardaba
 * solo el id, o un valor manipulado a mano) se ignora y se borra.
 *
 * Todo va en try/catch: sin almacenamiento (modo privado, bloqueado) la demo se pierde al navegar, nada se rompe.
 */
const KEY = 'mockia_demo_pending';
const HEX_128 = /^[0-9a-f]{32}$/;

export interface PendingDemo {
  demoId: string;
  claimToken: string;
}

/** Guarda la demo para reclamarla tras el registro. Solo debe llamarse desde la accion explicita de guardar. */
export function rememberPendingDemo(demoId: string, claimToken: string): void {
  if (!HEX_128.test(demoId) || !HEX_128.test(claimToken)) return;
  try {
    const entry: PendingDemo = { demoId, claimToken };
    window.sessionStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    // sin almacenamiento: no hay nada que recordar
  }
}

/** La demo pendiente, o null. Una entrada con otra forma (formato antiguo, manipulada) se ignora y se borra. */
export function readPendingDemo(): PendingDemo | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const { demoId, claimToken, ...rest } = parsed as Record<string, unknown>;
      if (
        Object.keys(rest).length === 0 &&
        typeof demoId === 'string' &&
        typeof claimToken === 'string' &&
        HEX_128.test(demoId) &&
        HEX_128.test(claimToken)
      ) {
        return { demoId, claimToken };
      }
    }
    window.sessionStorage.removeItem(KEY);
    return null;
  } catch {
    clearPendingDemo();
    return null;
  }
}

export function clearPendingDemo(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // nada que borrar
  }
}
