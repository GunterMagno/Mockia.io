import { readLegalEntity, missingLegalFields, type LegalEntity } from '@mockia/shared'

/** Titular del servicio. Vite incrusta VITE_LEGAL_* en el bundle; en produccion el build falla si faltan (vite.config.ts). */
export const LEGAL_ENTITY: LegalEntity = readLegalEntity(import.meta.env as Record<string, string | undefined>)

/** Fecha de la ultima revision de los cuatro documentos (ISO, UTC). Cambiarla al editar cualquier texto. */
export const LEGAL_LAST_UPDATED = '2026-10-09'

/**
 * Los textos son un BORRADOR hasta que los revise un abogado: se avisa en cualquier build que no sea de produccion
 * y en uno de produccion que aun use marcadores (CI/pruebas). Un build de produccion con datos reales no lo muestra.
 */
export const SHOW_LEGAL_DRAFT_NOTICE: boolean =
  import.meta.env.MODE !== 'production' || missingLegalFields(LEGAL_ENTITY).length > 0
