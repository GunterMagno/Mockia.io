/**
 * Datos del titular del servicio (responsable del tratamiento y prestador, LSSI art. 10 / RGPD art. 13).
 *
 * Un unico lector sirve al frontend (variables VITE_LEGAL_*, que Vite incrusta en el bundle) y al backend
 * (LEGAL_*, p. ej. para la facturacion de Stripe). Los valores NO viven en el codigo: los pone quien despliega.
 */

export interface LegalEntity {
  /** Razon social o nombre y apellidos del titular. */
  name: string;
  /** NIF / CIF. */
  nif: string;
  /** Domicilio completo. */
  address: string;
  /** Email de contacto (tambien para ejercer derechos RGPD). */
  email: string;
  /** Datos registrales (p. ej. Registro Mercantil), solo si el titular los tiene. */
  registry?: string;
}

/** Campos sin los que un despliegue de produccion no puede publicarse. `registry` es opcional. */
export const REQUIRED_LEGAL_FIELDS = ['name', 'nif', 'address', 'email'] as const;
export type RequiredLegalField = (typeof REQUIRED_LEGAL_FIELDS)[number];

type Env = Record<string, string | undefined>;

/**
 * Lee la entidad de un objeto de entorno (`import.meta.env`, `process.env`...).
 * `prefix` + NAME|NIF|ADDRESS|EMAIL|REGISTRY. Los espacios sobrantes se recortan; vacio = sin dato.
 */
export function readLegalEntity(env: Env, prefix = 'VITE_LEGAL_'): LegalEntity {
  const get = (key: string): string => String(env[`${prefix}${key}`] ?? '').trim();
  const registry = get('REGISTRY');
  return {
    name: get('NAME'),
    nif: get('NIF'),
    address: get('ADDRESS'),
    email: get('EMAIL'),
    ...(registry ? { registry } : {}),
  };
}

/** Campos obligatorios que estan vacios. */
export function missingLegalFields(entity: LegalEntity): RequiredLegalField[] {
  return REQUIRED_LEGAL_FIELDS.filter((field) => entity[field].trim() === '');
}

/**
 * Mensaje de error para un build de produccion con datos del titular incompletos, o null si puede continuar.
 * Continua si estan los cuatro datos, o si se permite expresamente el marcador (`<prefix>ALLOW_PLACEHOLDER=1`,
 * pensado para los jobs de CI que solo comprueban que compila).
 */
export function legalConfigProblem(env: Env, prefix = 'VITE_LEGAL_'): string | null {
  const missing = missingLegalFields(readLegalEntity(env, prefix));
  if (missing.length === 0) return null;
  if (env[`${prefix}ALLOW_PLACEHOLDER`] === '1') return null;
  const vars = missing.map((field) => `${prefix}${field.toUpperCase()}`).join(', ');
  return (
    `Faltan los datos legales del titular (${vars}). Las paginas de Aviso Legal y Privacidad los publican y la ley ` +
    `(LSSI art. 10, RGPD art. 13) los exige: definelos antes de compilar para produccion. ` +
    `Solo para CI o pruebas, ${prefix}ALLOW_PLACEHOLDER=1 permite compilar con marcadores visibles.`
  );
}
