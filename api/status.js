// GET /api/status
// Tells the Settings page which price providers have a key configured on the
// server. Returns booleans only — never the keys themselves.

import { route } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { providerStatus } from './_lib/providers.js'

export default route(['GET'], async (req, res) => {
  await requireUser(req)
  res.status(200).json({ providers: providerStatus() })
})
