import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { Search, Star, Bell, DollarSign, TrendingUp, Trash2, Plus, RefreshCw } from 'lucide-react';

// Firebase Configuration - ใช้ค่าจาก Environment Variables หรือ fallback
// Debug: Check environment variables
console.log('[Debug] Environment variables check:');
console.log('- VITE_FIREBASE_API_KEY:', import.meta.env.VITE_FIREBASE_API_KEY ? '✅ Set' : '❌ Missing');
console.log('- VITE_FIREBASE_PROJECT_ID:', import.meta.env.VITE_FIREBASE_PROJECT_ID ? '✅ Set' : '❌ Missing');
console.log('- Mode:', import.meta.env.MODE);
console.log('- Prod:', import.meta.env.PROD);

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

console.log('[Debug] Firebase config loaded:', {
  hasApiKey: !!firebaseConfig.apiKey,
  hasProjectId: !!firebaseConfig.projectId,
  apiKeyLength: firebaseConfig.apiKey?.length || 0
});

// Check if Firebase config is valid before initializing
const hasValidFirebaseConfig = 
  firebaseConfig.apiKey && 
  firebaseConfig.apiKey !== "" && 
  firebaseConfig.apiKey !== "undefined" &&
  firebaseConfig.projectId &&
  firebaseConfig.projectId !== "" &&
  firebaseConfig.projectId !== "undefined"

const app = hasValidFirebaseConfig ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

// Log Firebase status
if (hasValidFirebaseConfig && app) {
  console.log('🔥 Firebase initialized successfully');
} else {
  console.log('ℹ️  Firebase not configured - using localStorage only');
}

// API Configuration
const API_KEYS = {
  FMP: import.meta.env.VITE_FMP0N8_API_KEY || process.env.REACT_APP_FMP0N8_API_KEY,
  FINNHUB: import.meta.env.VITE_FINNHUB_API_KEY || process.env.REACT_APP_FINNHUB_API_KEY,
  TWELVE: import.meta.env.VITE_TWELVE_DATA_API_KEY || process.env.REACT_APP_TWELVE_DATA_API_KEY,
  EODHD: import.meta.env.VITE_EODHD_API_KEY || process.env.REACT_APP_EODHD_API_KEY
};

