import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Search, Star, Bell, DollarSign, TrendingUp, Trash2, Plus, RefreshCw, Menu, X, Calendar, TrendingDown } from 'lucide-react';

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyDqL8F3qH_VvX9jW6kZ7nN8mP5oQ2rS4tU",
  authDomain: "my-etf-portfolio.firebaseapp.com",
  projectId: "my-etf-portfolio",
  storageBucket: "my-etf-portfolio.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890abcdef"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// API Configuration
const API_KEYS = {
  FMP: import.meta.env.VITE_FMP_API_KEY,

  FINNHUB: import.meta.env.VITE_FINNHUB_API_KEY,

  TWELVE: import.meta.env.VITE_TWELVE_DATA_API_KEY,

  EODHD: import.meta.env.VITE_EODHD_API_KEY
};

// Cache Manager
const CacheManager = {
  PRICE_CACHE_KEY: 'price_cache_v1',
  CACHE_DURATION: 5 * 60 * 1000,
  
  getPriceCache: (symbol) => {
    try {
      const cache = JSON.parse(localStorage.getItem(CacheManager.PRICE_CACHE_KEY) || '{}');
      const cached = cache[symbol];
      if (cached && Date.now() - new Date(cached.timestamp).getTime() < CacheManager.CACHE_DURATION) {
        return cached;
      }
    } catch (e) {
      console.error('[Cache] Read error:', e);
    }
    return null;
  },
  
  setPriceCache: (symbol, data) => {
    try {
      const cache = JSON.parse(localStorage.getItem(CacheManager.PRICE_CACHE_KEY) || '{}');
      cache[symbol] = { ...data, timestamp: new Date().toISOString() };
      localStorage.setItem(CacheManager.PRICE_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      console.error('[Cache] Write error:', e);
    }
  }
};

// API Service
const APIService = {
  async fetchFromFMP(symbol) {
    if (!API_KEYS.FMP) return null;
    try {
      const response = await fetch(
        `https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${API_KEYS.FMP}`
      );
      const data = await response.json();
      if (data && data[0]) {
        return {
          price: data[0].price,
          change: data[0].change,
          changePercent: data[0].changesPercentage,
          source: 'FMP'
        };
      }
    } catch (e) {
      console.error('[API] FMP error:', e);
    }
    return null;
  },

  async fetchFromFinnhub(symbol) {
    if (!API_KEYS.FINNHUB) return null;
    try {
      const response = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${API_KEYS.FINNHUB}`
      );
      const data = await response.json();
      if (data && data.c) {
        return {
          price: data.c,
          change: data.d,
          changePercent: data.dp,
          source: 'FinnHub'
        };
      }
    } catch (e) {
      console.error('[API] FinnHub error:', e);
    }
    return null;
  },

  async fetchFromTwelve(symbol) {
    if (!API_KEYS.TWELVE) return null;
    try {
      const response = await fetch(
        `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${API_KEYS.TWELVE}`
      );
      const data = await response.json();
      if (data && data.price) {
        return {
          price: parseFloat(data.price),
          change: 0,
          changePercent: 0,
          source: 'TwelveData'
        };
      }
    } catch (e) {
      console.error('[API] TwelveData error:', e);
    }
    return null;
  },

  async fetchLivePrice(symbol) {
    const cached = CacheManager.getPriceCache(symbol);
    if (cached) {
      console.log(`[Cache] Using cached price for ${symbol}`);
      return cached;
    }

    console.log(`[API] Fetching live price for ${symbol}`);
    
    let result = await this.fetchFromFMP(symbol);
    if (result) {
      console.log(`[API] FMP successful for ${symbol}`);
      CacheManager.setPriceCache(symbol, result);
      return result;
    }

    result = await this.fetchFromFinnhub(symbol);
    if (result) {
      console.log(`[API] FinnHub successful for ${symbol}`);
      CacheManager.setPriceCache(symbol, result);
      return result;
    }

    result = await this.fetchFromTwelve(symbol);
    if (result) {
      console.log(`[API] TwelveData successful for ${symbol}`);
      CacheManager.setPriceCache(symbol, result);
      return result;
    }

    console.log(`[API] All APIs failed for ${symbol}`);
    return null;
  }
};

// Dividend Frequencies
const DIVIDEND_FREQUENCIES = {
  monthly: { label: 'รายเดือน', perYear: 12 },
  quarterly: { label: 'ราย 3 เดือน', perYear: 4 },
  semiannual: { label: 'ราย 6 เดือน', perYear: 2 },
  annual: { label: 'รายปี', perYear: 1 }
};

function App() {
  const [user, setUser] = useState(null);
  const [allAssets, setAllAssets] = useState([]);
  const [holdings, setHoldings] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [totalInvestment, setTotalInvestment] = useState(100000);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Firebase Authentication
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        console.log('[Firebase] User authenticated:', currentUser.uid);
      } else {
        signInAnonymously(auth).catch(err => 
          console.error('[Firebase] Auth error:', err)
        );
      }
    });
    return () => unsubscribe();
  }, []);

  // Load Assets Data from JSON
  useEffect(() => {
    const loadAssetsData = async () => {
      const cached = localStorage.getItem('etf_local_cache_v7');
      if (cached) {
        console.log('[Data] Loading from local cache');
        setAllAssets(JSON.parse(cached));
        return;
      }

      try {
        // ลองโหลดจาก combined-746-assets.json
        const response = await fetch('/data/combined-746-assets.json');
        if (response.ok) {
          const data = await response.json();
          console.log('[Data] Loaded', data.length, 'assets from JSON');
          setAllAssets(data);
          localStorage.setItem('etf_local_cache_v7', JSON.stringify(data));
          return;
        }
      } catch (error) {
        console.log('[Data] JSON file not found, falling back to text file');
      }

      // Fallback ไปที่ไฟล์ text
      try {
        const response = await fetch('/sp500-top100.txt');
        const text = await response.text();
        const lines = text.trim().split('\n').slice(1);
        
        const assets = lines.map(line => {
          const [symbol, name, price, divYield, divFrequency, growthRate] = line.split('\t');
          return {
            symbol: symbol?.trim() || '',
            name: name?.trim() || '',
            price: parseFloat(price) || 0,
            divYield: parseFloat(divYield) || 0,
            dividendYield: parseFloat(divYield) || 0,
            trailingDividendRate: 0,
            divFrequency: divFrequency?.trim() || 'quarterly',
            growthRate: parseFloat(growthRate) || 5,
            divGrowth3Y: null,
            divGrowth5Y: null,
            divGrowth10Y: null
          };
        });

        console.log('[Data] Loaded', assets.length, 'assets from text file');
        setAllAssets(assets);
        localStorage.setItem('etf_local_cache_v7', JSON.stringify(assets));
      } catch (error) {
        console.error('[Data] Load error:', error);
      }
    };

    loadAssetsData();
  }, []);

  // Auto-refresh data in Live Mode
  useEffect(() => {
    if (!isLiveMode || holdings.length === 0) return;

    const interval = setInterval(async () => {
      console.log('[Live] Auto-updating prices...');
      const updates = {};
      
      for (const holding of holdings) {
        const liveData = await APIService.fetchLivePrice(holding.symbol);
        if (liveData) {
          updates[holding.symbol] = liveData.price;
        }
      }

      if (Object.keys(updates).length > 0) {
        setHoldings(prev => prev.map(h => ({
          ...h,
          price: updates[h.symbol] || h.price
        })));
        setLastUpdate(new Date());
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [isLiveMode, holdings]);

  const addToPortfolio = (asset) => {
    const shares = prompt(`จำนวนหุ้น ${asset.symbol} ที่ต้องการซื้อ:`, '10');
    if (!shares || isNaN(shares)) return;

    const qty = parseInt(shares);
    const existing = holdings.find(h => h.symbol === asset.symbol);

    if (existing) {
      setHoldings(holdings.map(h => 
        h.symbol === asset.symbol 
          ? { ...h, shares: h.shares + qty }
          : h
      ));
    } else {
      setHoldings([...holdings, {
        ...asset,
        shares: qty,
        dividendYield: asset.divYield || asset.dividendYield || 0
      }]);
    }
  };

  const removeHolding = (symbol) => {
    setHoldings(holdings.filter(h => h.symbol !== symbol));
  };

  const stats = {
    holdings: holdings.map(h => {
      const value = h.shares * h.price;
      const freq = DIVIDEND_FREQUENCIES[h.divFrequency] || DIVIDEND_FREQUENCIES.quarterly;
      const annualDiv = value * (h.dividendYield / 100);
      
      return {
        ...h,
        value,
        annualDiv,
        divFrequency: h.divFrequency
      };
    }),
    totalValue: holdings.reduce((sum, h) => sum + (h.shares * h.price), 0),
    totalAnnualDiv: holdings.reduce((sum, h) => {
      const value = h.shares * h.price;
      return sum + (value * (h.dividendYield / 100));
    }, 0),
    avgYield: holdings.length > 0
      ? holdings.reduce((sum, h) => sum + h.dividendYield, 0) / holdings.length
      : 0
  };

  const searchResults = allAssets.filter(asset =>
    searchQuery === '' || 
    asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    asset.name.toLowerCase().includes(searchQuery.toLowerCase())
  ).slice(0, 50);

  const pieData = stats.holdings.map(h => ({
    name: h.symbol,
    value: h.value
  }));

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-white shadow-sm border-b sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-md">
                <TrendingUp className="text-white" size={20} />
              </div>
              <div>
                <h1 className="text-lg sm:text-2xl font-bold text-blue-600">My ETF Portfolio</h1>
                <p className="text-xs sm:text-sm text-slate-500">
                  {allAssets.length} assets • {holdings.length} holdings
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              {lastUpdate && (
                <div className="hidden sm:block text-xs text-slate-500">
                  อัพเดท: {lastUpdate.toLocaleTimeString('th-TH')}
                </div>
              )}
              
              <button
                onClick={() => setIsLiveMode(!isLiveMode)}
                className={`px-3 py-2 sm:px-4 sm:py-2 rounded-lg font-medium transition-all text-xs sm:text-sm flex items-center gap-2 ${
                  isLiveMode 
                    ? 'bg-green-500 text-white shadow-lg' 
                    : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                }`}
              >
                <RefreshCw size={14} className={isLiveMode ? 'animate-spin' : ''} />
                <span className="hidden sm:inline">{isLiveMode ? 'Live' : 'Static'}</span>
              </button>

              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="sm:hidden p-2 rounded-lg hover:bg-slate-100"
              >
                {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className={`bg-white border-b sm:block ${isMobileMenuOpen ? 'block' : 'hidden'}`}>
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-1 py-2">
            {[
              { id: 'dashboard', icon: TrendingUp, label: 'Dashboard' },
              { id: 'search', icon: Search, label: 'Search' },
              { id: 'watchlist', icon: Star, label: 'Watchlist' },
              { id: 'alerts', icon: Bell, label: 'Alerts' },
              { id: 'dividends', icon: DollarSign, label: 'Dividends' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setIsMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors text-sm ${
                  activeTab === tab.id
                    ? 'bg-blue-500 text-white shadow-md'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <tab.icon size={18} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6">
        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
              <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                    <DollarSign className="text-blue-600" size={20} />
                  </div>
                  <span className="text-sm text-slate-600">มูลค่าพอร์ต</span>
                </div>
                <div className="text-2xl sm:text-3xl font-bold text-slate-800">
                  ฿{Math.round(stats.totalValue).toLocaleString()}
                </div>
              </div>

              <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                    <TrendingUp className="text-green-600" size={20} />
                  </div>
                  <span className="text-sm text-slate-600">ปันผล/ปี</span>
                </div>
                <div className="text-2xl sm:text-3xl font-bold text-green-600">
                  ฿{Math.round(stats.totalAnnualDiv).toLocaleString()}
                </div>
              </div>

              <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                    <Star className="text-purple-600" size={20} />
                  </div>
                  <span className="text-sm text-slate-600">Avg Yield</span>
                </div>
                <div className="text-2xl sm:text-3xl font-bold text-purple-600">
                  {stats.avgYield.toFixed(2)}%
                </div>
              </div>
            </div>

            {/* Portfolio Allocation */}
            {holdings.length > 0 && (
              <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm mb-4 sm:mb-6">
                <h2 className="text-lg sm:text-xl font-bold mb-4">Portfolio Allocation</h2>
                <div className="h-64 sm:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={window.innerWidth < 640 ? 80 : 120}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => `฿${Math.round(value).toLocaleString()}`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Holdings Table */}
            <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm">
              <h2 className="text-lg sm:text-xl font-bold mb-4">Holdings</h2>
              {holdings.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-slate-400 mb-2">
                    <TrendingUp size={48} className="mx-auto" />
                  </div>
                  <p className="text-slate-500 mb-4 text-sm sm:text-base">ยังไม่มีหุ้นในพอร์ต</p>
                  <button
                    onClick={() => setActiveTab('search')}
                    className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm sm:text-base"
                  >
                    เริ่มค้นหาหุ้น
                  </button>
                </div>
              ) : (
                <>
                  {/* Desktop Table */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full">
                      <thead className="text-left border-b text-sm">
                        <tr className="text-slate-600">
                          <th className="pb-3 font-medium">Symbol</th>
                          <th className="pb-3 font-medium">ราคา</th>
                          <th className="pb-3 font-medium">จำนวน</th>
                          <th className="pb-3 font-medium">มูลค่า</th>
                          <th className="pb-3 font-medium">Yield</th>
                          <th className="pb-3 font-medium">ปันผล/ปี</th>
                          <th className="pb-3 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {stats.holdings.map((holding, idx) => (
                          <tr key={idx} className="text-sm">
                            <td className="py-3">
                              <div className="font-bold text-blue-600">{holding.symbol}</div>
                              <div className="text-xs text-slate-500">{holding.name}</div>
                            </td>
                            <td className="py-3">฿{holding.price.toFixed(2)}</td>
                            <td className="py-3">{holding.shares}</td>
                            <td className="py-3 font-medium">฿{Math.round(holding.value).toLocaleString()}</td>
                            <td className="py-3 text-green-600 font-medium">{holding.dividendYield.toFixed(2)}%</td>
                            <td className="py-3 text-green-600 font-medium">
                              ฿{Math.round(holding.annualDiv).toLocaleString()}
                            </td>
                            <td className="py-3">
                              <button
                                onClick={() => removeHolding(holding.symbol)}
                                className="text-red-500 hover:text-red-700"
                              >
                                <Trash2 size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards */}
                  <div className="sm:hidden space-y-3">
                    {stats.holdings.map((holding, idx) => (
                      <div key={idx} className="bg-slate-50 rounded-xl p-4">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <div className="font-bold text-blue-600">{holding.symbol}</div>
                            <div className="text-xs text-slate-600 mt-1">{holding.name}</div>
                          </div>
                          <button
                            onClick={() => removeHolding(holding.symbol)}
                            className="text-red-500 hover:text-red-700 p-1"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <div className="text-xs text-slate-500">ราคา</div>
                            <div className="font-medium">฿{holding.price.toFixed(2)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-500">จำนวน</div>
                            <div className="font-medium">{holding.shares}</div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-500">มูลค่า</div>
                            <div className="font-medium">฿{Math.round(holding.value).toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-500">Yield</div>
                            <div className="font-medium text-green-600">{holding.dividendYield.toFixed(2)}%</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* Search Tab - แสดงข้อมูลปันผลในการ์ด */}
        {activeTab === 'search' && (
          <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm">
            <div className="mb-6">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input
                  type="text"
                  placeholder="ค้นหา Symbol หรือชื่อบริษัท..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
                />
              </div>
            </div>

            {/* Desktop Table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left border-b">
                  <tr className="text-slate-600">
                    <th className="pb-3 font-medium">Symbol</th>
                    <th className="pb-3 font-medium">Name</th>
                    <th className="pb-3 font-medium text-right">ราคา</th>
                    <th className="pb-3 font-medium text-right">Div Yield</th>
                    <th className="pb-3 font-medium text-right">ปันผล/หุ้น</th>
                    <th className="pb-3 font-medium text-right">Div Growth</th>
                    <th className="pb-3 font-medium text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {searchResults.map((asset, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="py-3 font-bold text-blue-600">{asset.symbol}</td>
                      <td className="py-3 text-slate-600 max-w-xs truncate">{asset.name}</td>
                      <td className="py-3 text-right font-medium">${parseFloat(asset.price || 0).toFixed(2)}</td>
                      <td className="py-3 text-right">
                        <span className="text-green-600 font-medium">
                          {parseFloat(asset.divYield || asset.dividendYield || 0).toFixed(2)}%
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        {asset.trailingDividendRate ? (
                          <span className="text-slate-700 font-medium">
                            ${asset.trailingDividendRate.toFixed(3)}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">N/A</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex flex-col gap-0.5 text-xs">
                          {asset.divGrowth3Y !== null && asset.divGrowth3Y !== undefined ? (
                            <>
                              <span className="text-emerald-600">3Y: {asset.divGrowth3Y.toFixed(1)}%</span>
                              {asset.divGrowth5Y !== null && (
                                <span className="text-blue-600">5Y: {asset.divGrowth5Y.toFixed(1)}%</span>
                              )}
                              {asset.divGrowth10Y !== null && (
                                <span className="text-purple-600">10Y: {asset.divGrowth10Y.toFixed(1)}%</span>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-400">N/A</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex justify-center gap-2">
                          <button
                            onClick={() => addToPortfolio(asset)}
                            className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                            title="Add to Portfolio"
                          >
                            <Plus size={14} />
                          </button>
                          <button
                            onClick={() => {
                              if (!watchlist.find(w => w.symbol === asset.symbol)) {
                                setWatchlist([...watchlist, asset]);
                              }
                            }}
                            className="p-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600"
                            title="Add to Watchlist"
                          >
                            <Star size={14} />
                          </button>
                          <button
                            onClick={() => {
                              const price = prompt(`Set alert price for ${asset.symbol}:`);
                              if (price && !isNaN(price)) {
                                setAlerts([...alerts, {
                                  symbol: asset.symbol,
                                  targetPrice: parseFloat(price),
                                  currentPrice: parseFloat(asset.price)
                                }]);
                              }
                            }}
                            className="p-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                            title="Set Alert"
                          >
                            <Bell size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards - แสดงข้อมูลปันผล */}
            <div className="sm:hidden space-y-3">
              {searchResults.map((asset, idx) => (
                <div key={idx} className="bg-slate-50 rounded-xl p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <div className="font-bold text-blue-600 text-lg">{asset.symbol}</div>
                      <div className="text-xs text-slate-600 mt-1 line-clamp-2">{asset.name}</div>
                    </div>
                    <div className="text-right ml-2">
                      <div className="font-medium text-lg">${parseFloat(asset.price || 0).toFixed(2)}</div>
                    </div>
                  </div>

                  {/* Dividend Info Card */}
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-3 mb-3 border border-green-200">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-slate-600 mb-0.5">Dividend Yield</div>
                        <div className="font-bold text-green-600 text-base">
                          {parseFloat(asset.divYield || asset.dividendYield || 0).toFixed(2)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-600 mb-0.5">ปันผล/หุ้น/ปี</div>
                        <div className="font-bold text-green-700 text-base">
                          {asset.trailingDividendRate ? `$${asset.trailingDividendRate.toFixed(3)}` : 'N/A'}
                        </div>
                      </div>
                    </div>

                    {/* Dividend Growth */}
                    {(asset.divGrowth3Y !== null && asset.divGrowth3Y !== undefined) && (
                      <div className="mt-3 pt-3 border-t border-green-200">
                        <div className="text-xs text-slate-600 mb-2">การเติบโตของปันผล</div>
                        <div className="flex gap-3 text-xs">
                          <div className="flex items-center gap-1">
                            <TrendingUp size={12} className="text-emerald-600" />
                            <span className="font-medium text-emerald-600">3Y: {asset.divGrowth3Y.toFixed(1)}%</span>
                          </div>
                          {asset.divGrowth5Y !== null && (
                            <div className="flex items-center gap-1">
                              <TrendingUp size={12} className="text-blue-600" />
                              <span className="font-medium text-blue-600">5Y: {asset.divGrowth5Y.toFixed(1)}%</span>
                            </div>
                          )}
                          {asset.divGrowth10Y !== null && (
                            <div className="flex items-center gap-1">
                              <TrendingUp size={12} className="text-purple-600" />
                              <span className="font-medium text-purple-600">10Y: {asset.divGrowth10Y.toFixed(1)}%</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => addToPortfolio(asset)}
                      className="flex-1 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center justify-center gap-2 text-sm font-medium"
                    >
                      <Plus size={16} />
                      Add
                    </button>
                    <button
                      onClick={() => {
                        if (!watchlist.find(w => w.symbol === asset.symbol)) {
                          setWatchlist([...watchlist, asset]);
                        }
                      }}
                      className="flex-1 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 flex items-center justify-center gap-2 text-sm font-medium"
                    >
                      <Star size={16} />
                      Watch
                    </button>
                    <button
                      onClick={() => {
                        const price = prompt(`Set alert price for ${asset.symbol}:`);
                        if (price && !isNaN(price)) {
                          setAlerts([...alerts, {
                            symbol: asset.symbol,
                            targetPrice: parseFloat(price),
                            currentPrice: parseFloat(asset.price)
                          }]);
                        }
                      }}
                      className="flex-1 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 flex items-center justify-center gap-2 text-sm font-medium"
                    >
                      <Bell size={16} />
                      Alert
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Watchlist Tab */}
        {activeTab === 'watchlist' && (
          <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm">
            <h2 className="text-lg sm:text-xl font-bold mb-4">Watchlist</h2>
            {watchlist.length === 0 ? (
              <p className="text-slate-500 text-center py-8 text-sm sm:text-base">No items in watchlist</p>
            ) : (
              <div className="space-y-3">
                {watchlist.map((item, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row justify-between items-start p-4 hover:bg-slate-50 rounded-lg gap-3 border border-slate-200">
                    <div className="flex-1">
                      <div className="font-bold text-blue-600 text-lg">{item.symbol}</div>
                      <div className="text-sm text-slate-600 mt-1">{item.name}</div>
                      
                      {/* Dividend Info */}
                      <div className="mt-2 flex gap-4 text-xs">
                        <div>
                          <span className="text-slate-500">Yield: </span>
                          <span className="font-medium text-green-600">
                            {parseFloat(item.divYield || item.dividendYield || 0).toFixed(2)}%
                          </span>
                        </div>
                        {item.trailingDividendRate > 0 && (
                          <div>
                            <span className="text-slate-500">Dividend: </span>
                            <span className="font-medium text-green-700">
                              ${item.trailingDividendRate.toFixed(3)}/share
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Dividend Growth */}
                      {item.divGrowth3Y !== null && item.divGrowth3Y !== undefined && (
                        <div className="mt-2 flex gap-3 text-xs">
                          <span className="text-emerald-600 font-medium">3Y: {item.divGrowth3Y.toFixed(1)}%</span>
                          {item.divGrowth5Y !== null && (
                            <span className="text-blue-600 font-medium">5Y: {item.divGrowth5Y.toFixed(1)}%</span>
                          )}
                          {item.divGrowth10Y !== null && (
                            <span className="text-purple-600 font-medium">10Y: {item.divGrowth10Y.toFixed(1)}%</span>
                          )}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                      <div className="text-right">
                        <div className="font-bold text-lg">${parseFloat(item.price || 0).toFixed(2)}</div>
                      </div>
                      <button
                        onClick={() => setWatchlist(watchlist.filter((_, i) => i !== idx))}
                        className="text-red-500 hover:text-red-700 p-2"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Alerts Tab */}
        {activeTab === 'alerts' && (
          <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm mt-4 sm:mt-6">
            <h2 className="text-lg sm:text-xl font-bold mb-4">Price Alerts</h2>
            {alerts.length === 0 ? (
              <p className="text-slate-500 text-center py-8 text-sm sm:text-base">No alerts set</p>
            ) : (
              <div className="space-y-2 sm:space-y-3">
                {alerts.map((alert, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 sm:p-4 hover:bg-slate-50 rounded-lg gap-3">
                    <div className="flex-1">
                      <div className="font-medium text-blue-600">{alert.symbol}</div>
                      <div className="text-xs sm:text-sm text-slate-600 mt-1">
                        Current: ${alert.currentPrice.toFixed(2)} → Target: ${alert.targetPrice.toFixed(2)}
                      </div>
                    </div>
                    <button
                      onClick={() => setAlerts(alerts.filter((_, i) => i !== idx))}
                      className="text-red-500 hover:text-red-700 p-2"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Dividends Tab */}
        {activeTab === 'dividends' && (
          <div className="space-y-4 sm:space-y-6">
            <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm">
              <h2 className="text-lg sm:text-xl font-bold mb-4">Dividend Calendar</h2>

              {holdings.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar size={48} className="mx-auto text-slate-300 mb-2" />
                  <p className="text-slate-500 text-sm">เพิ่มหุ้นเข้าพอร์ตเพื่อดูข้อมูลปันผล</p>
                </div>
              ) : (
                <div className="space-y-3 sm:space-y-4">
                  {stats.holdings.map((holding, idx) => {
                    const freq = DIVIDEND_FREQUENCIES[holding.divFrequency];
                    const quarterlyDiv = holding.annualDiv / freq.perYear;
                    
                    return (
                      <div key={idx} className="p-4 sm:p-5 bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl border border-slate-200">
                        <div className="flex flex-col sm:flex-row justify-between items-start gap-3 mb-3">
                          <div>
                            <div className="font-bold text-blue-600 text-lg">{holding.symbol}</div>
                            <div className="text-xs sm:text-sm text-slate-600">{holding.name}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              ความถี่: {freq.label} • Yield: {holding.dividendYield.toFixed(2)}%
                            </div>
                            
                            {/* Dividend Growth Info */}
                            {(holding.divGrowth3Y !== null && holding.divGrowth3Y !== undefined) && (
                              <div className="mt-2 flex gap-3 text-xs">
                                <span className="text-emerald-600 font-medium">
                                  <TrendingUp size={12} className="inline mr-1" />
                                  3Y: {holding.divGrowth3Y.toFixed(1)}%
                                </span>
                                {holding.divGrowth5Y !== null && (
                                  <span className="text-blue-600 font-medium">5Y: {holding.divGrowth5Y.toFixed(1)}%</span>
                                )}
                                {holding.divGrowth10Y !== null && (
                                  <span className="text-purple-600 font-medium">10Y: {holding.divGrowth10Y.toFixed(1)}%</span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="text-left sm:text-right">
                            <div className="font-bold text-green-600 text-base sm:text-lg">
                              ฿{Math.round(quarterlyDiv).toLocaleString()} / งวด
                            </div>
                            <div className="text-xs sm:text-sm text-slate-600">
                              ฿{Math.round(holding.annualDiv).toLocaleString()} / ปี
                            </div>
                            <div className="text-xs text-slate-500 mt-1">
                              {freq.perYear} งวด/ปี
                            </div>
                            {holding.trailingDividendRate > 0 && (
                              <div className="text-xs text-green-700 font-medium mt-1">
                                ${holding.trailingDividendRate.toFixed(3)}/หุ้น
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="max-w-7xl mx-auto px-4 py-6 sm:py-8 text-center text-xs sm:text-sm text-slate-500">
        <p>ETF Portfolio Tracker v6.3 — Enhanced Dividend Information Display</p>
      </div>
    </div>
  );
}

export default App;
