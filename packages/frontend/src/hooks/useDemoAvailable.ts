import { useEffect, useState } from 'react'
import { fetchDemoAvailability } from '../services/demoService'

/**
 * Una sola peticion por carga de pagina: la promesa vive en el modulo y la comparten la cabecera y la landing (y
 * cualquier cambio de ruta dentro de la app). Sin almacenamiento: una recarga la vuelve a preguntar.
 */
let pending: Promise<boolean> | null = null
const availability = (): Promise<boolean> => (pending ??= fetchDemoAvailability())

/** `null` mientras se pregunta; despues `true` solo si el servidor dijo que la demo esta disponible. */
export function useDemoAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    void availability().then((value) => {
      if (live) setAvailable(value)
    })
    return () => {
      live = false
    }
  }, [])
  return available
}
