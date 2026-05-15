import { useState, useEffect, useMemo, useCallback } from 'react'
import { Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js'
import { Pie, Bar, Line } from 'react-chartjs-2'
import './App.css'

// Register ChartJS components
ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend)

// ==================== CONFIG ====================
const CONFIG = {
  UPDATE_INTERVAL: 2 * 60 * 60 * 1000, // 2 hours
  CACHE_DURATION: 90 * 60 * 1000, // 90 minutes
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
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(price)
}

const formatPercent = (value) => {
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
      if (data.c) {
        return {
          price: data.c,
          change: data.d,
          changePercent: data.dp,
          source: 'Finnhub'
        }
      }
    } catch (e) {
      console.error('Finnhub error:', e)
    }
    return null
  }

  static async fetchFromFMP(symbol) {
    if (!API_KEYS.FMP) return null
    try {
      const res = await fetch(`https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${API_KEYS.FMP}`)
      const data = await res.json()
      if (data[0]) {
        return {
          price: data[0].price,
          change: data[0].change,
          changePercent: data[0].changesPercentage,
          source: 'FMP'
        }
      }
    } catch (e) {
      console.error('FMP error:', e)
    }
    return null
  }

  static async fetchFromTwelve(symbol) {
    if (!API_KEYS.TWELVE) return null
    try {
      const res = await fetch(`https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${API_KEYS.TWELVE}`)
      const data = await res.json()
      if (data.close) {
        return {
          price: parseFloat(data.close),
          change: parseFloat(data.change),
          changePercent: parseFloat(data.percent_change),
          source: 'Twelve Data'
        }
      }
    } catch (e) {
      console.error('Twelve Data error:', e)
    }
    return null
  }

  static async fetchFromEODHD(symbol) {
    if (!API_KEYS.EODHD) return null
    try {
      const res = await fetch(`https://eodhistoricaldata.com/api/real-time/${symbol}.US?api_token=${API_KEYS.EODHD}&fmt=json`)
      const data = await res.json()
      if (data.close) {
        return {
          price: data.close,
          change: data.change,
          changePercent: data.change_p,
          source: 'EODHD'
        }
      }
    } catch (e) {
      console.error('EODHD error:', e)
    }
    return null
  }

  static async fetchQuote(symbol) {
    // Try all APIs in order
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
    } catch {
      return defaultValue
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (e) {
      console.error('Storage error:', e)
    }
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

const PriceChange = ({ value, showSign = true }) => (
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

// ==================== MAIN APP ====================
function App() {
  // State
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
  const [countdown, setCountdown] = useState(7200) // 2 hours
  const [lastUpdate, setLastUpdate] = useState(null)

  // Load data on mount
  useEffect(() => {
    loadInitialData()
    loadUserData()
  }, [])

  // Countdown timer
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

  // Auto-update in live mode
  useEffect(() => {
    if (liveMode) {
      const interval = setInterval(() => {
        updateLiveData()
      }, CONFIG.UPDATE_INTERVAL)
      return () => clearInterval(interval)
    }
  }, [liveMode])

  // Load initial data
  const loadInitialData = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      let data = null

      // Try local first (/public/data/combined-all-assets.json)
      try {
        const res = await fetch(CONFIG.DATA_URL)
        if (res.ok) {
          const text = await res.text()
          if (text && text.trim().startsWith('[')) {
            data = JSON.parse(text)
            setDataSource('local')
          }
        }
      } catch (localErr) {
        console.warn('Local fetch failed, trying GitHub...', localErr)
      }

      // Fallback to GitHub raw URL
      if (!data || data.length === 0) {
        console.log('Fetching from GitHub...')
        const res = await fetch(CONFIG.GITHUB_DATA_URL)
        if (!res.ok) throw new Error('GitHub fetch failed: ' + res.status)
        data = await res.json()
        setDataSource('github')
      }

      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('ข้อมูลที่โหลดมาไม่ถูกต้อง (ไม่ใช่ Array หรือว่างเปล่า)')
      }

      setAllAssets(data)
      setLastUpdate(new Date())
    } catch (e) {
      console.error('Failed to load data:', e)
      setLoadError(e.message || 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  // Load user data from localStorage
  const loadUserData = () => {
    const savedWatchlist = Storage.get('watchlist', [])
    const savedPortfolio = Storage.get('portfolio', [])
    setWatchlist(savedWatchlist)
    setPortfolio(savedPortfolio)
  }

  // Update live data
  const updateLiveData = async () => {
    // watchlist เป็น array ของ string (symbol) เท่านั้น
    const watchlistSymbols = watchlist.filter(s => typeof s === 'string')
    const symbols = [...new Set([...watchlistSymbols, ...portfolio.map(p => p.symbol)])]
    
    for (const symbol of symbols) {
      const data = await APIService.fetchQuote(symbol)
      if (data) {
        // Update in allAssets
        setAllAssets(prev => prev.map(asset => 
          asset.symbol === symbol 
            ? { ...asset, price: data.price, change: data.change, changePercent: data.changePercent }
            : asset
        ))
      }
    }
    setLastUpdate(new Date())
  }

  // Add to watchlist
  const addToWatchlist = (symbol) => {
    if (!watchlist.includes(symbol)) {
      const newWatchlist = [...watchlist, symbol]
      setWatchlist(newWatchlist)
      Storage.set('watchlist', newWatchlist)
    }
  }

  // Remove from watchlist
  const removeFromWatchlist = (symbol) => {
    const newWatchlist = watchlist.filter(s => s !== symbol)
    setWatchlist(newWatchlist)
    Storage.set('watchlist', newWatchlist)
  }

  // Add to portfolio
  const addToPortfolio = (symbol, shares, avgCost) => {
    const stock = allAssets.find(a => a.symbol === symbol)
    if (!stock) return

    const newHolding = {
      symbol,
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

  // Remove from portfolio
  const removeFromPortfolio = (symbol) => {
    const newPortfolio = portfolio.filter(p => p.symbol !== symbol)
    setPortfolio(newPortfolio)
    Storage.set('portfolio', newPortfolio)
  }

  // Search stocks
  const handleSearch = () => {
    const query = searchQuery.trim().toUpperCase()
    if (!query) return

    const found = allAssets.find(a => 
      a.symbol === query || a.name.toUpperCase().includes(query)
    )

    if (found) {
      setSelectedStock(found)
      addToWatchlist(found.symbol)
    } else {
      alert(`ไม่พบหุ้น: ${query}`)
    }
  }

  // Filtered watchlist
  const filteredWatchlist = useMemo(() => {
    let stocks = allAssets.filter(a => watchlist.includes(a.symbol))
    if (filterType !== 'ALL') {
      stocks = stocks.filter(s => s.type === filterType)
    }
    return stocks
  }, [allAssets, watchlist, filterType])

  // Portfolio calculations
  const portfolioStats = useMemo(() => {
    const totalValue = portfolio.reduce((sum, p) => {
      const stock = allAssets.find(a => a.symbol === p.symbol)
      const currentPrice = stock?.price || p.currentPrice
      return sum + (p.shares * currentPrice)
    }, 0)

    const totalCost = portfolio.reduce((sum, p) => sum + (p.shares * p.avgCost), 0)
    const totalGain = totalValue - totalCost
    const totalGainPercent = totalCost > 0 ? (totalGain / totalCost) * 100 : 0

    return {
      totalValue,
      totalCost,
      totalGain,
      totalGainPercent,
      count: portfolio.length
    }
  }, [portfolio, allAssets])

  // Chart data
  // Chart data อัพเดททุก 15 นาที (ไม่กระตุกทุก render)
  const [chartData, setChartData] = useState(() =>
    Array.from({ length: 14 }, () => 0)
  )

  useEffect(() => {
    if (!selectedStock) return
    const generateData = () =>
      Array.from({ length: 14 }, () =>
        selectedStock.price + (Math.random() - 0.5) * 5
      )
    setChartData(generateData())
    const interval = setInterval(() => setChartData(generateData()), 15 * 60 * 1000)
    return () => clearInterval(interval)
  }, [selectedStock?.symbol])

  const pieChartData = useMemo(() => {
    const data = portfolio.map(p => {
      const stock = allAssets.find(a => a.symbol === p.symbol)
      const currentPrice = stock?.price || p.currentPrice
      return {
        symbol: p.symbol,
        value: p.shares * currentPrice
      }
    })

    return {
      labels: data.map(d => d.symbol),
      datasets: [{
        data: data.map(d => d.value),
        backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']
      }]
    }
  }, [portfolio, allAssets])

  const barChartData = useMemo(() => {
    const data = portfolio.map(p => {
      const stock = allAssets.find(a => a.symbol === p.symbol)
      const currentPrice = stock?.price || p.currentPrice
      return {
        symbol: p.symbol,
        value: p.shares * currentPrice
      }
    })

    return {
      labels: data.map(d => d.symbol),
      datasets: [{
        label: 'มูลค่า ($)',
        data: data.map(d => d.value),
        backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']
      }]
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
        <button
          onClick={loadInitialData}
          style={{ padding: '10px 24px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}
        >
          🔄 ลองใหม่อีกครั้ง
        </button>
      </div>
    )
  }

  return (
    <div className="app">
      {/* Header */}
      <header>
        <div className="container">
          <nav>
            <div className="logo">
              <div className="logo-icon">$</div>
              <span>US Stock Portfolio V7</span>
            </div>
            <ul className="nav-menu">
              <li><a href="#" className="active">Dashboard</a></li>
              <li><a href="#portfolio">Portfolio</a></li>
              <li><a href="#watchlist">Watchlist</a></li>
              <li><a href="#market">Market</a></li>
              <li><a href="#settings">Settings</a></li>
            </ul>
            <div className="live-status" onClick={() => setLiveMode(!liveMode)}>
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

      {/* Search Section */}
      <section className="search-section">
        <div className="container">
          <div className="search-container">
            <div className="search-wrapper">
              <input
                type="text"
                className="search-input"
                placeholder="ค้นหาหุ้น เช่น AAPL, TSLA, GOOGL..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              />
              <span className="search-icon">🔍</span>
            </div>
            <button className="btn-primary" onClick={handleSearch}>
              ค้นหา
            </button>
          </div>
        </div>
      </section>

      {/* Main Content */}
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
                <p className="empty-state">ยังไม่มีหุ้นใน Watchlist</p>
              ) : (
                filteredWatchlist.map(stock => (
                  <WatchlistCard
                    key={stock.symbol}
                    stock={stock}
                    onClick={() => setSelectedStock(stock)}
                  />
                ))
              )}
            </div>

            <Countdown seconds={countdown} />
          </div>

          {/* Chart Section */}
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
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } }
                  }}
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

            <div className="card">
              <div className="card-header">
                <h2 className="card-title">➕ เพิ่มหุ้นในพอร์ต</h2>
              </div>
              <form onSubmit={(e) => {
                e.preventDefault()
                const formData = new FormData(e.target)
                addToPortfolio(
                  formData.get('symbol'),
                  formData.get('shares'),
                  formData.get('avgCost')
                )
                e.target.reset()
              }}>
                <div className="form-group">
                  <label className="form-label">Symbol</label>
                  <input type="text" name="symbol" className="form-input" placeholder="เช่น AAPL" required />
                </div>
                <div className="form-group">
                  <label className="form-label">จำนวนหุ้น</label>
                  <input type="number" name="shares" className="form-input" placeholder="0" required />
                </div>
                <div className="form-group">
                  <label className="form-label">ราคาซื้อเฉลี่ย ($)</label>
                  <input type="number" name="avgCost" step="0.01" className="form-input" placeholder="0.00" required />
                </div>
                <button type="submit" className="btn-secondary">เพิ่มในพอร์ต</button>
              </form>
            </div>
          </div>
        </div>

        {/* Portfolio */}
        {portfolio.length > 0 && (
          <>
            <div className="card" style={{ marginBottom: '24px' }}>
              <div className="card-header">
                <h2 className="card-title">💼 Portfolio Holdings</h2>
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
                      const gainPercent = (gain / cost) * 100

                      return (
                        <tr key={holding.symbol}>
                          <td><strong className="stock-symbol">{holding.symbol}</strong></td>
                          <td><Badge type={holding.type}>{holding.type}</Badge></td>
                          <td>{holding.shares}</td>
                          <td>{formatPrice(holding.avgCost)}</td>
                          <td>{formatPrice(currentPrice)}</td>
                          <td>{formatPrice(value)}</td>
                          <td style={{ color: gain >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {formatPrice(gain)}
                          </td>
                          <td style={{ color: gain >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {formatPercent(gainPercent)}
                          </td>
                          <td>
                            <button
                              className="btn-danger-small"
                              onClick={() => removeFromPortfolio(holding.symbol)}
                            >
                              ลบ
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Charts */}
            <div className="card" style={{ marginBottom: '24px' }}>
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
    </div>
  )
}

export default App
