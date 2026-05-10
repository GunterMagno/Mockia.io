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
  if (token && config.headers && !isAuthRoute) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Check for HTML responses (SPA fallback) when JSON is expected
api.interceptors.response.use(
  (response) => {
    const contentType = response.headers['content-type'] || ''
    if (
      contentType.includes('text/html') ||
      (typeof response.data === 'string' && response.data.trim().startsWith('<!DOCTYPE html>'))
    ) {
      return Promise.reject({
        message: 'Backend server is unreachable or misconfigured (received HTML instead of JSON).',
        code: 'ERR_SPA_FALLBACK',
        response,
      })
    }
    return response
  },
  (error) => Promise.reject(error)
)

export default api
