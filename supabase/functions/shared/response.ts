import { CORS_HEADERS } from './cors.ts'

const JSON_HEADERS = {
  ...CORS_HEADERS,
  'Content-Type': 'application/json',
}

/**
 * Standardized API response wrappers.
 */
export function ok<T>(data: T): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    headers: JSON_HEADERS,
  })
}

export function err(code: string, message: string, status: number = 200): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code, message } }),
    {
      status,
      headers: JSON_HEADERS,
    },
  )
}
