import { HttpError, fetchWithTimeout } from './http.js'

// Verifies a Firebase ID token by asking Firebase Auth itself
// (Identity Toolkit accounts:lookup) — no firebase-admin dependency needed.
// The token must belong to the project that owns FIREBASE_API_KEY.
const LOOKUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup'
const VERIFY_CACHE_MS = 60_000

const verified = new Map() // idToken -> { user, expires }
const hits = new Map()     // uid -> number[] (request timestamps)

function firebaseApiKey() {
  // The Firebase web API key is not a secret; the VITE_ name is accepted as a
  // fallback so an existing Vercel project works without extra setup.
  return process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || ''
}

/** Returns { uid, email, emailVerified } or throws 401. */
export async function requireUser(req) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || '')
  if (!match) throw new HttpError(401, 'Sign in required')
  const idToken = match[1]

  const cached = verified.get(idToken)
  if (cached && cached.expires > Date.now()) return cached.user

  const apiKey = firebaseApiKey()
  if (!apiKey) throw new HttpError(500, 'Server is missing FIREBASE_API_KEY')

  let data
  try {
    const res = await fetchWithTimeout(`${LOOKUP_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })
    if (!res.ok) throw new HttpError(401, 'Invalid or expired token')
    data = await res.json()
  } catch (err) {
    if (err instanceof HttpError) throw err
    throw new HttpError(502, 'Could not verify token')
  }

  const u = data?.users?.[0]
  if (!u || u.disabled) throw new HttpError(401, 'Invalid or expired token')

  const user = {
    uid: u.localId,
    email: (u.email || '').toLowerCase(),
    emailVerified: Boolean(u.emailVerified),
  }
  if (verified.size > 500) verified.clear()
  verified.set(idToken, { user, expires: Date.now() + VERIFY_CACHE_MS })
  return user
}

/**
 * Restrict an endpoint to the owner(s) listed in ALLOWED_EMAILS
 * (comma-separated). Fails closed when the variable is not set.
 */
export function requireAllowed(user) {
  const allowed = (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (allowed.length === 0) throw new HttpError(503, 'ALLOWED_EMAILS is not configured on the server')
  if (!user.emailVerified || !allowed.includes(user.email)) throw new HttpError(403, 'Forbidden')
}

/** Best-effort per-user rate limit (per serverless instance). */
export function rateLimit(uid, limit = 120, windowMs = 60_000) {
  const now = Date.now()
  const recent = (hits.get(uid) || []).filter((t) => now - t < windowMs)
  if (recent.length >= limit) throw new HttpError(429, 'Too many requests')
  recent.push(now)
  hits.set(uid, recent)
  if (hits.size > 1000) hits.clear()
}
