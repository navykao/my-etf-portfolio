// GET /api/quote?symbol=AAPL
// Server-side price lookup for the app's Live Mode. Provider API keys stay in
// Vercel environment variables (never VITE_-prefixed, so never bundled).
// Requires a signed-in Firebase user: Authorization: Bearer <ID token>

import { route, HttpError, SYMBOL_RE } from './_lib/http.js'
import { requireUser, rateLimit } from './_lib/auth.js'
import { PROVIDERS, num } from './_lib/providers.js'

export default route(['GET'], async (req, res) => {
  const user = await requireUser(req)
  rateLimit(user.uid)

  const symbol = String(req.query.symbol || '').toUpperCase()
  if (!SYMBOL_RE.test(symbol)) throw new HttpError(400, 'Invalid symbol')

  for (const p of PROVIDERS) {
    const key = p.key()
    if (!key) continue
    try {
      const q = await p.quote(symbol, key)
      const price = num(q?.price)
      if (price) {
        return res.status(200).json({
          symbol,
          price,
          change: num(q.change) ?? 0,
          changePercent: num(q.changePercent) ?? 0,
          source: p.name,
        })
      }
    } catch {
      // timeout / network error → try next provider (message omitted: URL contains the key)
    }
  }
  throw new HttpError(404, 'No quote available')
})
