import { solvePow, type PowResult } from './pow'

/**
 * Web Worker de la prueba de trabajo: el calculo corre fuera del hilo principal, asi la pagina (barra de progreso,
 * boton de cancelar) sigue respondiendo. Entrada `{ challenge, bits }`, salida `{ nonce }` o `{ error }`.
 * Para cancelar, la pagina llama a `worker.terminate()`; no hace falta protocolo de cancelacion.
 */
export interface PowWorkerRequest {
  challenge: string
  bits: number
}
export type PowWorkerResponse = PowResult

// El proyecto compila con la libreria DOM (no WebWorker): se tipa solo lo que se usa del ambito del worker
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PowWorkerRequest>) => void) | null
  postMessage: (message: PowWorkerResponse) => void
}

scope.onmessage = async (event) => {
  const { challenge, bits } = event.data
  // Una promesa rechazada dentro de onmessage NO llega a `worker.onerror` de la pagina: se contesta siempre
  let result: PowWorkerResponse
  try {
    result = await solvePow(challenge, bits)
  } catch {
    result = { error: 'failed' }
  }
  scope.postMessage(result)
}
