import type { RequiredLegalField } from '@mockia/shared'

/**
 * Forma de los textos legales. Cada idioma (es, en, zh) exporta un `LegalContent`; `LegalDocument` los pinta todos igual.
 *
 * Marcado dentro de los textos (lo resuelve LegalDocument al renderizar):
 *  - `{entity.name}`, `{entity.nif}`, `{entity.address}`, `{entity.email}`, `{entity.registry}`: datos del titular.
 *    Si faltan se ve un marcador visible. Un parrafo o elemento de lista que use `{entity.registry}` se omite si no hay registro.
 *  - `**negrita**` y `[texto](destino)`; el destino puede ser una ruta interna (/terms), https://... o mailto:...
 */
export type LegalDocKey = 'legal' | 'privacy' | 'terms' | 'cookies'

export type LegalBlock =
  | { p: string }
  | { ul: string[] }
  | { table: { head: string[]; rows: string[][] } }

export interface LegalSection {
  heading: string
  blocks: LegalBlock[]
}

export interface LegalDocContent {
  title: string
  sections: LegalSection[]
}

export interface LegalContent {
  /** Etiqueta antes de la fecha: "Ultima actualizacion". */
  updatedLabel: string
  /** Aviso de borrador pendiente de revision juridica. */
  draftNotice: string
  /** Marcadores que se muestran cuando falta un dato del titular. */
  placeholders: Record<RequiredLegalField, string>
  /** Titulo de la lista de enlaces a los otros documentos. */
  otherDocuments: string
  docs: Record<LegalDocKey, LegalDocContent>
}
