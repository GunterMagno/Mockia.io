import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { LegalEntity } from '@mockia/shared'
import { htmlLangOf, useI18n, type Locale } from '../../i18n/I18nProvider'
import { PATHS } from '../../routes/paths'
import { LEGAL_ENTITY, LEGAL_LAST_UPDATED, SHOW_LEGAL_DRAFT_NOTICE } from './legalConfig'
import type { LegalBlock, LegalContent, LegalDocKey } from './legalContent/types'
import styles from './LegalPage.module.scss'

/** Cada idioma es su propio chunk: solo se descarga el que se lee. */
const LOADERS: Record<Locale, () => Promise<LegalContent>> = {
  es: () => import('./legalContent/es').then((m) => m.default),
  en: () => import('./legalContent/en').then((m) => m.default),
  zh: () => import('./legalContent/zh').then((m) => m.default),
}
const cache: Partial<Record<Locale, LegalContent>> = {}

const DOC_PATHS: Record<LegalDocKey, string> = {
  legal: PATHS.legal,
  privacy: PATHS.privacy,
  terms: PATHS.terms,
  cookies: PATHS.cookies,
}
const DOC_ORDER: LegalDocKey[] = ['legal', 'privacy', 'terms', 'cookies']

type EntityField = 'name' | 'nif' | 'address' | 'email' | 'registry'
type Resolved = { text: string; placeholder: boolean }

/** Valor del titular o, si falta, el marcador visible del idioma. `registry` es opcional: vacio = sin dato. */
function resolveField(entity: LegalEntity, content: LegalContent, field: EntityField): Resolved {
  const value = entity[field] ?? ''
  if (value) return { text: value, placeholder: false }
  if (field === 'registry') return { text: '', placeholder: false }
  return { text: content.placeholders[field], placeholder: true }
}

const TOKEN = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\{entity\.(name|nif|address|email|registry)\}/g

function renderInline(text: string, entity: LegalEntity, content: LegalContent, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    const key = `${keyBase}-${n++}`
    const [, bold, code, label, href, field] = m
    if (bold !== undefined) {
      out.push(<strong key={key}>{renderInline(bold, entity, content, key)}</strong>)
    } else if (code !== undefined) {
      out.push(<code key={key}>{code}</code>)
    } else if (field !== undefined) {
      const { text: value, placeholder } = resolveField(entity, content, field as EntityField)
      out.push(
        placeholder ? (
          <span key={key} className={styles.placeholder} data-legal-placeholder>
            {value}
          </span>
        ) : (
          value
        ),
      )
    } else {
      // un enlace construido con un dato que falta (mailto:[marcador]) no se enlaza: se deja solo el texto
      let unresolved = false
      const target = href.replace(/\{entity\.(\w+)\}/g, (_, f: EntityField) => {
        const r = resolveField(entity, content, f)
        unresolved ||= r.placeholder
        return r.text
      })
      const children = renderInline(label, entity, content, key)
      if (unresolved) out.push(<React.Fragment key={key}>{children}</React.Fragment>)
      else if (target.startsWith('/')) out.push(<Link key={key} to={target}>{children}</Link>)
      else if (target.startsWith('http'))
        out.push(
          <a key={key} href={target} target="_blank" rel="noopener noreferrer">
            {children}
          </a>,
        )
      else out.push(<a key={key} href={target}>{children}</a>)
    }
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Un parrafo o elemento que menciona `{entity.registry}` desaparece cuando el titular no tiene datos registrales. */
const dropped = (text: string, entity: LegalEntity) => !entity.registry && text.includes('{entity.registry}')

function renderBlock(block: LegalBlock, i: number, entity: LegalEntity, content: LegalContent): React.ReactNode {
  const inline = (text: string, key: string) => renderInline(text, entity, content, key)
  if ('p' in block) return dropped(block.p, entity) ? null : <p key={i}>{inline(block.p, `p${i}`)}</p>
  if ('ul' in block) {
    return (
      <ul key={i}>
        {block.ul.map((item, j) => (dropped(item, entity) ? null : <li key={j}>{inline(item, `l${i}-${j}`)}</li>))}
      </ul>
    )
  }
  const { head, rows } = block.table
  return (
    <div key={i} className={styles.tableWrap}>
      <table>
        <thead>
          <tr>
            {head.map((h, c) => (
              <th key={c} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} data-label={head[c]}>
                  {inline(cell, `t${i}-${r}-${c}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Pagina legal: mismo diseno y mismas reglas para los cuatro documentos; solo cambia el contenido (legalContent/<idioma>). */
const LegalDocument: React.FC<{ doc: LegalDocKey }> = ({ doc }) => {
  const { locale, formatDate } = useI18n()
  const [loaded, setLoaded] = useState<{ locale: Locale; content: LegalContent } | null>(() =>
    cache[locale] ? { locale, content: cache[locale]! } : null,
  )

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [doc])

  useEffect(() => {
    let alive = true
    const ready = cache[locale]
    if (ready) setLoaded({ locale, content: ready })
    else
      LOADERS[locale]().then((content) => {
        cache[locale] = content
        if (alive) setLoaded({ locale, content })
      })
    return () => {
      alive = false
    }
  }, [locale])

  const content = loaded?.locale === locale ? loaded.content : null
  if (!content) return <article className={styles.legalPage} lang={htmlLangOf(locale)} data-legal={doc} aria-busy="true" />

  const { title, sections } = content.docs[doc]
  return (
    <article className={styles.legalPage} lang={htmlLangOf(locale)} data-legal={doc}>
      <section className={styles.container}>
        {SHOW_LEGAL_DRAFT_NOTICE && (
          <p className={styles.draftNotice} data-legal-draft>
            {content.draftNotice}
          </p>
        )}
        <header className={styles.header}>
          <h1>{title}</h1>
          <p className={styles.lastUpdated} data-legal-updated>
            {content.updatedLabel}:{' '}
            <time dateTime={LEGAL_LAST_UPDATED}>
              {formatDate(`${LEGAL_LAST_UPDATED}T00:00:00Z`, { dateStyle: 'long', timeZone: 'UTC' })}
            </time>
          </p>
        </header>

        <div className={styles.content}>
          {sections.map((section, i) => (
            <section key={i}>
              <h2>
                {i + 1}. {section.heading}
              </h2>
              {section.blocks.map((block, j) => renderBlock(block, j, LEGAL_ENTITY, content))}
            </section>
          ))}
        </div>

        <nav className={styles.otherDocs} aria-label={content.otherDocuments}>
          <h2>{content.otherDocuments}</h2>
          <ul>
            {DOC_ORDER.filter((key) => key !== doc).map((key) => (
              <li key={key}>
                <Link to={DOC_PATHS[key]}>{content.docs[key].title}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </section>
    </article>
  )
}

export default LegalDocument
