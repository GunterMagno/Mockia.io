import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getAdminStatus } from '../services/adminService';

export type AdminStatus = 'checking' | 'admin' | 'not-admin' | 'error';

/**
 * Una sola consulta a /admin/me por usuario y carga de pagina: la promesa vive en el modulo y la comparten la cabecera
 * (enlace del menu) y la pantalla /admin. Sin almacenamiento: una recarga lo vuelve a preguntar. Un fallo no se guarda,
 * asi que reintentar de verdad repite la peticion.
 */
const pending = new Map<string, Promise<boolean>>();
const ask = (userId: string): Promise<boolean> => {
  let promise = pending.get(userId);
  if (!promise) {
    promise = getAdminStatus();
    pending.set(userId, promise);
    promise.catch(() => pending.delete(userId));
  }
  return promise;
};

/**
 * Estado de administrador del usuario con sesion. Sin sesion: 'not-admin' y ninguna peticion. Con `enabled` en false
 * (p. ej. un menu cerrado) no se pregunta nada y el estado sigue en 'checking'.
 */
export function useIsAdmin(enabled = true): { status: AdminStatus; retry: () => void } {
  const { user, isLoading } = useAuth();
  const userId = user?.id ?? null;
  const [status, setStatus] = useState<AdminStatus>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (isLoading || !enabled) return;
    if (!userId) {
      setStatus('not-admin');
      return;
    }
    let live = true;
    setStatus('checking');
    ask(userId).then(
      (isAdmin) => live && setStatus(isAdmin ? 'admin' : 'not-admin'),
      () => live && setStatus('error')
    );
    return () => {
      live = false;
    };
  }, [userId, isLoading, enabled, attempt]);

  const retry = useCallback(() => {
    if (userId) pending.delete(userId);
    setAttempt((n) => n + 1);
  }, [userId]);

  return { status, retry };
}
