export function getBackendErrorMessage(err: any): string {
  // Axios error with response payload
  if (err?.response?.data) {
    const data = err.response.data
    
    // 1. Try normalized error structure: { error: { message: "...", details: { ... } } }
    if (data?.error?.message && typeof data.error.message === 'string') {
      // If it's a validation error with details, format them
      if (data.error.details && typeof data.error.details === 'object') {
        const details = data.error.details
        const messages = Object.values(details).flat()
        if (messages.length > 0) {
          return `${data.error.message}: ${messages.join(', ')}`
        }
      }
      return data.error.message
    }

    // 2. Try simple message property: { message: "..." }
    if (data?.message && typeof data.message === 'string') {
      return data.message
    }

    // 3. Try legacy error property: { error: "..." }
    if (data?.error && typeof data.error === 'string') {
      return data.error
    }

    // 4. Try array of messages (e.g. class-validator)
    if (Array.isArray(data)) {
      const msgs = data.map((d) => (typeof d?.message === 'string' ? d.message : String(d)))
      if (msgs.length) return msgs.join('; ')
    }

    // 5. Try string body
    if (typeof data === 'string' && data.length > 0 && data.length < 200) {
      return data
    }

    // 6. Fallback for object: stringify it
    try {
      if (typeof data === 'object' && Object.keys(data).length > 0) {
        return JSON.stringify(data)
      }
    } catch {
      // ignore
    }
  }

  // Network/Timeout errors
  if (err?.code === 'ECONNREFUSED' || err?.code === 'ERR_NETWORK') {
    return 'Connection refused. Please ensure the backend server is running and accessible.'
  }

  // Status-based fallbacks if no data payload
  const status = err?.response?.status
  if (status) {
    if (status === 401) return 'Unauthorized: Your session may have expired. Please login again.'
    if (status === 403) return 'Forbidden: You do not have permission to perform this action.'
    if (status === 404) return 'Not Found: The requested resource does not exist.'
    if (status >= 400 && status < 500) return `Request Error (${status}): The server rejected the request.`
    if (status >= 500) return `Server Error (${status}): Something went wrong on our side. Please try again later.`
  }

  // Generic message fallback
  if (err?.message && typeof err.message === 'string') {
    return err.message
  }

  return 'An unexpected error occurred. Please try again.'
}

export default getBackendErrorMessage
