import axios from 'axios'

// Axios instance for frontend API calls
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
})

// Attach Bearer token if available, but skip login/register requests
api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('mockia_token') : null
  const url = (config.url ?? '') as string
  const isAuthRoute = url.includes('/auth/login') || url.includes('/auth/register')
  console.log(`[Axios Request] URL: ${url}, Token read from localStorage: ${token ? 'Present' : 'Null'}, IsAuthRoute: ${isAuthRoute}`)
  if (token && config.headers && !isAuthRoute) {
    config.headers.Authorization = `Bearer ${token}`
    console.log(`[Axios Request] Header Authorization attached: Bearer ${token.substring(0, 15)}...`)
  }
  return config
})

// Check for HTML responses (SPA fallback) when JSON is expected
api.interceptors.response.use(
  (response) => {
    const contentType = response.headers['content-type'] || ''
    const url = response.config.url ?? ''
    console.log(`[Axios Response SUCCESS] URL: ${url}, Status: ${response.status}, Content-Type: ${contentType}`)
    if (
      contentType.includes('text/html') ||
      (typeof response.data === 'string' && response.data.trim().startsWith('<!DOCTYPE html>'))
    ) {
      console.warn(`[Axios Response ERROR] SPA Fallback HTML detected for URL: ${url}`)
      return Promise.reject({
        message: 'Backend server is unreachable or misconfigured (received HTML instead of JSON).',
        code: 'ERR_SPA_FALLBACK',
        response,
      })
    }
    return response
  },
  (error) => {
    console.error(`[Axios Response ERROR] URL: ${error?.config?.url}, Status: ${error?.response?.status}, Error: ${error?.message}`, error?.response?.data || '')
    return Promise.reject(error)
  }
)

export default api
