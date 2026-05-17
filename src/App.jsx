import { useState, useEffect, useMemo, useCallback } from 'react'
import { Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js'
import { Pie, Bar, Line } from 'react-chartjs-2'
import './App.css'

// ==================== FIREBASE ====================
import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut, onAuthStateChanged } from 'firebase/auth'
import { getFirestore, doc, collection, onSnapshot, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}
const firebaseApp = initializeApp(firebaseConfig)
const auth = getAuth(firebaseApp)
const googleProvider = new GoogleAuthProvider()
const db = getFirestore(firebaseApp)

// Register ChartJS components
ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend)

// ==================== CONFIG ====================
const CONFIG = {
  UPDATE_INTERVAL: 2 * 60 * 60 * 1000,
  CACHE_DURATION: 90 * 60 * 1000,
  DATA_URL: '/data/stocks.json',   // legacy fallback ไม่ใช้แล้ว
  GITHUB_DATA_URL: 'https://raw.githubusercontent.com/navykao/my-etf-portfolio/main/public/data/stocks.json',
  // ✅ แยก URL สำหรับ stocks และ ETFs
  STOCKS_URL: '/data/stocks.json',
  ETFS_URL:   '/data/etfs.json',
  GITHUB_STOCKS_URL: 'https://raw.githubusercontent.com/navykao/my-etf-portfolio/main/public/data/stocks.json',
  GITHUB_ETFS_URL:   'https://raw.githubusercontent.com/navykao/my-etf-portfolio/main/public/data/etfs.json',
}

const API_KEYS = {
  FINNHUB: import.meta.env.VITE_FINNHUB_API_KEY     || '',
  FMP:     import.meta.env.VITE_FMP0N8_API_KEY      || '',  // ✅ ชื่อถูกต้องตาม .env.example
  TWELVE:  import.meta.env.VITE_TWELVE_DATA_API_KEY || '',
  EODHD:   import.meta.env.VITE_EODHD_API_KEY       || ''
}

// ==================== UTILITY FUNCTIONS ====================
const formatPrice = (price) => {
  if (price == null || isNaN(price)) return '$0.00'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(price)
}

const formatShares = (shares) => {
  if (shares == null || isNaN(shares)) return '0'
  // แสดงทศนิยมถ้ามี เช่น 0.5 หรือ 1.2345
  return parseFloat(shares).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6
  })
}

const formatPercent = (value) => {
  if (value == null || isNaN(value)) return '0.00%'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

const getChangeColor = (value) => {
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return 'neutral'
}

const getTypeBadgeClass = (type) => {
  const typeMap = {
    'STOCK': 'badge-stock',
    'ETF': 'badge-etf',
    'REIT': 'badge-reit',
    'BOND': 'badge-bond'
  }
  return typeMap[type] || 'badge-stock'
}

// ==================== API SERVICE ====================
class APIService {
  static async fetchFromFinnhub(symbol) {
    if (!API_KEYS.FINNHUB) return null
    try {
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${API_KEYS.FINNHUB}`)
      const data = await res.json()
      if (data.c) return { price: data.c, change: data.d, changePercent: data.dp, source: 'Finnhub' }
    } catch (e) { console.error('Finnhub error:', e) }
    return null
  }

  static async fetchFromFMP(symbol) {
    if (!API_KEYS.FMP) return null
    try {
      const res = await fetch(`https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${API_KEYS.FMP}`)
      const data = await res.json()
      if (data[0]) return { price: data[0].price, change: data[0].change, changePercent: data[0].changesPercentage, source: 'FMP' }
    } catch (e) { console.error('FMP error:', e) }
    return null
  }

  static async fetchFromTwelve(symbol) {
    if (!API_KEYS.TWELVE) return null
    try {
      const res = await fetch(`https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${API_KEYS.TWELVE}`)
      const data = await res.json()
      if (data.close) return { price: parseFloat(data.close), change: parseFloat(data.change), changePercent: parseFloat(data.percent_change), source: 'Twelve Data' }
    } catch (e) { console.error('Twelve Data error:', e) }
    return null
  }

  static async fetchFromEODHD(symbol) {
    if (!API_KEYS.EODHD) return null
    try {
      const res = await fetch(`https://eodhistoricaldata.com/api/real-time/${symbol}.US?api_token=${API_KEYS.EODHD}&fmt=json`)
      const data = await res.json()
      if (data.close) return { price: data.close, change: data.change, changePercent: data.change_p, source: 'EODHD' }
    } catch (e) { console.error('EODHD error:', e) }
    return null
  }

  static async fetchQuote(symbol) {
    let data = await this.fetchFromFinnhub(symbol)
    if (data) return data
    data = await this.fetchFromFMP(symbol)
    if (data) return data
    data = await this.fetchFromTwelve(symbol)
    if (data) return data
    data = await this.fetchFromEODHD(symbol)
    if (data) return data
    return null
  }
}

// ==================== LOCAL STORAGE ====================
const Storage = {
  get: (key, defaultValue = null) => {
    try {
      const item = localStorage.getItem(key)
      return item ? JSON.parse(item) : defaultValue
    } catch { return defaultValue }
  },
  set: (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)) }
    catch (e) { console.error('Storage error:', e) }
  }
}

// ==================== COMPONENTS ====================
const LiveDot = ({ active }) => (
  <span className={`live-dot ${active ? '' : 'inactive'}`}></span>
)

const Badge = ({ type, children }) => (
  <span className={`badge ${getTypeBadgeClass(type)}`}>{children}</span>
)

const SectorBadge = ({ sector }) => (
  <span className="sector-badge">{sector}</span>
)

const PriceChange = ({ value }) => (
  <span className={`change ${getChangeColor(value)}`}>
    {formatPercent(value)}
  </span>
)

const WatchlistCard = ({ stock, onClick }) => (
  <div className="watchlist-item" onClick={onClick}>
    <div className="stock-info">
      <div className="stock-header">
        <span className="stock-symbol">{stock.symbol}</span>
        <Badge type={stock.type}>{stock.type}</Badge>
      </div>
      <span className="stock-name">{stock.name}</span>
      {stock.sector && <SectorBadge sector={stock.sector} />}
    </div>
    <div className="stock-price">
      <span className="price">{formatPrice(stock.price)}</span>
      <PriceChange value={stock.changePercent || 0} />
    </div>
  </div>
)

const Countdown = ({ seconds }) => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return (
    <div className="countdown">
      <div className="countdown-label">อัพเดทครั้งถัดไป</div>
      <div className="countdown-timer">
        {hours}:{minutes.toString().padStart(2, '0')}:{secs.toString().padStart(2, '0')}
      </div>
    </div>
  )
}

const MarketIndex = ({ name, value, change }) => (
  <div className="index-item">
    <div className="index-name">{name}</div>
    <div className="index-value">{value.toLocaleString()}</div>
    <PriceChange value={change} />
  </div>
)

// ==================== PAGE COMPONENTS ====================

