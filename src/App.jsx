import { useState, useEffect, useMemo, useCallback } from 'react'
import { Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js'
import { Pie, Bar, Line } from 'react-chartjs-2'
import './App.css'

// Register ChartJS components
ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend)

// ==================== CONFIG ====================
const CONFIG = {
  UPDATE_INTERVAL: 2 * 60 * 60 * 1000,
  CACHE_DURATION: 90 * 60 * 1000,
  DATA_URL: '/data/combined-all-assets.json',
  GITHUB_DATA_URL: 'https://raw.githubusercontent.com/navykao/my-etf-portfolio/main/public/data/combined-all-assets.json'
}

const API_KEYS = {
  FINNHUB: import.meta.env.VITE_FINNHUB_API_KEY || '',
  FMP: import.meta.env.VITE_FMP_API_KEY || '',
  TWELVE: import.meta.env.VITE_TWELVE_DATA_API_KEY || '',
  EODHD: import.meta.env.VITE_EODHD_API_KEY || ''
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

  return (
    <>
      <div className="container">
        {/* Type Filter */}
        <div className="type-filter">
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
          {/* Watchlist */}
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

          {/* Chart */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">
                  {selectedStock ? `${selectedStock.symbol} - ${selectedStock.name}` : 'เลือกหุ้นจาก Watchlist'}
                </h2>
                {selectedStock && (
                  <div style={{ marginTop: '8px' }}>
                    <span className="price" style={{ fontSize: '26px', marginRight: '10px' }}>
                      {formatPrice(selectedStock.price)}
                    </span>
                    <PriceChange value={selectedStock.changePercent || 0} />
                  </div>
                )}
              </div>
            </div>
            <div className="chart-container">
              {selectedStock ? (
                <Line
                  data={{
                    labels: ['9:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'],
                    datasets: [{
                      label: selectedStock.symbol,
                      data: chartData,
                      borderColor: '#3b82f6',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      borderWidth: 2,
                      fill: true,
                      tension: 0.4
                    }]
                  }}
                  options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }}
                />
              ) : (
                <div className="empty-state">เลือกหุ้นเพื่อดูกราฟ</div>
              )}
            </div>
          </div>

          {/* Market & Add Stock */}
          <div>
            <div className="card" style={{ marginBottom: '20px' }}>
              <div className="card-header">
                <h2 className="card-title">🌍 Market Overview</h2>
              </div>
              <div className="market-indices">
                <MarketIndex name="S&P 500" value={4783.45} change={0.54} />
                <MarketIndex name="DOW JONES" value={37305.16} change={0.36} />
                <MarketIndex name="NASDAQ" value={14813.92} change={0.82} />
              </div>
            </div>

            {/* FIX: ฟอร์มเพิ่มหุ้น - ใช้ step="any" รองรับเศษส่วน */}
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
                  {/* FIX: step="any" แก้ปัญหาใส่เศษส่วนไม่ได้ */}
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
                  <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px', padding: '8px', background: '#fee2e2', borderRadius: '6px' }}>
                    ⚠️ {formError}
                  </div>
                )}
                <button type="submit" className="btn-secondary" style={{ width: '100%' }}>
                  เพิ่มในพอร์ต
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Portfolio Holdings (mini preview on dashboard) */}
        {portfolio.length > 0 && (
          <>
            <div className="card" style={{ marginBottom: '24px' }}>
              <div className="card-header">
                <h2 className="card-title">💼 Portfolio Holdings</h2>
                <span style={{ fontSize: '13px', color: '#94a3b8' }}>ดูรายละเอียดเพิ่มเติมที่เมนู Portfolio</span>
              </div>
              <div className="summary-grid">
                <div className="summary-item">
                  <div className="summary-label">มูลค่าพอร์ตรวม</div>
                  <div className="summary-value">{formatPrice(portfolioStats.totalValue)}</div>
                </div>
                <div className="summary-item">
                  <div className="summary-label">กำไร/ขาดทุนรวม</div>
                  <div className="summary-value" style={{ color: portfolioStats.totalGain >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {formatPrice(portfolioStats.totalGain)}
                  </div>
                </div>
                <div className="summary-item">
                  <div className="summary-label">เปอร์เซ็นต์กำไร</div>
                  <div className="summary-value" style={{ color: portfolioStats.totalGainPercent >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {formatPercent(portfolioStats.totalGainPercent)}
                  </div>
                </div>
                <div className="summary-item">
                  <div className="summary-label">จำนวนหุ้นทั้งหมด</div>
                  <div className="summary-value">{portfolioStats.count} ตัว</div>
                </div>
              </div>
            </div>
          </>
        )}
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

  return (
    <div className="container" style={{ paddingTop: '24px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '24px', color: 'var(--text-primary)' }}>
        💼 Portfolio
      </h1>

      {/* Add Stock Form */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <h2 className="card-title">➕ เพิ่มหุ้นในพอร์ต</h2>
        </div>
        <form onSubmit={handleAddPortfolio} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '12px', alignItems: 'end' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Symbol</label>
            <input type="text" className="form-input" placeholder="เช่น AAPL"
              value={formSymbol} onChange={e => setFormSymbol(e.target.value.toUpperCase())} required />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">จำนวนหุ้น</label>
            {/* FIX: step="any" */}
            <input type="number" className="form-input" placeholder="0.001" step="any" min="0.000001"
              value={formShares} onChange={e => setFormShares(e.target.value)} required />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">ราคาซื้อเฉลี่ย ($)</label>
            <input type="number" className="form-input" placeholder="0.00" step="any" min="0.01"
              value={formAvgCost} onChange={e => setFormAvgCost(e.target.value)} required />
          </div>
          <button type="submit" className="btn-secondary">เพิ่มใน Portfolio</button>
        </form>
        {formError && (
          <div style={{ color: '#ef4444', fontSize: '13px', marginTop: '8px', padding: '8px', background: '#fee2e2', borderRadius: '6px' }}>
            ⚠️ {formError}
          </div>
        )}
      </div>

      {portfolio.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '16px' }}>ยังไม่มีหุ้นในพอร์ต</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>เพิ่มหุ้นด้วยฟอร์มด้านบน</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="card" style={{ marginBottom: '24px' }}>
            <div className="summary-grid">
              <div className="summary-item">
                <div className="summary-label">มูลค่าพอร์ตรวม</div>
                <div className="summary-value">{formatPrice(portfolioStats.totalValue)}</div>
              </div>
              <div className="summary-item">
                <div className="summary-label">ต้นทุนรวม</div>
                <div className="summary-value">{formatPrice(portfolioStats.totalCost)}</div>
              </div>
              <div className="summary-item">
                <div className="summary-label">กำไร/ขาดทุนรวม</div>
                <div className="summary-value" style={{ color: portfolioStats.totalGain >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {formatPrice(portfolioStats.totalGain)}
                </div>
              </div>
              <div className="summary-item">
                <div className="summary-label">เปอร์เซ็นต์กำไร</div>
                <div className="summary-value" style={{ color: portfolioStats.totalGainPercent >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {formatPercent(portfolioStats.totalGainPercent)}
                </div>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="card" style={{ marginBottom: '24px' }}>
            <div className="card-header">
              <h2 className="card-title">📋 รายการถือครอง</h2>
            </div>
            <div className="table-container">
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
                        <td>{formatShares(holding.shares)}</td>
                        <td>{formatPrice(holding.avgCost)}</td>
                        <td>{formatPrice(currentPrice)}</td>
                        <td>{formatPrice(value)}</td>
                        <td style={{ color: gain >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatPrice(gain)}</td>
                        <td style={{ color: gain >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatPercent(gainPercent)}</td>
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

          {/* Charts */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">📊 Portfolio Allocation</h2>
            </div>
            <div className="charts-grid">
              <div className="chart-wrapper">
                <div className="chart-title">สัดส่วนตามมูลค่า (Pie Chart)</div>
                <Pie data={pieChartData} options={{ responsive: true, maintainAspectRatio: false }} />
              </div>
              <div className="chart-wrapper">
                <div className="chart-title">เปรียบเทียบมูลค่า (Bar Chart)</div>
                <Bar data={barChartData} options={{ responsive: true, maintainAspectRatio: false }} />
              </div>
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
      <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '24px', color: 'var(--text-primary)' }}>
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
                padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: '8px'
              }}>
                <div>
                  <span className="stock-symbol" style={{ marginRight: '8px' }}>{stock.symbol}</span>
                  <Badge type={stock.type}>{stock.type}</Badge>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{stock.name}</div>
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
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>👀</div>
            <p>ยังไม่มีหุ้นใน Watchlist</p>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>ค้นหาและเพิ่มหุ้นด้านบน</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '8px' }}>
            {watchlistStocks.map(stock => (
              <div key={stock.symbol} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: '10px',
                cursor: 'pointer'
              }} onClick={() => setSelectedStock(stock)}>
                <div>
                  <span className="stock-symbol" style={{ marginRight: '8px' }}>{stock.symbol}</span>
                  <Badge type={stock.type}>{stock.type}</Badge>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{stock.name}</div>
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
function MarketPage({ allAssets }) {
  const [filterType, setFilterType] = useState('ALL')
  const [sortBy, setSortBy] = useState('changePercent')
  const [sortDir, setSortDir] = useState('desc')
  const [search, setSearch] = useState('')

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
  const losers = allAssets.filter(a => a.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 5)

  return (
    <div className="container" style={{ paddingTop: '24px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '24px', color: 'var(--text-primary)' }}>
        🌍 Market Overview
      </h1>

      {/* Market Indices */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header"><h2 className="card-title">📈 ดัชนีตลาด</h2></div>
        <div className="market-indices">
          <MarketIndex name="S&P 500" value={4783.45} change={0.54} />
          <MarketIndex name="DOW JONES" value={37305.16} change={0.36} />
          <MarketIndex name="NASDAQ" value={14813.92} change={0.82} />
          <MarketIndex name="VIX" value={13.45} change={-2.1} />
        </div>
        <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)', textAlign: 'right' }}>
          ⚠️ ดัชนีนี้เป็นข้อมูล static — ใส่ API key ใน .env เพื่อดึงข้อมูลจริง
        </div>
      </div>

      {/* Top Gainers / Losers */}
      {allAssets.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
          <div className="card">
            <div className="card-header"><h2 className="card-title">🚀 Top Gainers</h2></div>
            {gainers.map(s => (
              <div key={s.symbol} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
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
              <div key={s.symbol} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
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
        </div>
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <input type="text" className="form-input" style={{ flex: 1, minWidth: '200px' }}
            placeholder="ค้นหา symbol หรือชื่อ..." value={search}
            onChange={e => setSearch(e.target.value)} />
          <div className="type-filter" style={{ margin: 0 }}>
            {['ALL', 'STOCK', 'ETF', 'REIT', 'BOND'].map(t => (
              <button key={t} className={`filter-btn ${filterType === t ? 'active' : ''}`}
                onClick={() => setFilterType(t)}>{t}</button>
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
                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('peRatio')}>
                  P/E {sortBy === 'peRatio' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map(a => (
                <tr key={a.symbol}>
                  <td><strong className="stock-symbol">{a.symbol}</strong></td>
                  <td style={{ fontSize: '13px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</td>
                  <td><Badge type={a.type}>{a.type}</Badge></td>
                  <td>{formatPrice(a.price)}</td>
                  <td><PriceChange value={a.changePercent || 0} /></td>
                  <td>{a.divYield ? `${(a.divYield * 100).toFixed(2)}%` : '-'}</td>
                  <td>{a.peRatio ? a.peRatio.toFixed(1) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 100 && (
            <div style={{ textAlign: 'center', padding: '12px', color: 'var(--text-muted)', fontSize: '13px' }}>
              แสดง 100 รายการแรก จากทั้งหมด {filtered.length} รายการ (ใช้ช่องค้นหาเพื่อกรอง)
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// --- SETTINGS PAGE ---
function SettingsPage({ liveMode, setLiveMode, dataSource, lastUpdate, addNotification, allAssets, watchlist, portfolio, setWatchlist, setPortfolio }) {
  const hasApiKey = Object.values(API_KEYS).some(k => k && k.length > 0)

  const clearWatchlist = () => {
    if (confirm('ยืนยันการล้าง Watchlist ทั้งหมด?')) {
      setWatchlist([])
      Storage.set('watchlist', [])
      addNotification('ล้าง Watchlist แล้ว', 'info')
    }
  }

  const clearPortfolio = () => {
    if (confirm('ยืนยันการล้าง Portfolio ทั้งหมด?')) {
      setPortfolio([])
      Storage.set('portfolio', [])
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
        if (data.watchlist) { setWatchlist(data.watchlist); Storage.set('watchlist', data.watchlist) }
        if (data.portfolio) { setPortfolio(data.portfolio); Storage.set('portfolio', data.portfolio) }
        addNotification('Import ข้อมูลสำเร็จ ✓', 'success')
      } catch {
        addNotification('ไฟล์ไม่ถูกต้อง', 'error')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="container" style={{ paddingTop: '24px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '24px', color: 'var(--text-primary)' }}>
        ⚙️ Settings
      </h1>

      {/* Live Mode */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="card-header"><h2 className="card-title">🔴 Live Mode</h2></div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}>
          <div>
            <div style={{ fontWeight: '600', marginBottom: '4px' }}>เปิด/ปิด Live Mode</div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              เมื่อเปิด: ดึงราคาหุ้นจาก API จริงทุก 2 ชั่วโมง<br />
              เมื่อปิด: ใช้ข้อมูลจาก local JSON file
            </div>
          </div>
          <button
            className={liveMode ? 'btn-secondary' : 'btn-primary'}
            style={{ minWidth: '120px' }}
            onClick={() => {
              const newMode = !liveMode
              setLiveMode(newMode)
              if (newMode) {
                updateLiveData()   // ดึงทันทีเลยเมื่อกดเปิด
                setCountdown(7200) // reset นับใหม่
              }
              addNotification(newMode ? 'เปิด Live Mode แล้ว' : 'ปิด Live Mode แล้ว', 'info')
            }}
          >
            {liveMode ? '⏸ Pause' : '▶ เปิด Live'}
          </button>
        </div>

        <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', marginTop: '8px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
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
            <div style={{ marginTop: '8px', padding: '8px', background: '#fef9c3', borderRadius: '6px', fontSize: '12px', color: '#854d0e' }}>
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
      <div className="card" style={{ borderColor: '#fee2e2' }}>
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

// ==================== MAIN APP ====================
function App() {
  const [allAssets, setAllAssets] = useState([])
  const [watchlist, setWatchlist] = useState([])
  const [portfolio, setPortfolio] = useState([])
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

  // Notification system
  const addNotification = useCallback((message, type = 'info') => {
    const id = Date.now()
    setNotifications(prev => [...prev, { id, message, type }])
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 3000)
  }, [])

  useEffect(() => {
    loadInitialData()
    loadUserData()
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
      let data = null
      try {
        const res = await fetch(CONFIG.DATA_URL)
        if (res.ok) {
          const text = await res.text()
          if (text && text.trim().startsWith('[')) {
            data = JSON.parse(text)
            setDataSource('local')
          }
        }
      } catch (localErr) { console.warn('Local fetch failed', localErr) }

      if (!data || data.length === 0) {
        const res = await fetch(CONFIG.GITHUB_DATA_URL)
        if (!res.ok) throw new Error('GitHub fetch failed: ' + res.status)
        data = await res.json()
        setDataSource('github')
      }

      if (!Array.isArray(data) || data.length === 0) throw new Error('ข้อมูลไม่ถูกต้อง')
      setAllAssets(data)
      setLastUpdate(new Date())
    } catch (e) {
      console.error('Failed to load data:', e)
      setLoadError(e.message || 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  const loadUserData = () => {
    setWatchlist(Storage.get('watchlist', []))
    setPortfolio(Storage.get('portfolio', []))
  }

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

  const addToWatchlist = (symbol) => {
    if (!watchlist.includes(symbol)) {
      const newList = [...watchlist, symbol]
      setWatchlist(newList)
      Storage.set('watchlist', newList)
    }
  }

  const removeFromWatchlist = (symbol) => {
    const newList = watchlist.filter(s => s !== symbol)
    setWatchlist(newList)
    Storage.set('watchlist', newList)
  }

  // FIX: return true/false เพื่อให้ form รู้ว่าสำเร็จหรือไม่
  const addToPortfolio = (symbol, shares, avgCost) => {
    const stock = allAssets.find(a => a.symbol === symbol.toUpperCase())
    if (!stock) return false

    // ถ้ามี symbol อยู่แล้ว ให้อัพเดทจำนวน (average down/up)
    const existing = portfolio.find(p => p.symbol === symbol.toUpperCase())
    if (existing) {
      const totalShares = existing.shares + parseFloat(shares)
      const avgPrice = ((existing.shares * existing.avgCost) + (parseFloat(shares) * parseFloat(avgCost))) / totalShares
      const newPortfolio = portfolio.map(p =>
        p.symbol === symbol.toUpperCase()
          ? { ...p, shares: totalShares, avgCost: avgPrice }
          : p
      )
      setPortfolio(newPortfolio)
      Storage.set('portfolio', newPortfolio)
    } else {
      const newHolding = {
        symbol: symbol.toUpperCase(),
        name: stock.name,
        type: stock.type,
        shares: parseFloat(shares),
        avgCost: parseFloat(avgCost),
        currentPrice: stock.price
      }
      const newPortfolio = [...portfolio, newHolding]
      setPortfolio(newPortfolio)
      Storage.set('portfolio', newPortfolio)
    }
    return true
  }

  const removeFromPortfolio = (symbol) => {
    const newPortfolio = portfolio.filter(p => p.symbol !== symbol)
    setPortfolio(newPortfolio)
    Storage.set('portfolio', newPortfolio)
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
        <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '20px' }}>{loadError}</p>
        <button onClick={loadInitialData} style={{ padding: '10px 24px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
          🔄 ลองใหม่อีกครั้ง
        </button>
      </div>
    )
  }

  const sharedProps = {
    allAssets, portfolio, watchlist, portfolioStats, pieChartData, barChartData,
    addToPortfolio, removeFromPortfolio, addToWatchlist, removeFromWatchlist,
    selectedStock, setSelectedStock, addNotification, setWatchlist, setPortfolio
  }

  return (
    <div className="app">
      {/* Notifications */}
      <div style={{ position: 'fixed', top: '80px', right: '20px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {notifications.map(n => (
          <div key={n.id} style={{
            padding: '10px 16px', borderRadius: '8px', fontSize: '14px', fontWeight: '500',
            background: n.type === 'success' ? '#dcfce7' : n.type === 'error' ? '#fee2e2' : '#dbeafe',
            color: n.type === 'success' ? '#166534' : n.type === 'error' ? '#dc2626' : '#1e40af',
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
              <div style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '12px' }}>
                {dataSource === 'local' ? '📁 Local' : '☁️ GitHub'}
                {lastUpdate && ` · ${lastUpdate.toLocaleTimeString('th-TH')}`}
              </div>
            )}
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
          setWatchlist={setWatchlist}
          setPortfolio={setPortfolio}
        />
      )}

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}

export default App
