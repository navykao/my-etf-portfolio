// Shared helpers for the Vercel Serverless Functions in /api.
// Files under api/_lib are not exposed as routes (underscore prefix).

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * Wrap a handler: enforce allowed HTTP methods, disable caching,
 * and turn thrown HttpErrors into JSON responses.
 * Unexpected errors are logged by message only (never the request URL,
 * which may contain provider API keys) and returned as a generic 500.
 */
export function route(methods, fn) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store')
    try {
      if (!methods.includes(req.method)) {
        res.setHeader('Allow', methods.join(', '))
        throw new HttpError(405, 'Method not allowed')
      }
      await fn(req, res)
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message })
      } else {
        console.error('[api] unexpected error:', err?.message || err)
        res.status(500).json({ error: 'Internal error' })
      }
    }
  }
}

/** fetch with an abort timeout. */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Ticker symbols such as AAPL, BRK.B, BF-B. */
export const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,9}$/
