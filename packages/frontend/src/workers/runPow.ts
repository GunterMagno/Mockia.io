import { POW_MAX_MS, hasSubtleCrypto, solvePow, type PowResult } from './pow'
import type { PowWorkerRequest } from './powWorker'

export interface PowRun {
  promise: Promise<PowResult>
  /** Para el calculo ya (termina el worker) y resuelve la promesa con `{ error: 'aborted' }`. */
  cancel: () => void
}

/** Margen sobre el tope del propio worker: si ni asi contesta, el hilo principal lo corta. */
const GUARD_EXTRA_MS = 5_000

/**
 * Resuelve la prueba de trabajo en un Web Worker. La URL del worker tiene que escribirse asi, literal, para que Vite
 * lo empaquete como un fichero aparte. La promesa SIEMPRE se resuelve (nunca deja la barra girando):
 *  - sin `crypto.subtle` (contexto no seguro) se contesta `unsupported` sin crear nada;
 *  - un temporizador de guarda en el hilo principal aplica el tope de 60 s aunque el worker no conteste;
 *  - si el navegador no puede crear el worker (o este falla al arrancar) se calcula en el hilo principal.
 */
export function runPow(challenge: string, bits: number): PowRun {
  if (!hasSubtleCrypto()) return { promise: Promise.resolve({ error: 'unsupported' }), cancel: () => undefined }

  const request: PowWorkerRequest = { challenge, bits }
  let worker: Worker | null = null
  try {
    worker = new Worker(new URL('./powWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    worker = null
  }

  if (!worker) {
    const controller = new AbortController()
    return {
      promise: solvePow(challenge, bits, { signal: controller.signal }).catch((): PowResult => ({ error: 'failed' })),
      cancel: () => controller.abort(),
    }
  }

  const running = worker
  let fallback: AbortController | null = null
  let guard: ReturnType<typeof setTimeout> | undefined
  let settle: (result: PowResult) => void = () => undefined
  const promise = new Promise<PowResult>((resolve) => {
    settle = (result) => {
      clearTimeout(guard)
      running.terminate()
      resolve(result)
    }
  })
  guard = setTimeout(() => settle({ error: 'timeout' }), POW_MAX_MS + GUARD_EXTRA_MS)
  running.onmessage = (event: MessageEvent<PowResult>) => settle(event.data ?? { error: 'failed' })
  running.onmessageerror = () => settle({ error: 'failed' })
  // Un worker que no arranca (CSP, fichero no servido...) no debe dejar la barra girando para siempre
  running.onerror = () => {
    running.terminate()
    fallback = new AbortController()
    solvePow(challenge, bits, { signal: fallback.signal })
      .catch((): PowResult => ({ error: 'failed' }))
      .then(settle)
  }
  running.postMessage(request)
  return {
    promise,
    cancel: () => {
      fallback?.abort()
      settle({ error: 'aborted' })
    },
  }
}
