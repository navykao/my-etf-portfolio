// POST /api/sync-flags   body: { portfolio?: string[], watchlist?: string[] }
// Writes inPortfolio / inWatchlist back into public/data/{etfs,stocks}.json via
// the GitHub Contents API so the scheduled price-update workflow can prioritise
// those symbols. The GitHub token lives only here, as a server-side env var.
//
// Restricted to the owner(s) in ALLOWED_EMAILS: the JSON files are shared by
// everyone, so arbitrary signed-in users must not be able to commit to the repo.

import { route, HttpError, fetchWithTimeout, SYMBOL_RE } from './_lib/http.js'
import { requireUser, requireAllowed } from './_lib/auth.js'

const FILES = ['public/data/etfs.json', 'public/data/stocks.json']
const MAX_SYMBOLS = 500

function config() {
  const token = process.env.GITHUB_SYNC_TOKEN
  const owner = process.env.GITHUB_OWNER || process.env.VERCEL_GIT_REPO_OWNER
  const repo = process.env.GITHUB_REPO || process.env.VERCEL_GIT_REPO_SLUG
  const branch = process.env.GITHUB_BRANCH || 'main'
  if (!token || !owner || !repo) throw new HttpError(503, 'GitHub sync is not configured on the server')
  return { token, owner, repo, branch }
}

async function github(cfg, path, { accept = 'application/vnd.github+json', ...options } = {}) {
  const res = await fetchWithTimeout(
    `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/${path}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    },
    20_000
  )
  if (!res.ok) throw new HttpError(502, `GitHub request failed (${res.status})`)
  return res
}

function toSymbolSet(value, name) {
  if (value === undefined) return null
  if (!Array.isArray(value) || value.length > MAX_SYMBOLS) throw new HttpError(400, `Invalid ${name}`)
  const set = new Set()
  for (const s of value) {
    const sym = String(s).toUpperCase()
    if (!SYMBOL_RE.test(sym)) throw new HttpError(400, `Invalid symbol in ${name}`)
    set.add(sym)
  }
  return set
}

export default route(['POST'], async (req, res) => {
  const user = await requireUser(req)
  requireAllowed(user)
  const cfg = config()

  let body = req.body || {}
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { throw new HttpError(400, 'Invalid JSON body') }
  }
  const portfolio = toSymbolSet(body.portfolio, 'portfolio')
  const watchlist = toSymbolSet(body.watchlist, 'watchlist')
  if (!portfolio && !watchlist) throw new HttpError(400, 'Nothing to sync')

  // Blob SHAs for the data directory (the file listing carries no content, so the
  // ~1 MB etfs.json cannot trip the Contents API inline-content size limit).
  const listing = await (await github(cfg, `contents/public/data?ref=${cfg.branch}`)).json()
  const shaOf = Object.fromEntries(listing.map((f) => [`public/data/${f.name}`, f.sha]))

  const updated = []
  for (const file of FILES) {
    if (!shaOf[file]) continue
    const raw = await github(cfg, `contents/${file}?ref=${cfg.branch}`, { accept: 'application/vnd.github.raw+json' })
    const items = JSON.parse(await raw.text())

    let changed = false
    const next = items.map((item) => {
      const out = { ...item }
      for (const [flag, set] of [['inPortfolio', portfolio], ['inWatchlist', watchlist]]) {
        if (!set) continue
        const want = set.has(item.symbol)
        if ((item[flag] === true) !== want) {
          out[flag] = want
          changed = true
        }
      }
      return out
    })
    if (!changed) continue

    // Same serialisation as scripts/update-all-assets.cjs (2-space JSON) to keep diffs minimal.
    await github(cfg, `contents/${file}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `🔄 sync: update ${file} portfolio/watchlist flags`,
        content: Buffer.from(JSON.stringify(next, null, 2), 'utf8').toString('base64'),
        sha: shaOf[file],
        branch: cfg.branch,
      }),
    })
    updated.push(file)
  }

  res.status(200).json({ updated })
})
