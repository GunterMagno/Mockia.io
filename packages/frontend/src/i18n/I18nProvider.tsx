import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import en, { type Messages } from './locales/en'

/**
 * i18n propio y sin dependencias.
 * - `en` va en el bundle principal (idioma de respaldo); el resto se carga bajo demanda en su propio chunk.
 * - Las claves estan tipadas: `t('landing.hero.cta')` falla en compilacion si la clave no existe,
 *   y cada diccionario se declara como `Messages`, asi que TypeScript exige que tenga todas las claves de `en`.
 * - Para anadir un idioma: crear `locales/<code>.ts`, anadirlo a LOCALES y a LOADERS.
 */

export const LOCALES = [
  { code: 'en', label: 'English', htmlLang: 'en' },
  { code: 'es', label: 'Español', htmlLang: 'es' },
  { code: 'zh', label: '中文', htmlLang: 'zh-CN' },
] as const

export type Locale = (typeof LOCALES)[number]['code']
export const DEFAULT_LOCALE: Locale = 'en'
const STORAGE_KEY = 'mockia_locale'

const LOADERS: Record<Locale, () => Promise<Messages>> = {
  en: async () => en,
  es: () => import('./locales/es').then((m) => m.default),
  zh: () => import('./locales/zh').then((m) => m.default),
}

type Plural = { one: string; other: string }
type Vars = Record<string, string | number>

/** Rutas 'a.b.c' de las hojas de texto (string o plural). */
type TextPath<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | Plural
    ? `${P}${K}`
    : T[K] extends readonly string[]
      ? never
      : TextPath<T[K], `${P}${K}.`>
}[keyof T & string]

/** Rutas de las listas (string[]). */
type ListPath<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends readonly string[]
    ? `${P}${K}`
    : T[K] extends string | Plural
      ? never
      : ListPath<T[K], `${P}${K}.`>
}[keyof T & string]

export type MessageKey = TextPath<Messages>
export type ListKey = ListPath<Messages>
type RichTags = Record<string, (chunk: string) => React.ReactNode>

type I18nContextValue = {
  locale: Locale
  /** Cambia el idioma; resuelve cuando el diccionario esta cargado. */
  setLocale: (next: Locale) => Promise<void>
  t: (key: MessageKey, vars?: Vars) => string
  /** Lista de textos (p. ej. mensajes de progreso rotativos). */
  tl: (key: ListKey) => string[]
  /** Texto con etiquetas simples `<em>…</em>` que se sustituyen por nodos React (sin anidar). */
  rich: (key: MessageKey, tags: RichTags, vars?: Vars) => React.ReactNode[]
  /** Formateadores con el locale activo. */
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined)

const isLocale = (value: unknown): value is Locale => LOCALES.some((l) => l.code === value)
export const htmlLangOf = (locale: Locale) => LOCALES.find((l) => l.code === locale)!.htmlLang

/** Preferencia guardada > idiomas del navegador > ingles. */
export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLocale(saved)) return saved
  } catch {
    // almacenamiento bloqueado: seguimos con el navegador
  }
  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []
  for (const lang of langs) {
    const base = lang?.toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return DEFAULT_LOCALE
}

export const loadMessages = (locale: Locale): Promise<Messages> => LOADERS[locale]()

function lookup(dict: unknown, key: string): unknown {
  let node = dict
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return node
}

const interpolate = (text: string, vars?: Vars) =>
  vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text

const TAG_RE = /<(\w+)>(.*?)<\/\1>/g

type ProviderProps = React.PropsWithChildren<{ initialLocale: Locale; initialMessages: Messages }>

export const I18nProvider: React.FC<ProviderProps> = ({ initialLocale, initialMessages, children }) => {
  const [state, setState] = useState({ locale: initialLocale, messages: initialMessages })
  const { locale, messages } = state

  useEffect(() => {
    document.documentElement.lang = htmlLangOf(locale)
    document.title = messages.meta.title
    document.querySelector('meta[name="description"]')?.setAttribute('content', messages.meta.description)
  }, [locale, messages])

  const setLocale = useCallback(async (next: Locale) => {
    const nextMessages = await loadMessages(next)
    setState({ locale: next, messages: nextMessages })
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // sin persistencia: el cambio vale para esta sesion
    }
  }, [])

  const value = useMemo<I18nContextValue>(() => {
    const plurals = new Intl.PluralRules(htmlLangOf(locale))

    const resolve = (key: string, vars?: Vars): string => {
      const found = lookup(messages, key) ?? lookup(en, key)
      if (typeof found === 'string') return interpolate(found, vars)
      if (found && typeof found === 'object' && 'other' in found) {
        const plural = found as Plural
        const count = Number(vars?.count ?? 0)
        return interpolate(plurals.select(count) === 'one' ? plural.one : plural.other, vars)
      }
      if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`)
      return key
    }

    const rich: I18nContextValue['rich'] = (key, tags, vars) => {
      const text = resolve(key, vars)
      const out: React.ReactNode[] = []
      let last = 0
      for (const m of text.matchAll(TAG_RE)) {
        const [whole, tag, chunk] = m
        if (m.index! > last) out.push(text.slice(last, m.index))
        const render = tags[tag]
        out.push(render ? <React.Fragment key={m.index}>{render(chunk)}</React.Fragment> : chunk)
        last = m.index! + whole.length
      }
      if (last < text.length) out.push(text.slice(last))
      return out
    }

    return {
      locale,
      setLocale,
      t: resolve,
      tl: (key) => {
        const found = lookup(messages, key) ?? lookup(en, key)
        return Array.isArray(found) ? (found as string[]) : []
      },
      rich,
      formatDate: (value, options) => new Intl.DateTimeFormat(htmlLangOf(locale), options).format(new Date(value)),
      formatNumber: (value, options) => new Intl.NumberFormat(htmlLangOf(locale), options).format(value),
    }
  }, [locale, messages, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useI18n = (): I18nContextValue => {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
