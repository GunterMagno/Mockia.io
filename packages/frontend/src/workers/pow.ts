/**
 * Prueba de trabajo (hashcash) de la demo publica. El servidor entrega un reto firmado; hay que encontrar un `nonce`
 * tal que SHA-256(`${reto}:${nonce}`) empiece por `bits` bits a cero. Mismo calculo que `verifyProof` del backend.
 *
 * Es logica pura (sin DOM ni `self`) para poder probarla; `powWorker.ts` solo la envuelve en un Web Worker para que
 * el hilo principal no se bloquee.
 */

/** Tope de tiempo de resolucion: pasado este plazo se abandona y la pagina lo explica. */
export const POW_MAX_MS = 60_000

/** Cuantos hashes se lanzan a la vez: `crypto.subtle.digest` es asincrono y asi se amortiza su coste por llamada. */
const BATCH = 256

/** `unsupported`: no hay `crypto.subtle` (contexto no seguro: http fuera de localhost); `failed`: el calculo fallo por otra causa. */
export type PowResult = { nonce: string } | { error: 'timeout' | 'aborted' | 'unsupported' | 'failed' }

export interface PowOptions {
  /** Plazo maximo en ms (60 000 por defecto). */
  maxMs?: number
  /** Cancelacion desde fuera. */
  signal?: AbortSignal
  /** Se llama tras cada lote con el total de intentos (para mostrar actividad, no un porcentaje: no se puede predecir). */
  onProgress?: (tries: number) => void
}

/** Bits a cero al comienzo del hash. */
export function leadingZeroBits(digest: Uint8Array): number {
  let zeros = 0
  for (const byte of digest) {
    if (byte === 0) {
      zeros += 8
      continue
    }
    return zeros + Math.clz32(byte) - 24
  }
  return zeros
}

export async function solvePow(challenge: string, bits: number, options: PowOptions = {}): Promise<PowResult> {
  const { maxMs = POW_MAX_MS, signal, onProgress } = options
  if (!hasSubtleCrypto()) return { error: 'unsupported' }
  try {
    return await search(challenge, bits, maxMs, signal, onProgress)
  } catch {
    return { error: 'failed' }
  }
}

/** `crypto.subtle` solo existe en contextos seguros (https o localhost). */
export const hasSubtleCrypto = (): boolean => typeof globalThis.crypto?.subtle?.digest === 'function'

async function search(
  challenge: string,
  bits: number,
  maxMs: number,
  signal: AbortSignal | undefined,
  onProgress: ((tries: number) => void) | undefined,
): Promise<PowResult> {
  const encoder = new TextEncoder()
  const started = performance.now()
  let next = 0

  for (;;) {
    if (signal?.aborted) return { error: 'aborted' }
    if (performance.now() - started > maxMs) return { error: 'timeout' }

    const nonces = Array.from({ length: BATCH }, (_, i) => String(next + i))
    const digests = await Promise.all(
      nonces.map((nonce) => crypto.subtle.digest('SHA-256', encoder.encode(`${challenge}:${nonce}`))),
    )
    // El primero del lote que cumple (el lote entero ya se ha calculado: no cuesta mas mirar en orden)
    for (let i = 0; i < digests.length; i += 1) {
      if (leadingZeroBits(new Uint8Array(digests[i])) >= bits) return { nonce: nonces[i] }
    }
    next += BATCH
    onProgress?.(next)
  }
}
