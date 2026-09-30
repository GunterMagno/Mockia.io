import { matchPath } from 'react-router-dom'

/** Unica fuente de verdad de rutas: App, Header y los enlaces las importan de aqui. */
export const PATHS = {
  home: '/',
  login: '/login',
  signup: '/signup',
  terms: '/terms',
  privacy: '/privacy',
  dashboard: '/dashboard',
  billing: '/billing',
  editorPattern: '/editor/:id',
  editor: (slug: string) => `/editor/${slug}`,
} as const

/** Publicas: accesibles sin cuenta (el home muestra como funciona la app). */
const PUBLIC = [PATHS.home, PATHS.login, PATHS.signup, PATHS.terms, PATHS.privacy]
/** Requieren cuenta: solo estas piden login. */
const PROTECTED = [PATHS.dashboard, PATHS.billing, PATHS.editorPattern]

const matches = (patterns: string[], path: string) =>
  patterns.some((pattern) => matchPath({ path: pattern, end: true }, path))

export const isProtectedPath = (path: string) => matches(PROTECTED, path)
export const isKnownPath = (path: string) => isProtectedPath(path) || matches(PUBLIC, path)
/** Destino tras login/registro: la pagina protegida que se pedia, o el dashboard. */
export const postLoginTarget = (state: unknown): string => {
  const from = (state as { from?: { pathname?: string; search?: string } } | null)?.from
  return from?.pathname && isProtectedPath(from.pathname) ? from.pathname + (from.search ?? '') : PATHS.dashboard
}
export const isAuthPath = (path: string) => path === PATHS.login || path === PATHS.signup
