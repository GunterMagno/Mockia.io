import axios from 'axios'
import { ErrorCode } from '@mockia/shared'

/**
 * Cliente de la demo publica. A proposito NO usa la instancia `api`: esa adjunta el Bearer, envia cookies y, ante un
 * 401, renueva la sesion y avisa de que ha caducado (lo que acabaria en el login). La demo es anonima: no manda
 * credenciales, no guarda nada en el navegador y un 401/403 no tiene ningun efecto sobre la sesion de nadie.
 */
const baseURL: string = import.meta.env.VITE_API_URL ?? '/api'

const http = axios.create({ baseURL, withCredentials: false, timeout: 90_000 })

type Envelope<T> = { data: T }

export interface DemoStatus {
  available: boolean
  /** Intentos que le quedan hoy a este visitante; null si la demo esta apagada. */
  remainingToday: number | null
  maxEndpoints: number
  ttlMinutes: number
}

export interface DemoChallenge {
  challenge: string
  bits: number
  expiresAt: string
}

export type DemoSource = { type: 'template'; id: DemoTemplateId } | { type: 'text'; text: string }
export const DEMO_TEMPLATE_IDS = ['shop', 'blog', 'users'] as const
export type DemoTemplateId = (typeof DEMO_TEMPLATE_IDS)[number]

/** Limite de texto pegado (el mismo que valida el servidor). */
export const MAX_DEMO_TEXT_CHARS = 6000

export type DemoMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface DemoEndpoint {
  method: DemoMethod
  path: string
  statusCode: number
  body: unknown
}

export interface DemoResult {
  demoId: string
  baseUrl: string
  endpoints: DemoEndpoint[]
  expiresAt: string
  remainingToday: number | null
}

/** Error de la API de la demo ya normalizado: la pagina decide el mensaje a partir de `kind`. */
export type DemoErrorKind =
  | 'unavailable' // 503 DEMO_UNAVAILABLE: apagada, presupuesto global agotado u ocupada
  | 'limit' // 429 DEMO_LIMIT_REACHED: cupo diario de este visitante
  | 'rateLimit' // 429 DEMO_RATE_LIMIT: demasiadas peticiones, esperar un poco
  | 'challenge' // 400 DEMO_CHALLENGE_INVALID
  | 'badOutput' // 502: la IA devolvio algo inutilizable (el intento cuenta)
  | 'timeout' // 504: la IA tardo demasiado (el intento cuenta)
  | 'network' // sin respuesta
  | 'other'

export class DemoApiError extends Error {
  constructor(
    readonly kind: DemoErrorKind,
    readonly status: number | null,
    /** Segundos hasta poder reintentar, de la cabecera Retry-After. */
    readonly retryAfterSeconds: number | null,
  ) {
    super(`demo:${kind}`)
  }
}

const retryAfterOf = (headers: unknown): number | null => {
  const raw = (headers as { get?: (name: string) => unknown } | undefined)?.get?.('retry-after')
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

function toDemoError(err: unknown): DemoApiError {
  if (err instanceof DemoApiError) return err
  if (axios.isAxiosError(err) && err.response) {
    const { status, headers, data } = err.response
    const code = (data as { error?: { code?: string } } | undefined)?.error?.code
    const retry = retryAfterOf(headers)
    if (status === 429) return new DemoApiError(code === ErrorCode.DEMO_LIMIT_REACHED ? 'limit' : 'rateLimit', status, retry)
    if (status === 503) return new DemoApiError('unavailable', status, retry)
    if (status === 400 && code === ErrorCode.DEMO_CHALLENGE_INVALID) return new DemoApiError('challenge', status, retry)
    if (status === 502) return new DemoApiError('badOutput', status, retry)
    if (status === 504) return new DemoApiError('timeout', status, retry)
    return new DemoApiError('other', status, retry)
  }
  return new DemoApiError('network', null, null)
}

async function call<T>(request: Promise<{ data: Envelope<T> }>): Promise<T> {
  try {
    return (await request).data.data
  } catch (err) {
    throw toDemoError(err)
  }
}

export const getDemoStatus = (signal?: AbortSignal) => call(http.get<Envelope<DemoStatus>>('/demo/status', { signal }))

/** El servidor exige Content-Type: application/json tambien aqui: se envia `{}`. */
export const requestDemoChallenge = (signal?: AbortSignal) =>
  call(http.post<Envelope<DemoChallenge>>('/demo/challenge', {}, { signal }))

export const generateDemo = (body: { challenge: string; nonce: string; source: DemoSource }, signal?: AbortSignal) =>
  call(http.post<Envelope<DemoResult>>('/demo/generate', body, { signal }))

/** Los parametros de ruta de un endpoint (`/products/:id` -> ['id']). */
export const pathParams = (path: string): string[] => Array.from(path.matchAll(/:([A-Za-z0-9_]+)/g), (m) => m[1])

/** Ruta real a llamar: cada `:param` se sustituye por su valor (codificado). */
export const fillPath = (path: string, values: Record<string, string>): string =>
  path.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => encodeURIComponent(values[name] ?? ''))

/** Cabeceras de la respuesta que se ensenan en el panel (las demas no aportan en una demo). */
const SHOWN_HEADERS = ['content-type', 'x-mockia-demo', 'x-total-count', 'x-page', 'x-per-page', 'x-next-cursor', 'retry-after']

export interface DemoMockResponse {
  status: number
  headers: Array<[string, string]>
  /** JSON formateado, o el texto tal cual si no era JSON. */
  text: string
}

/** Llamada real al mock efimero (mismo origen, sin credenciales). Un 404/429 del mock tambien se muestra: es la respuesta. */
export async function callDemoMock(
  demoId: string,
  method: DemoMethod,
  path: string,
  signal?: AbortSignal,
): Promise<DemoMockResponse> {
  const hasBody = method !== 'GET' && method !== 'DELETE'
  let res: Response
  try {
    res = await fetch(`${baseURL}/demo-mock/${encodeURIComponent(demoId)}${path}`, {
      method,
      credentials: 'omit',
      cache: 'no-store',
      signal,
      ...(hasBody ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}),
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new DemoApiError('network', null, null)
  }
  const raw = await res.text()
  let text = raw
  try {
    text = JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    // no era JSON: se enseña tal cual
  }
  const headers = SHOWN_HEADERS.flatMap((name): Array<[string, string]> => {
    const value = res.headers.get(name)
    return value === null ? [] : [[name, value]]
  })
  return { status: res.status, headers, text }
}
