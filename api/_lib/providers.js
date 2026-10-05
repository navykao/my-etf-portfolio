// Price providers used by /api/quote. Keys come from server-side env vars.

import { fetchWithTimeout } from './http.js'

export const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? n : null
}

async function getJson(url) {
  const res = await fetchWithTimeout(url)
  return res.ok ? res.json() : null
}

export const PROVIDERS = [
  {
    name: 'Finnhub',
    key: () => process.env.FINNHUB_API_KEY,
    async quote(symbol, key) {
      const d = await getJson(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${key}`)
      return d?.c ? { price: d.c, change: d.d, changePercent: d.dp } : null
    },
  },
  {
    name: 'FMP',
    key: () => process.env.FMP0N8_API_KEY,
    async quote(symbol, key) {
      const d = await getJson(`https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${key}`)
      return d?.[0]?.price ? { price: d[0].price, change: d[0].change, changePercent: d[0].changesPercentage } : null
    },
  },
  {
    name: 'Twelve Data',
    key: () => process.env.TWELVE_DATA_API_KEY,
    async quote(symbol, key) {
      const d = await getJson(`https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${key}`)
      return d?.close ? { price: d.close, change: d.change, changePercent: d.percent_change } : null
    },
  },
  {
    name: 'EODHD',
    key: () => process.env.EODHD_API_KEY,
    async quote(symbol, key) {
      const d = await getJson(`https://eodhistoricaldata.com/api/real-time/${symbol}.US?api_token=${key}&fmt=json`)
      return d?.close ? { price: d.close, change: d.change, changePercent: d.change_p } : null
    },
  },
]

export const providerStatus = () =>
  Object.fromEntries(PROVIDERS.map((p) => [p.name, Boolean(p.key())]))
