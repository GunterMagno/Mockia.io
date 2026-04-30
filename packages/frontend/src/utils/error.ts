// Utility to extract the most specific error message from a backend response
export function getBackendErrorMessage(err: any): string {
  // Axios error with response payload
  if (err?.response?.data) {
    const data = err.response.data
    if (typeof data === 'string') return data
    if (typeof data?.message === 'string') return data.message
    if (Array.isArray(data)) {
      const msgs = data.map((d) => (typeof d?.message === 'string' ? d.message : String(d)))
      if (msgs.length) return msgs.join('; ')
    }
    if (typeof data?.error === 'string') return data.error
    // Fallback: return a JSON string if backend sent an unknown structure
    try {
      return typeof data === 'object' ? JSON.stringify(data) : String(data)
    } catch {
      // ignore
    }
  }
  // Fallback to generic message and include status if available
  const status = err?.response?.status
  if (typeof status === 'number') {
    if (status === 401) return 'No autorizado: credenciales inválidas o sesión expirada.'
    if (status >= 400 && status < 500) return `Error ${status}: solicitud incorrecta.`
    if (status >= 500) return 'Error del servidor. Por favor, intenta más tarde.'
  }
  // If the message mentions 401, map to user-friendly 401 message
  if (typeof err?.message === 'string' && /401/.test(err.message)) {
    return 'No autorizado: credenciales inválidas o sesión expirada.'
  }
  // Fallback to generic message
  if (typeof err?.message === 'string') return err.message
  return 'Error de autenticación. Intenta de nuevo.'
}

export default getBackendErrorMessage