// --- DASHBOARD PAGE ---
function DashboardPage({
  filteredWatchlist, filterType, setFilterType,
  selectedStock, setSelectedStock, chartData,
  countdown, portfolio, allAssets, portfolioStats,
  pieChartData, barChartData, addToPortfolio, removeFromPortfolio,
  addNotification
}) {
  const [formSymbol, setFormSymbol] = useState('')
  const [formShares, setFormShares] = useState('')
  const [formAvgCost, setFormAvgCost] = useState('')
  const [formError, setFormError] = useState('')

  // FIX: แก้ validation ให้รองรับเศษส่วน
  const handleAddPortfolio = (e) => {
    e.preventDefault()
    setFormError('')

    const symbol = formSymbol.trim().toUpperCase()
    const shares = parseFloat(formShares)
    const avgCost = parseFloat(formAvgCost)

    if (!symbol) { setFormError('กรุณาระบุ Symbol'); return }
    if (isNaN(shares) || shares <= 0) { setFormError('จำนวนหุ้นต้องมากกว่า 0'); return }
    if (isNaN(avgCost) || avgCost <= 0) { setFormError('ราคาซื้อต้องมากกว่า 0'); return }

    const success = addToPortfolio(symbol, shares, avgCost)
    if (success) {
      setFormSymbol('')
      setFormShares('')
      setFormAvgCost('')
      addNotification(`เพิ่ม ${symbol} ใน Portfolio แล้ว ✓`, 'success')
    } else {
      setFormError(`ไม่พบหุ้น "${symbol}" ในฐานข้อมูล`)
    }
  }

  // ── helpers for inline stock info panel ──────────────────────────────────
  const formatBig = (n) => {
    if (!n || isNaN(n)) return '-'
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
    if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`
    if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`
    return `$${n.toLocaleString()}`
  }

  // Build info rows for the selected stock/ETF
  const buildInfoRows = (s) => {
    if (!s) return []
    if (s.type === 'ETF') return [
      { label: 'AUM',            val: formatBig(s.totalAssets) },
      { label: 'Expense Ratio',  val: s.expenseRatio ? `${s.expenseRatio.toFixed(2)}%` : '-' },
      { label: 'Num Holdings',   val: s.numHoldings  ? s.numHoldings.toLocaleString() : '-' },
      { label: 'Div Yield',      val: s.divYield     ? `${(s.divYield * 100).toFixed(2)}%` : '-' },
      { label: 'Div Freq',       val: s.dividendFrequency || '-' },
      { label: '3Y Div Growth',  val: s.divGrowth3Y  ? `${s.divGrowth3Y.toFixed(1)}%` : '-' },
      { label: '52W High',       val: formatPrice(s.high52w) },
      { label: '52W Low',        val: formatPrice(s.low52w) },
      { label: 'Day High',       val: formatPrice(s.dayHigh) },
      { label: 'Day Low',        val: formatPrice(s.dayLow) },
      { label: 'Beta',           val: s.beta ? s.beta.toFixed(2) : '-' },
      { label: 'Tracking Index', val: s.trackingIndex || '-' },
    ]
    return [
      { label: 'Market Cap',  val: formatBig(s.marketCap) },
      { label: 'P/E Ratio',   val: s.peRatio  ? s.peRatio.toFixed(1) : '-' },
      { label: 'EPS',         val: s.eps      ? `$${s.eps.toFixed(2)}` : '-' },
      { label: 'Div Yield',   val: s.divYield ? `${(s.divYield * 100).toFixed(2)}%` : '-' },
      { label: 'Beta',        val: s.beta     ? s.beta.toFixed(2) : '-' },
      { label: 'ROE',         val: s.roe      ? `${(s.roe * 100).toFixed(1)}%` : '-' },
      { label: '52W High',    val: formatPrice(s.high52w) },
      { label: '52W Low',     val: formatPrice(s.low52w) },
      { label: 'Day High',    val: formatPrice(s.dayHigh) },
      { label: 'Day Low',     val: formatPrice(s.dayLow) },
      { label: 'Sector',      val: s.sector   || '-' },
      { label: 'Industry',    val: s.industry || '-' },
    ]
  }

  return (
    <>
      <div className="container">
        {/* Type Filter */}
        <div className="type-filter" style={{ paddingTop: '20px' }}>
          {['ALL', 'STOCK', 'ETF', 'REIT', 'BOND'].map(type => (
            <button
              key={type}
              className={`filter-btn ${filterType === type ? 'active' : ''}`}
              onClick={() => setFilterType(type)}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="main-grid">

          {/* ── COL 1: Watchlist ─────────────────────────────── */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">📋 Watchlist</h2>
              <Badge type="ETF">LIVE</Badge>
            </div>
            <div className="watchlist-content">
              {filteredWatchlist.length === 0 ? (
                <p className="empty-state">ยังไม่มีหุ้นใน Watchlist<br /><small>ค้นหาหุ้นด้านบนแล้วกด Enter</small></p>
              ) : (
                filteredWatchlist.map(stock => (
                  <WatchlistCard key={stock.symbol} stock={stock} onClick={() => setSelectedStock(stock)} />
                ))
              )}
            </div>
            <Countdown seconds={countdown} />
          </div>

          {/* ── COL 2: Stock Info (top) + Chart (bottom) ──────── */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: 0, overflow: 'hidden' }}>

            {/* ── Stock Info Panel ─── */}
            {selectedStock ? (
              <div style={{ padding: '22px 22px 18px' }}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '22px', fontWeight: '800', color: 'var(--ink-1)', letterSpacing: '-.4px', fontFamily: 'var(--mono)' }}>
                        {selectedStock.symbol}
                      </span>
                      <Badge type={selectedStock.type}>{selectedStock.type}</Badge>
                      {selectedStock.sector && <SectorBadge sector={selectedStock.sector} />}
                      {selectedStock.category && <SectorBadge sector={selectedStock.category} />}
                    </div>
                    <div style={{ fontSize: '12.5px', color: 'var(--ink-3)', marginBottom: '10px' }}>{selectedStock.name}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                      <span style={{ fontSize: '30px', fontWeight: '700', color: 'var(--ink-1)', fontFamily: 'var(--mono)', letterSpacing: '-.5px' }}>
                        {formatPrice(selectedStock.price)}
                      </span>
                      <PriceChange value={selectedStock.changePercent || 0} />
                      {selectedStock.change != null && (
                        <span style={{ fontSize: '13px', color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>
                          ({selectedStock.change >= 0 ? '+' : ''}{formatPrice(selectedStock.change)})
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Info grid — 6 cols */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '10px 8px', padding: '14px', background: 'var(--bg)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
                  {buildInfoRows(selectedStock).map(({ label, val }) => (
                    <div key={label}>
                      <div style={{ fontSize: '10px', color: 'var(--ink-4)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '3px' }}>{label}</div>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--ink-1)', fontFamily: 'var(--mono)', wordBreak: 'break-word' }}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ padding: '22px 22px 18px' }}>
                <div style={{ padding: '32px 20px', background: 'var(--bg)', borderRadius: 'var(--r-lg)', border: '1px dashed var(--border-2)', textAlign: 'center' }}>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>👆</div>
                  <div style={{ fontSize: '13.5px', color: 'var(--ink-3)', fontWeight: '500' }}>เลือกหุ้นจาก Watchlist เพื่อดูข้อมูล</div>
                </div>
              </div>
            )}

            {/* ── Divider ─── */}
            <div style={{ height: '1px', background: 'var(--border)', margin: '0 22px' }} />

            {/* ── Chart ─── */}
            <div style={{ padding: '18px 22px 22px', flex: 1 }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: '12px' }}>
                {selectedStock ? `📈 ${selectedStock.symbol} — Price Chart` : '📈 Price Chart'}
              </div>
              <div className="chart-container" style={{ marginTop: 0 }}>
                {selectedStock ? (
                  <Line
                    data={{
                      labels: ['9:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00'],
                      datasets: [{
                        label: selectedStock.symbol,
                        data: chartData,
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37,99,235,0.08)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3,
                        pointBackgroundColor: '#2563eb',
                      }]
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { display: false } },
                      scales: {
                        x: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 11 }, color: '#9ca3af' } },
                        y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 11 }, color: '#9ca3af' } }
                      }
                    }}
                  />
                ) : (
                  <div className="empty-state">เลือกหุ้นเพื่อดูกราฟ</div>
                )}
              </div>
            </div>
          </div>

          {/* ── COL 3: Portfolio Holdings → Market Overview → Add Form ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

            {/* Portfolio Holdings */}
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">💼 Portfolio Holdings</h2>
              </div>
              {portfolio.length === 0 ? (
                <div className="empty-state" style={{ padding: '20px 0' }}>
                  <div style={{ fontSize: '24px', marginBottom: '6px' }}>📭</div>
                  ยังไม่มีหุ้นในพอร์ต
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {/* Summary numbers */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '4px' }}>
                    <div style={{ padding: '12px 14px', background: 'var(--bg)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', borderLeft: '3px solid var(--blue)' }}>
                      <div style={{ fontSize: '10px', color: 'var(--ink-4)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: '4px' }}>มูลค่ารวม</div>
                      <div style={{ fontSize: '16px', fontWeight: '700', fontFamily: 'var(--mono)', color: 'var(--ink-1)' }}>{formatPrice(portfolioStats.totalValue)}</div>
                    </div>
                    <div style={{ padding: '12px 14px', background: 'var(--bg)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', borderLeft: `3px solid ${portfolioStats.totalGain >= 0 ? 'var(--success)' : 'var(--danger)'}` }}>
                      <div style={{ fontSize: '10px', color: 'var(--ink-4)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: '4px' }}>กำไร/ขาดทุน</div>
                      <div style={{ fontSize: '16px', fontWeight: '700', fontFamily: 'var(--mono)', color: portfolioStats.totalGain >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {formatPrice(portfolioStats.totalGain)}
                      </div>
                    </div>
                    <div style={{ padding: '12px 14px', background: 'var(--bg)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', borderLeft: `3px solid ${portfolioStats.totalGainPercent >= 0 ? 'var(--emerald)' : 'var(--rose)'}` }}>
                      <div style={{ fontSize: '10px', color: 'var(--ink-4)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: '4px' }}>% กำไร</div>
                      <div style={{ fontSize: '16px', fontWeight: '700', fontFamily: 'var(--mono)', color: portfolioStats.totalGainPercent >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {formatPercent(portfolioStats.totalGainPercent)}
                      </div>
                    </div>
                    <div style={{ padding: '12px 14px', background: 'var(--bg)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', borderLeft: '3px solid var(--cyan)' }}>
                      <div style={{ fontSize: '10px', color: 'var(--ink-4)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: '4px' }}>จำนวน</div>
                      <div style={{ fontSize: '16px', fontWeight: '700', fontFamily: 'var(--mono)', color: 'var(--ink-1)' }}>{portfolioStats.count} ตัว</div>
                    </div>
                  </div>
                  {/* Holdings mini list */}
                  <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {portfolio.map(holding => {
                      const stock = allAssets.find(a => a.symbol === holding.symbol)
                      const currentPrice = stock?.price || holding.currentPrice || holding.avgCost
                      const val = holding.shares * currentPrice
                      const gain = val - (holding.shares * holding.avgCost)
                      return (
                        <div key={holding.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'var(--bg)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
                          <div>
                            <span className="stock-symbol" style={{ fontSize: '12.5px' }}>{holding.symbol}</span>
                            <span style={{ fontSize: '10.5px', color: 'var(--ink-4)', marginLeft: '6px' }}>{formatShares(holding.shares)} หุ้น</span>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '12.5px', fontFamily: 'var(--mono)', fontWeight: '600', color: 'var(--ink-1)' }}>{formatPrice(val)}</div>
                            <div style={{ fontSize: '11px', fontFamily: 'var(--mono)', color: gain >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                              {gain >= 0 ? '+' : ''}{formatPrice(gain)}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Market Overview */}
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">🌍 Market Overview</h2>
              </div>
              <div className="market-indices">
                <MarketIndex name="S&P 500"   value={4783.45}  change={0.54} />
                <MarketIndex name="DOW JONES" value={37305.16} change={0.36} />
                <MarketIndex name="NASDAQ"    value={14813.92} change={0.82} />
              </div>
            </div>

            {/* Add to Portfolio form */}
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">➕ เพิ่มหุ้นในพอร์ต</h2>
              </div>
              <form onSubmit={handleAddPortfolio}>
                <div className="form-group">
                  <label className="form-label">Symbol</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="เช่น AAPL, VYM, VXUS"
                    value={formSymbol}
                    onChange={e => setFormSymbol(e.target.value.toUpperCase())}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">จำนวนหุ้น (รองรับเศษส่วน เช่น 0.5, 1.25)</label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="0.00211"
                    step="any"
                    min="0.000001"
                    value={formShares}
                    onChange={e => setFormShares(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">ราคาซื้อเฉลี่ย ($)</label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="0.00"
                    step="any"
                    min="0.01"
                    value={formAvgCost}
                    onChange={e => setFormAvgCost(e.target.value)}
                    required
                  />
                </div>
                {formError && (
                  <div style={{ color: 'var(--rose)', fontSize: '13px', marginBottom: '12px', padding: '8px 12px', background: 'var(--rose-soft)', borderRadius: 'var(--r-md)', borderLeft: '3px solid var(--rose)' }}>
                    ⚠️ {formError}
                  </div>
                )}
                <button type="submit" className="btn-secondary" style={{ width: '100%' }}>
                  เพิ่มในพอร์ต
                </button>
              </form>
            </div>

          </div>{/* end col 3 */}
        </div>{/* end main-grid */}
      </div>
    </>
  )
}

// --- PORTFOLIO PAGE ---
function PortfolioPage({ portfolio, allAssets, portfolioStats, pieChartData, barChartData, removeFromPortfolio, addToPortfolio, addNotification }) {
  const [formSymbol, setFormSymbol] = useState('')
  const [formShares, setFormShares] = useState('')
  const [formAvgCost, setFormAvgCost] = useState('')
  const [formError, setFormError] = useState('')

  const handleAddPortfolio = (e) => {
    e.preventDefault()
    setFormError('')
    const symbol = formSymbol.trim().toUpperCase()
    const shares = parseFloat(formShares)
    const avgCost = parseFloat(formAvgCost)
    if (!symbol) { setFormError('กรุณาระบุ Symbol'); return }
    if (isNaN(shares) || shares <= 0) { setFormError('จำนวนหุ้นต้องมากกว่า 0'); return }
    if (isNaN(avgCost) || avgCost <= 0) { setFormError('ราคาซื้อต้องมากกว่า 0'); return }
    const success = addToPortfolio(symbol, shares, avgCost)
    if (success) {
      setFormSymbol(''); setFormShares(''); setFormAvgCost('')
      addNotification(`เพิ่ม ${symbol} ใน Portfolio แล้ว ✓`, 'success')
    } else {
      setFormError(`ไม่พบหุ้น "${symbol}" ในฐานข้อมูล`)
    }
  }

  // pie chart options (reuse)
  const pieOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          font: { size: 11, family: "'Geist', sans-serif" },
          padding: 12,
          generateLabels: (chart) => {
            const data = chart.data
            const total = data.datasets[0].data.reduce((a, b) => a + b, 0)
            return data.labels.map((label, i) => {
              const value = data.datasets[0].data[i]
              const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'
              const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
              return {
                text: `${label}  ${pct}%  (${formatted})`,
                fillStyle: data.datasets[0].backgroundColor[i],
                strokeStyle: '#fff',
                lineWidth: 2,
                index: i,
              }
            })
          }
        }
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const total = context.dataset.data.reduce((a, b) => a + b, 0)
            const value = context.parsed
            const pct = total > 0 ? ((value / total) * 100).toFixed(2) : '0.00'
            const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
            return [`  มูลค่า: ${formatted}`, `  สัดส่วน: ${pct}%`]
          }
        },
        backgroundColor: 'rgba(10,10,20,0.88)',
        padding: 12,
        titleFont: { size: 13, weight: 'bold' },
        bodyFont: { size: 13 },
      }
    }
  }

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 11 }, color: '#9ca3af' } },
      y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 11 }, color: '#9ca3af', callback: (v) => `$${v}` } }
    }
  }

  return (
    <div className="container" style={{ paddingTop: '24px', paddingBottom: '32px' }}>

      {/* Page Title */}
      <h1 style={{ fontSize: '24px', fontWeight: '800', marginBottom: '22px', color: 'var(--ink-1)', letterSpacing: '-.4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        💼 Portfolio
      </h1>

      {/* ══════════════════════════════════════════════════════
          แถวบน: ฟอร์มเพิ่มหุ้น (ซ้าย) | สรุปมูลค่า (ขวา)
      ══════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px', marginBottom: '18px', alignItems: 'start' }}>

        {/* ── ซ้าย: ฟอร์มเพิ่มหุ้น ── */}
        <div className="card" style={{ height: '100%' }}>
          <div className="card-header">
            <h2 className="card-title">➕ เพิ่มหุ้นในพอร์ต</h2>
          </div>
          <form onSubmit={handleAddPortfolio}>
            <div className="form-group">
              <label className="form-label">Symbol</label>
              <input type="text" className="form-input" placeholder="เช่น AAPL, VYM, VXUS"
                value={formSymbol} onChange={e => setFormSymbol(e.target.value.toUpperCase())} required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="form-group">
                <label className="form-label">จำนวนหุ้น</label>
                {/* FIX: step="any" รองรับเศษส่วน */}
                <input type="number" className="form-input" placeholder="0.001"
                  step="any" min="0.000001" value={formShares}
                  onChange={e => setFormShares(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">ราคาซื้อเฉลี่ย ($)</label>
                <input type="number" className="form-input" placeholder="0.00"
                  step="any" min="0.01" value={formAvgCost}
                  onChange={e => setFormAvgCost(e.target.value)} required />
              </div>
            </div>
            {formError && (
              <div style={{ color: 'var(--rose)', fontSize: '12.5px', marginBottom: '10px', padding: '8px 12px', background: 'var(--rose-soft)', borderRadius: 'var(--r-md)', borderLeft: '3px solid var(--rose)' }}>
                ⚠️ {formError}
              </div>
            )}
            <button type="submit" className="btn-secondary">เพิ่มใน Portfolio</button>
          </form>
        </div>

        {/* ── ขวา: สรุปมูลค่าพอร์ต เรียงแนวตั้ง ── */}
        <div className="card" style={{ height: '100%' }}>
          <div className="card-header">
            <h2 className="card-title">📊 สรุปพอร์ต</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[
              {
                label: 'มูลค่าพอร์ตรวม',
                value: formatPrice(portfolioStats.totalValue),
                color: 'var(--ink-1)',
                accent: 'var(--blue)',
              },
              {
                label: 'ต้นทุนรวม',
                value: formatPrice(portfolioStats.totalCost),
                color: 'var(--ink-2)',
                accent: 'var(--violet)',
              },
              {
                label: 'กำไร/ขาดทุนรวม',
                value: formatPrice(portfolioStats.totalGain),
                color: portfolioStats.totalGain >= 0 ? 'var(--success)' : 'var(--danger)',
                accent: portfolioStats.totalGain >= 0 ? 'var(--emerald)' : 'var(--rose)',
              },
              {
                label: 'เปอร์เซ็นต์กำไร',
                value: formatPercent(portfolioStats.totalGainPercent),
                color: portfolioStats.totalGainPercent >= 0 ? 'var(--success)' : 'var(--danger)',
                accent: portfolioStats.totalGainPercent >= 0 ? 'var(--cyan)' : 'var(--rose)',
              },
            ].map(({ label, value, color, accent }) => (
              <div key={label} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 14px',
                background: 'var(--bg)',
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--border)',
                borderLeft: `3px solid ${accent}`,
              }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</span>
                <span style={{ fontSize: '17px', fontWeight: '700', fontFamily: 'var(--mono)', color, letterSpacing: '-.3px' }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          แถวกลาง: รายการถือครอง (ซ้าย) | Pie Chart (ขวา)
      ══════════════════════════════════════════════════════ */}
      {portfolio.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px', marginBottom: '18px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
          <p style={{ color: 'var(--ink-3)', fontSize: '16px' }}>ยังไม่มีหุ้นในพอร์ต</p>
          <p style={{ color: 'var(--ink-4)', fontSize: '13px', marginTop: '4px' }}>เพิ่มหุ้นด้วยฟอร์มด้านบน</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '18px', marginBottom: '18px', alignItems: 'start' }}>

            {/* ── ซ้าย: ตารางรายการถือครอง ── */}
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">📋 รายการถือครอง</h2>
                <span style={{ fontSize: '12px', color: 'var(--ink-4)', fontWeight: '500' }}>{portfolio.length} รายการ</span>
              </div>
              <div className="table-container" style={{ marginTop: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Type</th>
                      <th>จำนวน</th>
                      <th>ราคาซื้อ</th>
                      <th>ราคาปัจจุบัน</th>
                      <th>มูลค่า</th>
                      <th>กำไร/ขาดทุน</th>
                      <th>%</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.map(holding => {
                      const stock = allAssets.find(a => a.symbol === holding.symbol)
                      const currentPrice = stock?.price || holding.currentPrice
                      const value = holding.shares * currentPrice
                      const cost = holding.shares * holding.avgCost
                      const gain = value - cost
                      const gainPercent = cost > 0 ? (gain / cost) * 100 : 0
                      return (
                        <tr key={holding.symbol}>
                          <td><strong className="stock-symbol">{holding.symbol}</strong></td>
                          <td><Badge type={holding.type}>{holding.type}</Badge></td>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: '13px' }}>{formatShares(holding.shares)}</td>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: '13px' }}>{formatPrice(holding.avgCost)}</td>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: '13px' }}>{formatPrice(currentPrice)}</td>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: '13px', fontWeight: '600' }}>{formatPrice(value)}</td>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: gain >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: '600' }}>{formatPrice(gain)}</td>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: gain >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: '600' }}>{formatPercent(gainPercent)}</td>
                          <td>
                            <button className="btn-danger-small" onClick={() => {
                              removeFromPortfolio(holding.symbol)
                              addNotification(`ลบ ${holding.symbol} ออกจาก Portfolio แล้ว`, 'info')
                            }}>ลบ</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── ขวา: Pie Chart ── */}
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">🥧 สัดส่วนตามมูลค่า</h2>
              </div>
              <div style={{ height: '340px' }}>
                <Pie data={pieChartData} options={pieOptions} />
              </div>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════
              แถวล่างสุด: Bar Chart เต็มความกว้าง
          ══════════════════════════════════════════════════════ */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">📊 เปรียบเทียบมูลค่า</h2>
              <span style={{ fontSize: '12px', color: 'var(--ink-4)', fontWeight: '500' }}>Bar Chart</span>
            </div>
            <div style={{ height: '280px', padding: '4px 0' }}>
              <Bar data={barChartData} options={barOptions} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// --- WATCHLIST PAGE ---
