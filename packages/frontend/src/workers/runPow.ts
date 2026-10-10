import { solvePow, type PowResult } from './pow'
import type { PowWorkerRequest } from './powWorker'

export interface PowRun {
  promise: Promise<PowResult>
  /** Para el calculo ya (termina el worker) y resuelve la promesa con `{ error: 'aborted' }`. */
  cancel: () => void
}

/**
 * Resuelve la prueba de trabajo en un Web Worker. La URL del worker tiene que escribirse asi, literal, para que Vite
 * lo empaquete como un fichero aparte. Solo si el navegador no puede crear el worker se calcula en el hilo principal
 * (mas lento para la pagina, pero la demo sigue funcionando y el plazo de 60 s y la cancelacion se mantienen).
 */
export function runPow(challenge: string, bits: number): PowRun {
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
      promise: solvePow(challenge, bits, { signal: controller.signal }),
      cancel: () => controller.abort(),
    }
  }

  const running = worker
  let fallback: AbortController | null = null
  let settle: (result: PowResult) => void = () => undefined
  const promise = new Promise<PowResult>((resolve) => {
    settle = (result) => {
      running.terminate()
      resolve(result)
    }
  })
  running.onmessage = (event: MessageEvent<PowResult>) => settle(event.data)
  // Un worker que no arranca (CSP, fichero no servido...) no debe dejar la barra girando para siempre
  running.onerror = () => {
    running.terminate()
    fallback = new AbortController()
    void solvePow(challenge, bits, { signal: fallback.signal }).then(settle)
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