// Cache Manager
const CacheManager = {
  PRICE_CACHE_KEY: 'price_cache_v1',
  CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
  
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

  // Firebase Authentication
  useEffect(() => {
    if (!auth) {
      console.log('ℹ️  Skipping Firebase auth - not configured');
      return;
    }
    
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

  // Load Assets Data
  useEffect(() => {
    const loadAssetsData = async () => {
      // Try loading from cache first
      const cached = localStorage.getItem('etf_local_cache_v6');
      if (cached) {
        try {
          const parsedCache = JSON.parse(cached);
          console.log('[Data] Loading from local cache');
          setAllAssets(Array.isArray(parsedCache) ? parsedCache : Object.values(parsedCache));
          return;
        } catch (e) {
          console.error('[Data] Cache parse error:', e);
          localStorage.removeItem('etf_local_cache_v6');
        }
      }

      // Fetch from GitHub
      console.log('[Data] Fetching from GitHub...');
      try {
        const response = await fetch(
          'https://raw.githubusercontent.com/navykao/my-etf-portfolio/main/data/etf-database.json'
        );
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const json = await response.json();
        
        // Handle both formats:
        // 1. { _meta: {...}, data: { VOO: {...}, SCHD: {...} } }
        // 2. Plain array: [{ symbol: "VOO", ... }, ...]
        let assetsData;
        
        if (json.data && typeof json.data === 'object') {
          // Format 1: Extract data object and convert to array
          assetsData = Object.entries(json.data).map(([symbol, data]) => ({
            symbol,
            ...data
          }));
          console.log('[Data] Loaded from GitHub (object format):', assetsData.length);
        } else if (Array.isArray(json)) {
          // Format 2: Already an array
          assetsData = json;
          console.log('[Data] Loaded from GitHub (array format):', assetsData.length);
        } else {
          // Unknown format
          console.error('[Data] Unknown data format:', json);
          assetsData = [];
        }
        
        setAllAssets(assetsData);
        localStorage.setItem('etf_local_cache_v6', JSON.stringify(assetsData));
        
      } catch (error) {
        console.error('[Data] Fetch error:', error.message || error);
        
        // Show user-friendly error
        alert(`⚠️ Cannot load data from GitHub.\n\nError: ${error.message}\n\nPlease check:\n1. Internet connection\n2. GitHub repository is accessible\n3. File exists at: data/etf-database.json`);
      }
    };

    loadAssetsData();
  }, []);

  // Load Portfolio from Firebase
  const loadPortfolio = useCallback(async () => {
    if (!user || !db) return;
    
    try {
      const docRef = doc(db, 'portfolios', user.uid);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        setHoldings(data.holdings || []);
        setWatchlist(data.watchlist || []);
        setAlerts(data.alerts || []);
        setTotalInvestment(data.totalInvestment || 100000);
        console.log('[Firebase] Portfolio loaded from cloud');
      }
    } catch (error) {
      console.error('[Firebase] Load error:', error);
    }
  }, [user]);

  useEffect(() => {
    loadPortfolio();
  }, [loadPortfolio]);

  // Save Portfolio to Firebase
  const savePortfolio = useCallback(async () => {
    if (!user || !db) return;
    
    try {
      const docRef = doc(db, 'portfolios', user.uid);
      await setDoc(docRef, {
        holdings,
        watchlist,
        alerts,
        totalInvestment,
        updatedAt: new Date().toISOString()
      });
      console.log('[Firebase] Portfolio saved to cloud');
    } catch (error) {
      console.error('[Firebase] Save error:', error);
    }
  }, [user, holdings, watchlist, alerts, totalInvestment]);

  useEffect(() => {
    if (user && holdings.length > 0) {
      savePortfolio();
    }
  }, [holdings, watchlist, alerts, totalInvestment, savePortfolio, user]);

  // Fetch Live Prices
  const fetchLivePrices = useCallback(async () => {
    if (!isLiveMode || holdings.length === 0) return;

    console.log('[Live] Fetching prices...');
    setLastUpdate(new Date());

    const updatedHoldings = await Promise.all(
      holdings.map(async (holding) => {
        const liveData = await APIService.fetchLivePrice(holding.symbol);
        if (liveData) {
          return {
            ...holding,
            currentPrice: liveData.price,
            change: liveData.change,
            changePercent: liveData.changePercent,
            dataSource: liveData.source
          };
        }
        return holding;
      })
    );

    setHoldings(updatedHoldings);
  }, [isLiveMode, holdings]);

  // Auto-refresh in Live Mode
  useEffect(() => {
    if (!isLiveMode) return;

    fetchLivePrices();
    
    const interval = setInterval(() => {
      fetchLivePrices();
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [isLiveMode, fetchLivePrices]);

  // Add to Portfolio
  const addToPortfolio = (asset) => {
    const exists = holdings.find(h => h.symbol === asset.symbol);
    if (exists) {
      alert('หุ้นนี้มีในพอร์ตแล้ว!');
      return;
    }

    const allocation = prompt('ใส่เปอร์เซ็นต์การลงทุน (0-100):', '10');
    if (!allocation || isNaN(allocation) || allocation < 0 || allocation > 100) {
      alert('กรุณาใส่ตัวเลข 0-100');
      return;
    }

    const freqOptions = Object.keys(DIVIDEND_FREQUENCIES)
      .map((key, idx) => `${idx + 1}. ${DIVIDEND_FREQUENCIES[key].label}`)
      .join('\n');
    
    const freqChoice = prompt(
      `เลือกความถี่เงินปันผล:\n${freqOptions}`,
      '2'
    );
    
    const freqKeys = Object.keys(DIVIDEND_FREQUENCIES);
    const frequency = freqKeys[parseInt(freqChoice) - 1] || 'quarterly';

    setHoldings([...holdings, {
      symbol: asset.symbol,
      name: asset.name,
      allocation: parseFloat(allocation),
      divFrequency: frequency,
      currentPrice: parseFloat(asset.price) || 0,
      dividendYield: parseFloat(asset.dividendYield) || 0
    }]);
  };

  // Delete from Portfolio
  const deleteFromPortfolio = (symbol) => {
    if (confirm(`ลบ ${symbol} ออกจากพอร์ต?`)) {
      setHoldings(holdings.filter(h => h.symbol !== symbol));
    }
  };

  // Calculate Portfolio Stats
  const calculateStats = () => {
    const totalAllocation = holdings.reduce((sum, h) => sum + h.allocation, 0);
    const holdingsWithAmounts = holdings.map(h => {
      const amount = (h.allocation / 100) * totalInvestment;
      const shares = h.currentPrice > 0 ? amount / h.currentPrice : 0;
      const annualDiv = (amount * (h.dividendYield / 100));
      return { ...h, amount, shares, annualDiv };
    });

    const totalAnnualDiv = holdingsWithAmounts.reduce((sum, h) => sum + h.annualDiv, 0);
    const avgYield = totalInvestment > 0 ? (totalAnnualDiv / totalInvestment) * 100 : 0;

    return {
      holdings: holdingsWithAmounts,
      totalAllocation,
      totalAnnualDiv,
      avgYield
    };
  };

  const stats = calculateStats();

  // Pie Chart Data
  const pieData = stats.holdings.map(h => ({
    name: h.symbol,
    value: h.allocation
  }));

  const COLORS = ['#60A5FA', '#3B82F6', '#EF4444', '#F59E0B', '#10B981', '#8B5CF6'];

  // Search Results
  const searchResults = allAssets.filter(asset =>
    asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    asset.name.toLowerCase().includes(searchQuery.toLowerCase())
  ).slice(0, 20);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                My ETF Portfolio v6.1
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                {allAssets.length} assets • {holdings.length} holdings
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <span className={isLiveMode ? 'text-green-600 font-medium' : 'text-slate-600'}>
                    {isLiveMode ? '📶 Live Mode' : '💾 Local Cache'}
                  </span>
                </div>
                {lastUpdate && isLiveMode && (
                  <div className="text-xs text-slate-500">
                    {lastUpdate.toLocaleTimeString('th-TH')}
                  </div>
                )}
                {!isLiveMode && (
                  <div className="text-xs text-slate-500">
                    {new Date().toLocaleString('th-TH')}
                  </div>
                )}
              </div>
              <button
                onClick={() => setIsLiveMode(!isLiveMode)}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  isLiveMode
                    ? 'bg-green-500 text-white hover:bg-green-600 shadow-lg'
                    : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                }`}
              >
                {isLiveMode ? '✅ Live' : '💾 Static'}
              </button>
              <button
                onClick={isLiveMode ? fetchLivePrices : loadPortfolio}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all flex items-center gap-2 shadow-md"
              >
                <RefreshCw size={16} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-2 mb-6">
          {[
            { id: 'dashboard', icon: TrendingUp, label: 'Dashboard' },
            { id: 'search', icon: Search, label: 'Search' },
            { id: 'watchlist', icon: Star, label: 'Watchlist' },
            { id: 'alerts', icon: Bell, label: 'Alerts' },
            { id: 'dividends', icon: DollarSign, label: 'Dividends' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <tab.icon size={20} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <div className="text-sm text-slate-600 mb-1">มูลค่าพอร์ต</div>
                <div className="text-3xl font-bold text-slate-900">
                  ฿{totalInvestment.toLocaleString()}
                </div>
              </div>
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <div className="text-sm text-slate-600 mb-1">เงินปันผลต่อปี</div>
                <div className="text-3xl font-bold text-green-600">
                  ฿{Math.round(stats.totalAnnualDiv).toLocaleString()}
                </div>
              </div>
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <div className="text-sm text-slate-600 mb-1">Dividend Yield</div>
                <div className="text-3xl font-bold text-blue-600">
                  {stats.avgYield.toFixed(2)}%
                </div>
              </div>
            </div>

            {/* Pie Chart */}
            {pieData.length > 0 && (
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <h2 className="text-xl font-bold mb-4">สัดส่วนการลงทุน</h2>
                <ResponsiveContainer width="100%" height={400}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      labelLine={true}
                      label={({ name, value }) => `${name} ${value}%`}
                      outerRadius={120}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Holdings Table */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Holdings</h2>
                <div className="text-sm text-slate-600">
                  Total Investment: ฿{totalInvestment.toLocaleString()}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">SYMBOL</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">NAME</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-slate-600">ALLOCATION</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-slate-600">AMOUNT</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-slate-600">SHARES</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-slate-600">PRICE</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-slate-600">YIELD</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-slate-600">ANNUAL DIV</th>
                      {isLiveMode && (
                        <th className="text-right py-3 px-4 text-sm font-medium text-slate-600">CHANGE</th>
                      )}
                      <th className="text-center py-3 px-4 text-sm font-medium text-slate-600">ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.holdings.map((holding, idx) => (
                      <tr key={idx} className="border-b hover:bg-slate-50">
                        <td className="py-3 px-4 font-medium text-blue-600">{holding.symbol}</td>
                        <td className="py-3 px-4 text-sm text-slate-600">{holding.name}</td>
                        <td className="py-3 px-4 text-right">{holding.allocation}%</td>
                        <td className="py-3 px-4 text-right">฿{holding.amount.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                        <td className="py-3 px-4 text-right">{holding.shares.toFixed(2)}</td>
                        <td className="py-3 px-4 text-right">
                          ${holding.currentPrice.toFixed(2)}
                          {holding.dataSource && (
                            <span className="ml-2 text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded">
                              {holding.dataSource}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">{holding.dividendYield.toFixed(2)}%</td>
                        <td className="py-3 px-4 text-right text-green-600">฿{Math.round(holding.annualDiv).toLocaleString()}</td>
                        {isLiveMode && (
                          <td className="py-3 px-4 text-right">
                            <span className={holding.changePercent >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                              {holding.changePercent >= 0 ? '+' : ''}{holding.changePercent?.toFixed(2)}%
                            </span>
                          </td>
                        )}
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => deleteFromPortfolio(holding.symbol)}
                            className="text-red-500 hover:text-red-700 transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Search Tab */}
        {activeTab === 'search' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <div className="mb-6">
              <input
                type="text"
                placeholder="Search stocks or ETFs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-5 gap-4 py-2 px-4 bg-slate-50 rounded-lg font-medium text-sm text-slate-600">
                <div>SYMBOL</div>
                <div>NAME</div>
                <div className="text-right">PRICE</div>
                <div className="text-right">YIELD</div>
                <div className="text-center">ACTIONS</div>
              </div>
              {searchResults.map((asset, idx) => (
                <div key={idx} className="grid grid-cols-5 gap-4 py-3 px-4 hover:bg-slate-50 rounded-lg items-center">
                  <div className="font-medium text-blue-600">{asset.symbol}</div>
                  <div className="text-sm text-slate-600">{asset.name}</div>
                  <div className="text-right">${parseFloat(asset.price || 0).toFixed(2)}</div>
                  <div className="text-right">{parseFloat(asset.dividendYield || 0).toFixed(2)}%</div>
                  <div className="flex justify-center gap-2">
                    <button
                      onClick={() => addToPortfolio(asset)}
                      className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                      title="Add to Portfolio"
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      onClick={() => {
                        if (!watchlist.find(w => w.symbol === asset.symbol)) {
                          setWatchlist([...watchlist, asset]);
                        }
                      }}
                      className="p-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors"
                      title="Add to Watchlist"
                    >
                      <Star size={16} />
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
                      className="p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                      title="Set Alert"
                    >
                      <Bell size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Watchlist Tab */}
        {activeTab === 'watchlist' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-xl font-bold mb-4">Watchlist</h2>
            {watchlist.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No items in watchlist</p>
            ) : (
              <div className="space-y-2">
                {watchlist.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center p-4 hover:bg-slate-50 rounded-lg">
                    <div>
                      <div className="font-medium text-blue-600">{item.symbol}</div>
                      <div className="text-sm text-slate-600">{item.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">${parseFloat(item.price || 0).toFixed(2)}</div>
                      <div className="text-sm text-slate-600">{parseFloat(item.dividendYield || 0).toFixed(2)}% yield</div>
                    </div>
                    <button
                      onClick={() => setWatchlist(watchlist.filter((_, i) => i !== idx))}
                      className="text-red-500 hover:text-red-700 transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Alerts Tab */}
        {activeTab === 'alerts' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-xl font-bold mb-4">Price Alerts</h2>
            {alerts.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No alerts set</p>
            ) : (
              <div className="space-y-2">
                {alerts.map((alert, idx) => (
                  <div key={idx} className="flex justify-between items-center p-4 hover:bg-slate-50 rounded-lg">
                    <div>
                      <div className="font-medium text-blue-600">{alert.symbol}</div>
                      <div className="text-sm text-slate-600">
                        Current: ${alert.currentPrice.toFixed(2)} → Target: ${alert.targetPrice.toFixed(2)}
                      </div>
                    </div>
                    <button
                      onClick={() => setAlerts(alerts.filter((_, i) => i !== idx))}
                      className="text-red-500 hover:text-red-700 transition-colors"
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
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-xl font-bold mb-4">Dividend Calendar</h2>
            <div className="space-y-4">
              {stats.holdings.map((holding, idx) => {
                const freq = DIVIDEND_FREQUENCIES[holding.divFrequency];
                const quarterlyDiv = holding.annualDiv / freq.perYear;
                
                return (
                  <div key={idx} className="p-4 bg-slate-50 rounded-lg">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-medium text-blue-600">{holding.symbol}</div>
                        <div className="text-sm text-slate-600">{freq.label}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium text-green-600">
                          ฿{Math.round(quarterlyDiv).toLocaleString()} / period
                        </div>
                        <div className="text-sm text-slate-600">
                          ฿{Math.round(holding.annualDiv).toLocaleString()} / year
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-slate-500">
                      Yield: {holding.dividendYield.toFixed(2)}% • {freq.perYear} payments/year
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="max-w-7xl mx-auto px-4 py-8 text-center text-sm text-slate-500">
        <p>ETF Portfolio Tracker v6.1 — Enhanced Features Edition with Live Mode</p>
      </div>
    </div>
  );
}

export default App;