function WatchlistPage({ allAssets, watchlist, addToWatchlist, removeFromWatchlist, setSelectedStock, addNotification }) {
  const [searchInput, setSearchInput] = useState('')
  const [searchResults, setSearchResults] = useState([])

  const handleSearch = () => {
    const q = searchInput.trim().toUpperCase()
    if (!q) return
    const results = allAssets.filter(a =>
      a.symbol.includes(q) || a.name.toUpperCase().includes(q)
    ).slice(0, 20)
    setSearchResults(results)
  }

  const watchlistStocks = allAssets.filter(a => watchlist.includes(a.symbol))

  return (
    <div className="container" style={{ paddingTop: '24px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '24px', color: 'var(--ink-1)' }}>
        📋 Watchlist
      </h1>

      {/* Search to add */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <h2 className="card-title">🔍 ค้นหาหุ้นเพื่อเพิ่ม Watchlist</h2>
        </div>
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <input
            type="text"
            className="form-input"
            style={{ flex: 1 }}
            placeholder="พิมพ์ Symbol หรือชื่อหุ้น เช่น AAPL, Apple"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && handleSearch()}
          />
          <button className="btn-primary" onClick={handleSearch}>ค้นหา</button>
        </div>
        {searchResults.length > 0 && (
          <div style={{ display: 'grid', gap: '8px', maxHeight: '300px', overflow: 'auto' }}>
            {searchResults.map(stock => (
              <div key={stock.symbol} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 14px', background: 'var(--surface-2)', borderRadius: '8px'
              }}>
                <div>
                  <span className="stock-symbol" style={{ marginRight: '8px' }}>{stock.symbol}</span>
                  <Badge type={stock.type}>{stock.type}</Badge>
                  <div style={{ fontSize: '12px', color: 'var(--ink-3)', marginTop: '2px' }}>{stock.name}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span className="price">{formatPrice(stock.price)}</span>
                  {watchlist.includes(stock.symbol) ? (
                    <button className="btn-danger-small" onClick={() => {
                      removeFromWatchlist(stock.symbol)
                      addNotification(`ลบ ${stock.symbol} ออกจาก Watchlist`, 'info')
                    }}>ลบ</button>
                  ) : (
                    <button className="btn-secondary" style={{ padding: '4px 12px', fontSize: '12px' }} onClick={() => {
                      addToWatchlist(stock.symbol)
                      addNotification(`เพิ่ม ${stock.symbol} ใน Watchlist แล้ว ✓`, 'success')
                    }}>+ เพิ่ม</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Watchlist */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">รายการ Watchlist ({watchlistStocks.length})</h2>
        </div>
        {watchlistStocks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--ink-3)' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>👀</div>
            <p>ยังไม่มีหุ้นใน Watchlist</p>
            <p style={{ fontSize: '13px', color: 'var(--ink-4)' }}>ค้นหาและเพิ่มหุ้นด้านบน</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '8px' }}>
            {watchlistStocks.map(stock => (
              <div key={stock.symbol} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 16px', background: 'var(--surface-2)', borderRadius: '10px',
                cursor: 'pointer'
              }} onClick={() => setSelectedStock(stock)}>
                <div>
                  <span className="stock-symbol" style={{ marginRight: '8px' }}>{stock.symbol}</span>
                  <Badge type={stock.type}>{stock.type}</Badge>
                  <div style={{ fontSize: '12px', color: 'var(--ink-3)', marginTop: '2px' }}>{stock.name}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', textAlign: 'right' }}>
                  <div>
                    <div className="price">{formatPrice(stock.price)}</div>
                    <PriceChange value={stock.changePercent || 0} />
                  </div>
                  <button className="btn-danger-small" onClick={e => {
                    e.stopPropagation()
                    removeFromWatchlist(stock.symbol)
                    addNotification(`ลบ ${stock.symbol} ออกจาก Watchlist`, 'info')
                  }}>ลบ</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// --- MARKET PAGE ---
// ==================== DETAIL MODALS ====================

// --- STOCK DETAIL MODAL ---
function StockDetailModal({ stock, onClose }) {
  if (!stock) return null
  const formatBig = (n) => {
    if (!n || isNaN(n)) return '-'
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
    if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`
    if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`
    return `$${n.toLocaleString()}`
  }
  const formatPct = (n) => n != null && !isNaN(n) ? `${(n * 100).toFixed(2)}%` : '-'

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
      onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '16px', width: '100%', maxWidth: '680px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '24px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <span style={{ fontSize: '28px', fontWeight: '800', color: 'var(--ink-1)' }}>{stock.symbol}</span>
              <Badge type={stock.type}>{stock.type}</Badge>
              {stock.sector && <SectorBadge sector={stock.sector} />}
            </div>
            <div style={{ fontSize: '14px', color: 'var(--ink-3)', marginBottom: '8px' }}>{stock.name}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
              <span style={{ fontSize: '32px', fontWeight: '700', color: 'var(--ink-1)' }}>{formatPrice(stock.price)}</span>
              <PriceChange value={stock.changePercent || 0} />
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'var(--surface-2)', border: 'none', borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer', fontSize: '18px', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px 24px', display: 'grid', gap: '16px' }}>
          {/* Price Info */}
          <div style={{ background: 'var(--surface-2)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--ink-4)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>📈 ข้อมูลราคา</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {[
                { label: 'Open',    val: formatPrice(stock.open) },
                { label: 'Day High', val: formatPrice(stock.dayHigh) },
                { label: 'Day Low',  val: formatPrice(stock.dayLow) },
                { label: '52W High', val: formatPrice(stock.high52w) },
                { label: '52W Low',  val: formatPrice(stock.low52w) },
                { label: 'Prev Close', val: formatPrice(stock.previousClose) },
              ].map(({ label, val }) => (
                <div key={label}>
                  <div style={{ fontSize: '11px', color: 'var(--ink-4)' }}>{label}</div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink-1)' }}>{val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Fundamental */}
          <div style={{ background: 'var(--surface-2)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--ink-4)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🏢 Fundamental</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {[
                { label: 'Market Cap', val: formatBig(stock.marketCap) },
                { label: 'P/E Ratio',  val: stock.peRatio ? stock.peRatio.toFixed(1) : '-' },
                { label: 'EPS',        val: stock.eps ? `$${stock.eps.toFixed(2)}` : '-' },
                { label: 'Div Yield',  val: stock.divYield ? `${(stock.divYield * 100).toFixed(2)}%` : '-' },
                { label: 'Beta',       val: stock.beta ? stock.beta.toFixed(2) : '-' },
                { label: 'ROE',        val: stock.roe ? `${(stock.roe * 100).toFixed(1)}%` : '-' },
              ].map(({ label, val }) => (
                <div key={label}>
                  <div style={{ fontSize: '11px', color: 'var(--ink-4)' }}>{label}</div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink-1)' }}>{val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Dividend Growth */}
          {(stock.divGrowth3Y || stock.divGrowth5Y || stock.divGrowth10Y) ? (
            <div style={{ background: 'var(--surface-2)', borderRadius: '12px', padding: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--ink-4)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>💰 Dividend Growth</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                {[
                  { label: '3Y Growth',  val: stock.divGrowth3Y  ? `${stock.divGrowth3Y.toFixed(1)}%`  : '-' },
                  { label: '5Y Growth',  val: stock.divGrowth5Y  ? `${stock.divGrowth5Y.toFixed(1)}%`  : '-' },
                  { label: '10Y Growth', val: stock.divGrowth10Y ? `${stock.divGrowth10Y.toFixed(1)}%` : '-' },
                ].map(({ label, val }) => (
                  <div key={label}>
                    <div style={{ fontSize: '11px', color: 'var(--ink-4)' }}>{label}</div>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink-1)' }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Company Info */}
          {stock.industry && (
            <div style={{ background: 'var(--surface-2)', borderRadius: '12px', padding: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--ink-4)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🏭 บริษัท</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                {[
                  { label: 'Sector',   val: stock.sector   || '-' },
                  { label: 'Industry', val: stock.industry || '-' },
                  { label: 'Revenue Growth YoY', val: stock.revenueGrowthYoY ? `${(stock.revenueGrowthYoY * 100).toFixed(1)}%` : '-' },
                  { label: 'Operating Margin',   val: stock.operatingMargin  ? `${(stock.operatingMargin * 100).toFixed(1)}%`  : '-' },
                ].map(({ label, val }) => (
                  <div key={label}>
                    <div style={{ fontSize: '11px', color: 'var(--ink-4)' }}>{label}</div>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink-1)' }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// --- ETF DETAIL MODAL ---
function ETFDetailModal({ etf, onClose }) {
  if (!etf) return null
  const formatBig = (n) => {
    if (!n || isNaN(n)) return '-'
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
    if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`
    if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`
    return `$${n.toLocaleString()}`
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
      onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '16px', width: '100%', maxWidth: '680px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '24px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <span style={{ fontSize: '28px', fontWeight: '800', color: 'var(--ink-1)' }}>{etf.symbol}</span>
              <Badge type="ETF">ETF</Badge>
              {etf.category && <SectorBadge sector={etf.category} />}
            </div>
            <div style={{ fontSize: '14px', color: 'var(--ink-3)', marginBottom: '8px' }}>{etf.name}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
              <span style={{ fontSize: '32px', fontWeight: '700', color: 'var(--ink-1)' }}>{formatPrice(etf.price)}</span>
              <PriceChange value={etf.changePercent || 0} />
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'var(--surface-2)', border: 'none', borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer', fontSize: '18px', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px 24px', display: 'grid', gap: '16px' }}>
          {/* ETF Overview */}
          <div style={{ background: 'var(--surface-2)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--ink-4)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>📊 ETF Overview</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {[
                { label: 'AUM (Total Assets)', val: formatBig(etf.totalAssets) },
                { label: 'Expense Ratio',      val: etf.expenseRatio ? `${etf.expenseRatio.toFixed(2)}%` : '-' },
                { label: 'Num Holdings',       val: etf.numHoldings  ? etf.numHoldings.toLocaleString() : '-' },
                { label: 'Tracking Index',     val: etf.trackingIndex || '-' },
                { label: 'Inception Date',     val: etf.inceptionDate || '-' },
                { label: 'Beta',               val: etf.beta ? etf.beta.toFixed(2) : '-' },
              ].map(({ label, val }) => (
                <div key={label}>
                  <div style={{ fontSize: '11px', color: 'var(--ink-4)' }}>{label}</div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink-1)', wordBreak: 'break-word' }}>{val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Price Info */}
          <div style={{ background: 'var(--surface-2)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--ink-4)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>📈 ข้อมูลราคา</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {[
                { label: 'Open',      val: formatPrice(etf.open) },
                { label: 'Day High',  val: formatPrice(etf.dayHigh) },
                { label: 'Day Low',   val: formatPrice(etf.dayLow) },
                { label: '52W High',  val: formatPrice(etf.high52w) },
                { label: '52W Low',   val: formatPrice(etf.low52w) },
                { label: 'Prev Close',val: formatPrice(etf.previousClose) },
              ].map(({ label, val }) => (
                <div key={label}>
                  <div style={{ fontSize: '11px', color: 'var(--ink-4)' }}>{label}</div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink-1)' }}>{val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Dividend */}
          <div style={{ background: 'var(--surface-2)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--ink-4)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>💰 Dividend & Yield</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {[
                { label: 'Div Yield',         val: etf.divYield          ? `${(etf.divYield * 100).toFixed(2)}%` : '-' },
                { label: 'Distribution Rate', val: etf.distributionRate   ? `${etf.distributionRate.toFixed(2)}%`  : '-' },
                { label: 'Yield TTM',         val: etf.yieldTTM           ? `${etf.yieldTTM.toFixed(2)}%`          : '-' },
                { label: 'Div Freq',          val: etf.dividendFrequency  || '-' },
                { label: '3Y Div Growth',     val: etf.divGrowth3Y        ? `${etf.divGrowth3Y.toFixed(1)}%`  : '-' },
                { label: '5Y Div Growth',     val: etf.divGrowth5Y        ? `${etf.divGrowth5Y.toFixed(1)}%`  : '-' },
              ].map(({ label, val }) => (
                <div key={label}>
                  <div style={{ fontSize: '11px', color: 'var(--ink-4)' }}>{label}</div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink-1)' }}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ==================== MARKET PAGE ====================
function MarketPage({ allAssets }) {
  const [filterType, setFilterType] = useState('ALL')
  const [sortBy, setSortBy]         = useState('changePercent')
  const [sortDir, setSortDir]       = useState('desc')
  const [search, setSearch]         = useState('')
  const [selectedDetail, setSelectedDetail] = useState(null)

  const filtered = useMemo(() => {
    let list = [...allAssets]
    if (filterType !== 'ALL') list = list.filter(a => a.type === filterType)
    if (search.trim()) {
      const q = search.trim().toUpperCase()
      list = list.filter(a => a.symbol.includes(q) || a.name.toUpperCase().includes(q))
    }
    list.sort((a, b) => {
      const aVal = a[sortBy] || 0
      const bVal = b[sortBy] || 0
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal
    })
    return list
  }, [allAssets, filterType, sortBy, sortDir, search])

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(col); setSortDir('desc') }
  }

  const gainers = allAssets.filter(a => a.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 5)
  const losers  = allAssets.filter(a => a.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 5)

  // คอลัมน์ตามประเภท filter
  const isETFView   = filterType === 'ETF'
  const isStockView = filterType === 'STOCK'

  return (
    <div className="container" style={{ paddingTop: '24px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '24px', color: 'var(--ink-1)' }}>
        🌍 Market Overview
      </h1>

      {/* Market Indices */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header"><h2 className="card-title">📈 ดัชนีตลาด</h2></div>
        <div className="market-indices">
          <MarketIndex name="S&P 500"   value={4783.45}  change={0.54}  />
          <MarketIndex name="DOW JONES" value={37305.16} change={0.36}  />
          <MarketIndex name="NASDAQ"    value={14813.92} change={0.82}  />
          <MarketIndex name="VIX"       value={13.45}    change={-2.1}  />
        </div>
        <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--ink-4)', textAlign: 'right' }}>
          ⚠️ ดัชนีนี้เป็นข้อมูล static — ใส่ API key ใน .env เพื่อดึงข้อมูลจริง
        </div>
      </div>

      {/* Top Gainers / Losers */}
      {allAssets.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
          <div className="card">
            <div className="card-header"><h2 className="card-title">🚀 Top Gainers</h2></div>
            {gainers.map(s => (
              <div key={s.symbol} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onClick={() => setSelectedDetail(s)}>
                <div>
                  <span className="stock-symbol">{s.symbol}</span>
                  <Badge type={s.type} style={{ marginLeft: '6px' }}>{s.type}</Badge>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div>{formatPrice(s.price)}</div>
                  <span className="change positive">{formatPercent(s.changePercent)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card-header"><h2 className="card-title">📉 Top Losers</h2></div>
            {losers.map(s => (
              <div key={s.symbol} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onClick={() => setSelectedDetail(s)}>
                <div>
                  <span className="stock-symbol">{s.symbol}</span>
                  <Badge type={s.type}>{s.type}</Badge>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div>{formatPrice(s.price)}</div>
                  <span className="change negative">{formatPercent(s.changePercent)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Assets Table */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">📊 ข้อมูลหุ้นทั้งหมด ({filtered.length} รายการ)</h2>
          <span style={{ fontSize: '12px', color: 'var(--ink-4)' }}>คลิกแถวเพื่อดูรายละเอียด</span>
        </div>
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <input type="text" className="form-input" style={{ flex: 1, minWidth: '200px' }}
            placeholder="ค้นหา symbol หรือชื่อ..." value={search}
            onChange={e => setSearch(e.target.value)} />
          <div className="type-filter" style={{ margin: 0 }}>
            {['ALL', 'STOCK', 'ETF', 'REIT', 'BOND'].map(t => (
              <button key={t} className={`filter-btn ${filterType === t ? 'active' : ''}`}
                onClick={() => { setFilterType(t); setSortBy('changePercent'); setSortDir('desc') }}>{t}</button>
            ))}
          </div>
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Name</th>
                <th>Type</th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('price')}>
                  ราคา {sortBy === 'price' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                </th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('changePercent')}>
                  %เปลี่ยน {sortBy === 'changePercent' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                </th>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('divYield')}>
                  Div Yield {sortBy === 'divYield' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                </th>
                {/* คอลัมน์ Stock เท่านั้น */}
                {!isETFView && (
                  <th style={{ cursor: 'pointer' }} onClick={() => handleSort('peRatio')}>
                    P/E {sortBy === 'peRatio' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                )}
                {/* คอลัมน์ ETF เท่านั้น */}
                {isETFView && (
                  <>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('expenseRatio')}>
                      Exp. Ratio {sortBy === 'expenseRatio' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                    </th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('totalAssets')}>
                      AUM {sortBy === 'totalAssets' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                    </th>
                    <th>Tracking Index</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map(a => (
                <tr key={a.symbol} style={{ cursor: 'pointer' }} onClick={() => setSelectedDetail(a)}>
                  <td><strong className="stock-symbol">{a.symbol}</strong></td>
                  <td style={{ fontSize: '13px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</td>
                  <td><Badge type={a.type}>{a.type}</Badge></td>
                  <td>{formatPrice(a.price)}</td>
                  <td><PriceChange value={a.changePercent || 0} /></td>
                  <td>{a.divYield ? `${(a.divYield * 100).toFixed(2)}%` : '-'}</td>
                  {!isETFView && <td>{a.peRatio ? a.peRatio.toFixed(1) : '-'}</td>}
                  {isETFView && (
                    <>
                      <td style={{ color: 'var(--ink-3)' }}>{a.expenseRatio ? `${a.expenseRatio.toFixed(2)}%` : '-'}</td>
                      <td style={{ color: 'var(--ink-3)' }}>
                        {a.totalAssets
                          ? a.totalAssets >= 1e9
                            ? `$${(a.totalAssets / 1e9).toFixed(1)}B`
                            : `$${(a.totalAssets / 1e6).toFixed(0)}M`
                          : '-'}
                      </td>
                      <td style={{ fontSize: '12px', color: 'var(--ink-3)', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.trackingIndex || '-'}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 100 && (
            <div style={{ textAlign: 'center', padding: '12px', color: 'var(--ink-4)', fontSize: '13px' }}>
              แสดง 100 รายการแรก จากทั้งหมด {filtered.length} รายการ (ใช้ช่องค้นหาเพื่อกรอง)
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {selectedDetail && selectedDetail.type === 'ETF' && (
        <ETFDetailModal etf={selectedDetail} onClose={() => setSelectedDetail(null)} />
      )}
      {selectedDetail && selectedDetail.type !== 'ETF' && (
        <StockDetailModal stock={selectedDetail} onClose={() => setSelectedDetail(null)} />
      )}
    </div>
  )
}

// --- SETTINGS PAGE ---

function SettingsPage({ liveMode, setLiveMode, dataSource, lastUpdate, addNotification, allAssets, watchlist, portfolio, onClearWatchlist, onClearPortfolio, onImport, onToggleLive }) {
  const hasApiKey = Object.values(API_KEYS).some(k => k && k.length > 0)

  const clearWatchlist = () => {
    if (confirm('ยืนยันการล้าง Watchlist ทั้งหมด?')) {
      onClearWatchlist()
      addNotification('ล้าง Watchlist แล้ว', 'info')
    }
  }

  const clearPortfolio = () => {
    if (confirm('ยืนยันการล้าง Portfolio ทั้งหมด?')) {
      onClearPortfolio()
      addNotification('ล้าง Portfolio แล้ว', 'info')
    }
  }

  const exportData = () => {
    const data = { watchlist, portfolio, exportedAt: new Date().toISOString() }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'portfolio-backup.json'; a.click()
    URL.revokeObjectURL(url)
    addNotification('Export ข้อมูลสำเร็จ ✓', 'success')
  }

  const importData = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        onImport(data)
        addNotification('Import ข้อมูลสำเร็จ ✓', 'success')
      } catch {
        addNotification('ไฟล์ไม่ถูกต้อง', 'error')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="container" style={{ paddingTop: '24px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '24px', color: 'var(--ink-1)' }}>
        ⚙️ Settings
      </h1>

      {/* Live Mode */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="card-header"><h2 className="card-title">🔴 Live Mode</h2></div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}>
          <div>
            <div style={{ fontWeight: '600', marginBottom: '4px' }}>เปิด/ปิด Live Mode</div>
            <div style={{ fontSize: '13px', color: 'var(--ink-3)' }}>
              เมื่อเปิด: ดึงราคาหุ้นจาก API จริงทุก 2 ชั่วโมง<br />
              เมื่อปิด: ใช้ข้อมูลจาก local JSON file
            </div>
          </div>
          <button
            className={liveMode ? 'btn-secondary' : 'btn-primary'}
            style={{ minWidth: '120px' }}
            onClick={() => onToggleLive()}
          >
            {liveMode ? '⏸ Pause' : '▶ เปิด Live'}
          </button>
        </div>

        <div style={{ padding: '12px', background: 'var(--surface-2)', borderRadius: '8px', marginTop: '8px' }}>
          <div style={{ fontSize: '13px', color: 'var(--ink-3)', marginBottom: '8px' }}>
            <strong>สถานะ API Keys:</strong>
          </div>
          {[
            { name: 'Finnhub', key: API_KEYS.FINNHUB },
            { name: 'FMP', key: API_KEYS.FMP },
            { name: 'Twelve Data', key: API_KEYS.TWELVE },
            { name: 'EODHD', key: API_KEYS.EODHD }
          ].map(api => (
            <div key={api.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', marginBottom: '4px' }}>
              <span style={{ color: api.key ? 'var(--success)' : '#94a3b8' }}>
                {api.key ? '✅' : '❌'}
              </span>
              <span>{api.name}</span>
              <span style={{ color: api.key ? 'var(--success)' : '#94a3b8' }}>
                {api.key ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า (.env)'}
              </span>
            </div>
          ))}
          {!hasApiKey && (
            <div style={{ marginTop: '8px', padding: '8px', background: 'var(--amber-soft)', borderRadius: 'var(--r-md)', fontSize: '12px', color: 'var(--amber)' }}>
              ⚠️ ยังไม่มี API Key — Live Mode จะไม่ดึงข้อมูลจริง กรุณาตั้งค่าใน <code>.env</code>
            </div>
          )}
        </div>
      </div>

      {/* Data Status */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="card-header"><h2 className="card-title">📊 ข้อมูล</h2></div>
        <div style={{ fontSize: '14px', lineHeight: '2' }}>
          <div>📁 แหล่งข้อมูล: <strong>{dataSource === 'local' ? 'Local File' : 'GitHub Raw'}</strong></div>
          <div>🕐 อัพเดทล่าสุด: <strong>{lastUpdate ? lastUpdate.toLocaleString('th-TH') : 'ยังไม่ได้อัพเดท'}</strong></div>
          <div>📦 จำนวนสินทรัพย์: <strong>{allAssets.length} รายการ</strong></div>
          <div>👀 Watchlist: <strong>{watchlist.length} รายการ</strong></div>
          <div>💼 Portfolio: <strong>{portfolio.length} รายการ</strong></div>
        </div>
      </div>

      {/* Backup / Restore */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="card-header"><h2 className="card-title">💾 Backup & Restore</h2></div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={exportData}>📤 Export JSON</button>
          <label className="btn-secondary" style={{ cursor: 'pointer' }}>
            📥 Import JSON
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={importData} />
          </label>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="card" style={{ borderColor: 'var(--rose-mid)' }}>
        <div className="card-header"><h2 className="card-title" style={{ color: 'var(--danger)' }}>⚠️ Danger Zone</h2></div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button className="btn-danger-small" style={{ padding: '8px 16px', fontSize: '14px' }} onClick={clearWatchlist}>
            🗑 ล้าง Watchlist
          </button>
          <button className="btn-danger-small" style={{ padding: '8px 16px', fontSize: '14px' }} onClick={clearPortfolio}>
            🗑 ล้าง Portfolio
          </button>
        </div>
      </div>
    </div>
  )
}

// ==================== AUTH BUTTON COMPONENT ====================
function AuthNavButton({ user, authLoading, onSignIn, onSignOut }) {
  if (authLoading) return <div style={{ width: 90, height: 34, background: 'var(--surface-3)', borderRadius: 8 }} />

  if (!user) return (
    <button onClick={onSignIn} style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '7px 14px', background: '#fff', border: '1px solid var(--border)',
      borderRadius: 8, fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
      fontSize: 13, color: 'var(--ink-1)', cursor: 'pointer',
      boxShadow: '0 1px 4px rgba(15,23,42,0.08)', whiteSpace: 'nowrap'
    }}>
      <svg width="16" height="16" viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg>
      Sign in
    </button>
  )

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {user.photoURL
        ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer"
            style={{ width: 30, height: 30, borderRadius: '50%', border: '2px solid #e2e8f0', objectFit: 'cover' }} />
        : <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--blue)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>
            {user.displayName?.[0] ?? 'U'}
          </div>
      }
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {user.displayName?.split(' ')[0]}
      </span>
      <button onClick={onSignOut} style={{
        padding: '4px 10px', background: 'transparent', border: '1px solid var(--border)',
        borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--ink-3)',
        cursor: 'pointer', fontFamily: "'DM Sans', sans-serif"
      }}>ออก</button>
    </div>
  )
}

// ==================== MAIN APP ====================
function App() {
  const [allAssets, setAllAssets] = useState([])
  const [watchlist, setWatchlist] = useState([])   // array of symbols (strings)
  const [portfolio, setPortfolio] = useState([])   // array of holding objects
  const [selectedStock, setSelectedStock] = useState(null)
  const [liveMode, setLiveMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [dataSource, setDataSource] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState('ALL')
  const [countdown, setCountdown] = useState(7200)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [notifications, setNotifications] = useState([])
  // FIX: currentPage state สำหรับ navigation จริง
  const [currentPage, setCurrentPage] = useState('dashboard')

  // ── Firebase Auth ──────────────────────────────────────────────────────────
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      setAuthLoading(false)
    })
    return unsub
  }, [])

  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        addNotification('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่', 'error')
      }
    }
  }

  const handleSignOut = async () => {
    await firebaseSignOut(auth)
    setWatchlist([])
    setPortfolio([])
    addNotification('ออกจากระบบแล้ว', 'info')
  }

  // ── Firestore real-time sync ───────────────────────────────────────────────
  useEffect(() => {
    if (!user) return

    const uid = user.uid

    // subscribe watchlist: users/{uid}/watchlist/{symbol}
    const unsubWatch = onSnapshot(collection(db, 'users', uid, 'watchlist'), (snap) => {
      const items = snap.docs.map(d => d.id) // symbol strings
      setWatchlist(items)
    })

    // subscribe portfolio: users/{uid}/portfolio/{symbol}
    const unsubPort = onSnapshot(collection(db, 'users', uid, 'portfolio'), (snap) => {
      const items = snap.docs.map(d => ({ ...d.data(), symbol: d.id }))
      items.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0))
      setPortfolio(items)
    })

    return () => { unsubWatch(); unsubPort() }
  }, [user])

  // Notification system
  const addNotification = useCallback((message, type = 'info') => {
    const id = Date.now()
    setNotifications(prev => [...prev, { id, message, type }])
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 3000)
  }, [])

  useEffect(() => {
    loadInitialData()
    // loadUserData() ← ถูกแทนที่ด้วย Firestore onSnapshot ด้านบนแล้ว
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 0) {
          if (liveMode) updateLiveData()
          return 7200
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [liveMode])

  useEffect(() => {
    if (liveMode) {
      const interval = setInterval(() => updateLiveData(), CONFIG.UPDATE_INTERVAL)
      return () => clearInterval(interval)
    }
  }, [liveMode])

  // Handle hash navigation
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '') || 'dashboard'
      const validPages = ['dashboard', 'portfolio', 'watchlist', 'market', 'settings']
      setCurrentPage(validPages.includes(hash) ? hash : 'dashboard')
    }
    handleHash()
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])

  const navigateTo = (page) => {
    window.location.hash = page === 'dashboard' ? '' : page
    setCurrentPage(page)
  }

  const loadInitialData = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      let stocksData = null
      let etfsData = null

      // --- ลอง local ก่อน ---
      try {
        const [sRes, eRes] = await Promise.all([
          fetch(CONFIG.STOCKS_URL),
          fetch(CONFIG.ETFS_URL)
        ])
        if (sRes.ok && eRes.ok) {
          const [sText, eText] = await Promise.all([sRes.text(), eRes.text()])
          if (sText.trim().startsWith('[') && eText.trim().startsWith('[')) {
            stocksData = JSON.parse(sText)
            etfsData   = JSON.parse(eText)
            setDataSource('local')
          }
        }
      } catch (localErr) { console.warn('Local fetch failed', localErr) }

      // --- fallback GitHub ---
      if (!stocksData || !etfsData) {
        const [sRes, eRes] = await Promise.all([
          fetch(CONFIG.GITHUB_STOCKS_URL),
          fetch(CONFIG.GITHUB_ETFS_URL)
        ])
        if (!sRes.ok || !eRes.ok) throw new Error('GitHub fetch failed')
        ;[stocksData, etfsData] = await Promise.all([sRes.json(), eRes.json()])
        setDataSource('github')
      }

      if (!Array.isArray(stocksData) || !Array.isArray(etfsData)) throw new Error('ข้อมูลไม่ถูกต้อง')
      setAllAssets([...stocksData, ...etfsData])
      setLastUpdate(new Date())
    } catch (e) {
      console.error('Failed to load data:', e)
      setLoadError(e.message || 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  // loadUserData ถูกแทนที่ด้วย Firestore onSnapshot แล้ว — ไม่ต้องใช้ localStorage อีกต่อไป

  const updateLiveData = async () => {
    const symbols = [...new Set([...watchlist.filter(s => typeof s === 'string'), ...portfolio.map(p => p.symbol)])]
    for (const symbol of symbols) {
      const data = await APIService.fetchQuote(symbol)
      if (data) {
        setAllAssets(prev => prev.map(asset =>
          asset.symbol === symbol ? { ...asset, price: data.price, change: data.change, changePercent: data.changePercent } : asset
        ))
      }
    }
    setLastUpdate(new Date())
  }

  const addToWatchlist = async (symbol) => {
    if (!user) { addNotification('กรุณาเข้าสู่ระบบก่อน', 'error'); return }
    if (!watchlist.includes(symbol)) {
      await setDoc(doc(db, 'users', user.uid, 'watchlist', symbol.toUpperCase()), {
        symbol: symbol.toUpperCase(), createdAt: serverTimestamp()
      })
    }
  }

  const removeFromWatchlist = async (symbol) => {
    if (!user) return
    await deleteDoc(doc(db, 'users', user.uid, 'watchlist', symbol.toUpperCase()))
  }

  // FIX: return true/false เพื่อให้ form รู้ว่าสำเร็จหรือไม่
  const addToPortfolio = async (symbol, shares, avgCost) => {
    if (!user) { addNotification('กรุณาเข้าสู่ระบบก่อน', 'error'); return false }
    const stock = allAssets.find(a => a.symbol === symbol.toUpperCase())
    if (!stock) return false

    const sym = symbol.toUpperCase()
    const existing = portfolio.find(p => p.symbol === sym)
    const docRef = doc(db, 'users', user.uid, 'portfolio', sym)

    if (existing) {
      const totalShares = existing.shares + parseFloat(shares)
      const avgPrice = ((existing.shares * existing.avgCost) + (parseFloat(shares) * parseFloat(avgCost))) / totalShares
      await setDoc(docRef, { shares: totalShares, avgCost: avgPrice, updatedAt: serverTimestamp() }, { merge: true })
    } else {
      await setDoc(docRef, {
        symbol: sym,
        name: stock.name,
        type: stock.type,
        shares: parseFloat(shares),
        avgCost: parseFloat(avgCost),
        currentPrice: stock.price,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    }
    return true
  }

  const removeFromPortfolio = async (symbol) => {
    if (!user) return
    await deleteDoc(doc(db, 'users', user.uid, 'portfolio', symbol.toUpperCase()))
  }

  const handleSearch = () => {
    const query = searchQuery.trim().toUpperCase()
    if (!query) return
    const found = allAssets.find(a => a.symbol === query || a.name.toUpperCase().includes(query))
    if (found) {
      setSelectedStock(found)
      addNotification(`พบ ${found.symbol} — กด + เพิ่ม Watchlist`, 'info') 
    } else {
      addNotification(`ไม่พบหุ้น: ${query}`, 'error')
    }
  }

  const filteredWatchlist = useMemo(() => {
    let stocks = allAssets.filter(a => watchlist.includes(a.symbol))
    if (filterType !== 'ALL') stocks = stocks.filter(s => s.type === filterType)
    return stocks
  }, [allAssets, watchlist, filterType])

  const portfolioStats = useMemo(() => {
    const totalValue = portfolio.reduce((sum, p) => {
      const stock = allAssets.find(a => a.symbol === p.symbol)
      return sum + (p.shares * (stock?.price || p.currentPrice))
    }, 0)
    const totalCost = portfolio.reduce((sum, p) => sum + (p.shares * p.avgCost), 0)
    const totalGain = totalValue - totalCost
    return {
      totalValue, totalCost, totalGain,
      totalGainPercent: totalCost > 0 ? (totalGain / totalCost) * 100 : 0,
      count: portfolio.length
    }
  }, [portfolio, allAssets])

  const [chartData, setChartData] = useState(() => Array.from({ length: 14 }, () => 0))
  useEffect(() => {
    if (!selectedStock) return
    const gen = () => Array.from({ length: 14 }, () => selectedStock.price + (Math.random() - 0.5) * 5)
    setChartData(gen())
    const interval = setInterval(() => setChartData(gen()), 15 * 60 * 1000)
    return () => clearInterval(interval)
  }, [selectedStock?.symbol])

  const pieChartData = useMemo(() => {
    const data = portfolio.map(p => {
      const stock = allAssets.find(a => a.symbol === p.symbol)
      return { symbol: p.symbol, value: p.shares * (stock?.price || p.currentPrice) }
    })
    return {
      labels: data.map(d => d.symbol),
      datasets: [{ data: data.map(d => d.value), backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'] }]
    }
  }, [portfolio, allAssets])

  const barChartData = useMemo(() => {
    const data = portfolio.map(p => {
      const stock = allAssets.find(a => a.symbol === p.symbol)
      return { symbol: p.symbol, value: p.shares * (stock?.price || p.currentPrice) }
    })
    return {
      labels: data.map(d => d.symbol),
      datasets: [{ label: 'มูลค่า ($)', data: data.map(d => d.value), backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'] }]
    }
  }, [portfolio, allAssets])

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <p>กำลังโหลดข้อมูล...</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="loading">
        <p style={{ color: '#ef4444', fontSize: '18px', marginBottom: '12px' }}>⚠️ โหลดข้อมูลไม่สำเร็จ</p>
        <p style={{ color: 'var(--ink-3)', fontSize: '14px', marginBottom: '20px' }}>{loadError}</p>
        <button onClick={loadInitialData} style={{ padding: '10px 24px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
          🔄 ลองใหม่อีกครั้ง
        </button>
      </div>
    )
  }

  const sharedProps = {
    allAssets, portfolio, watchlist, portfolioStats, pieChartData, barChartData,
    addToPortfolio, removeFromPortfolio, addToWatchlist, removeFromWatchlist,
    selectedStock, setSelectedStock, addNotification
  }

  return (
    <div className="app">
      {/* Notifications */}
      <div style={{ position: 'fixed', top: '80px', right: '20px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {notifications.map(n => (
          <div key={n.id} style={{
            padding: '10px 16px', borderRadius: '8px', fontSize: '14px', fontWeight: '500',
            background: n.type === 'success' ? 'var(--emerald-soft)' : n.type === 'error' ? 'var(--rose-soft)' : 'var(--blue-soft)',
            color: n.type === 'success' ? 'var(--emerald)' : n.type === 'error' ? 'var(--rose)' : 'var(--blue)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', animation: 'slideIn 0.2s ease',
            maxWidth: '300px'
          }}>
            {n.message}
          </div>
        ))}
      </div>

      {/* Header */}
      <header>
        <div className="container">
          <nav>
            <div className="logo">
              <div className="logo-icon">$</div>
              <span>US Stock Portfolio V7</span>
            </div>
            {/* FIX: Navigation ทำงานจริง */}
            <ul className="nav-menu">
              {[
                { id: 'dashboard', label: 'Dashboard' },
                { id: 'portfolio', label: 'Portfolio' },
                { id: 'watchlist', label: 'Watchlist' },
                { id: 'market', label: 'Market' },
                { id: 'settings', label: 'Settings' }
              ].map(({ id, label }) => (
                <li key={id}>
                  <a
                    href={`#${id === 'dashboard' ? '' : id}`}
                    className={currentPage === id ? 'active' : ''}
                    onClick={(e) => { e.preventDefault(); navigateTo(id) }}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="live-status" onClick={() => {
              const newMode = !liveMode
              setLiveMode(newMode)
              if (newMode) {
                updateLiveData()
                setCountdown(7200)
              }
              addNotification(newMode ? 'เปิด Live Mode แล้ว' : 'ปิด Live Mode แล้ว', 'info')
            }}>
              <LiveDot active={liveMode} />
              <span>{liveMode ? 'Live Mode' : 'Paused'}</span>
            </div>
            {dataSource && (
              <div style={{ fontSize: '11px', color: 'var(--ink-3)', marginLeft: '12px' }}>
                {dataSource === 'local' ? '📁 Local' : '☁️ GitHub'}
                {lastUpdate && ` · ${lastUpdate.toLocaleTimeString('th-TH')}`}
              </div>
            )}
            {/* ── Google Auth Button ── */}
            <AuthNavButton user={user} authLoading={authLoading} onSignIn={handleSignIn} onSignOut={handleSignOut} />
          </nav>
        </div>
      </header>

      {/* Search Section (แสดงเฉพาะ Dashboard และ Watchlist) */}
      {(currentPage === 'dashboard' || currentPage === 'watchlist') && (
        <section className="search-section">
          <div className="container">
            <div className="search-container">
              <div className="search-wrapper">
                <input
                  type="text"
                  className="search-input"
                  placeholder="ค้นหาหุ้น เช่น AAPL, TSLA, VXUS..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                />
                <span className="search-icon">🔍</span>
              </div>
              <button className="btn-primary" onClick={handleSearch}>ค้นหา</button>
            </div>
          </div>
        </section>
      )}

      {/* Page Content */}
      {currentPage === 'dashboard' && (
        <DashboardPage
          filteredWatchlist={filteredWatchlist}
          filterType={filterType}
          setFilterType={setFilterType}
          selectedStock={selectedStock}
          setSelectedStock={setSelectedStock}
          chartData={chartData}
          countdown={countdown}
          portfolio={portfolio}
          allAssets={allAssets}
          portfolioStats={portfolioStats}
          pieChartData={pieChartData}
          barChartData={barChartData}
          addToPortfolio={addToPortfolio}
          removeFromPortfolio={removeFromPortfolio}
          addNotification={addNotification}
        />
      )}

      {currentPage === 'portfolio' && (
        <PortfolioPage
          portfolio={portfolio}
          allAssets={allAssets}
          portfolioStats={portfolioStats}
          pieChartData={pieChartData}
          barChartData={barChartData}
          removeFromPortfolio={removeFromPortfolio}
          addToPortfolio={addToPortfolio}
          addNotification={addNotification}
        />
      )}

      {currentPage === 'watchlist' && (
        <WatchlistPage
          allAssets={allAssets}
          watchlist={watchlist}
          addToWatchlist={addToWatchlist}
          removeFromWatchlist={removeFromWatchlist}
          setSelectedStock={setSelectedStock}
          addNotification={addNotification}
        />
      )}

      {currentPage === 'market' && (
        <MarketPage allAssets={allAssets} />
      )}

      {currentPage === 'settings' && (
        <SettingsPage
          liveMode={liveMode}
          setLiveMode={setLiveMode}
          dataSource={dataSource}
          lastUpdate={lastUpdate}
          addNotification={addNotification}
          allAssets={allAssets}
          watchlist={watchlist}
          portfolio={portfolio}
          onClearWatchlist={async () => {
            if (!user) return
            const snap = await import('firebase/firestore').then(({ getDocs, collection: col }) =>
              getDocs(col(db, 'users', user.uid, 'watchlist'))
            )
            const { deleteDoc: del, doc: d } = await import('firebase/firestore')
            await Promise.all(snap.docs.map(dc => del(d(db, 'users', user.uid, 'watchlist', dc.id))))
          }}
          onClearPortfolio={async () => {
            if (!user) return
            const snap = await import('firebase/firestore').then(({ getDocs, collection: col }) =>
              getDocs(col(db, 'users', user.uid, 'portfolio'))
            )
            const { deleteDoc: del, doc: d } = await import('firebase/firestore')
            await Promise.all(snap.docs.map(dc => del(d(db, 'users', user.uid, 'portfolio', dc.id))))
          }}
          onImport={async (data) => {
            if (!user) return
            if (data.watchlist) {
              await Promise.all(data.watchlist.map(sym =>
                setDoc(doc(db, 'users', user.uid, 'watchlist', sym), { symbol: sym, createdAt: serverTimestamp() })
              ))
            }
            if (data.portfolio) {
              await Promise.all(data.portfolio.map(h =>
                setDoc(doc(db, 'users', user.uid, 'portfolio', h.symbol), { ...h, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
              ))
            }
          }}
          onToggleLive={() => {
            const newMode = !liveMode
            setLiveMode(newMode)
            if (newMode) { updateLiveData(); setCountdown(7200) }
            addNotification(newMode ? 'เปิด Live Mode แล้ว' : 'ปิด Live Mode แล้ว', 'info')
          }}
        />
      )}

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }

        /* ── Bottom Nav Bar (mobile only) ── */
        .bottom-nav {
          display: none;
        }
        @media (max-width: 768px) {
          .bottom-nav {
            display: flex;
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            z-index: 200;
            background: #ffffff;
            border-top: 1px solid var(--border);
            box-shadow: 0 -4px 20px rgba(0,0,0,0.06);
            padding: 6px 0 10px;
            justify-content: space-around;
            align-items: center;
          }
          .bottom-nav-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 3px;
            flex: 1;
            cursor: pointer;
            padding: 4px 0;
            border: none;
            background: transparent;
            color: var(--ink-4);
            font-size: 10px;
            font-weight: 600;
            font-family: 'DM Sans', sans-serif;
            transition: color 0.2s;
          }
          .bottom-nav-item.active {
            color: var(--blue);
          }
          .bottom-nav-item svg {
            width: 22px;
            height: 22px;
          }
          .bottom-nav-item .nav-dot {
            width: 4px;
            height: 4px;
            border-radius: 50%;
            background: #1e40af;
            margin-top: 2px;
            opacity: 0;
          }
          .bottom-nav-item.active .nav-dot {
            opacity: 1;
          }
          /* เพิ่ม padding ด้านล่างให้ content ไม่ถูก bottom nav บัง */
          .app > *:not(.bottom-nav):not(header) {
            padding-bottom: 70px;
          }
        }
      `}</style>

      {/* ── Bottom Navigation Bar (mobile only) ── */}
      <nav className="bottom-nav">
        {[
          { id: 'dashboard', label: 'หน้าหลัก', icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
          )},
          { id: 'portfolio', label: 'พอร์ต', icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
              <line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
            </svg>
          )},
          { id: 'watchlist', label: 'วอชลิสต์', icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          )},
          { id: 'market', label: 'ตลาด', icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
              <polyline points="16 7 22 7 22 13"/>
            </svg>
          )},
          { id: 'settings', label: 'ตั้งค่า', icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          )},
        ].map(({ id, label, icon }) => (
          <button
            key={id}
            className={`bottom-nav-item ${currentPage === id ? 'active' : ''}`}
            onClick={() => navigateTo(id)}
          >
            {icon}
            <span>{label}</span>
            <div className="nav-dot" />
          </button>
        ))}
      </nav>
    </div>
  )
}

export default App
