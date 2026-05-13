import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { Search, Star, Bell, DollarSign, TrendingUp, Trash2, Plus, RefreshCw, AlertCircle } from 'lucide-react';

// ============================================
// FIREBASE CONFIGURATION - ใช้ Environment Variables
// ============================================
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "my-etf-portfolio.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "my-etf-portfolio",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "my-etf-portfolio.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

let app, auth, db;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  console.log('[Firebase] ✅ Initialized successfully');
} catch (error) {
  console.error('[Firebase] ❌ Initialization failed:', error);
}

// ============================================
// API CONFIGURATION
// ============================================
const API_KEYS = {
  FMP: import.meta.env.VITE_FMP0N8_API_KEY,
  FINNHUB: import.meta.env.VITE_FINNHUB_API_KEY,
  TWELVE: import.meta.env.VITE_TWELVE_DATA_API_KEY,
  EODHD: import.meta.env.VITE_EODHD_API_KEY
};

// ตรวจสอบ API Keys
const checkAPIKeys = () => {
  const missing = Object.entries(API_KEYS).filter(([key, value]) => !value);
  if (missing.length > 0) {
    console.warn('[API] ⚠️ Missing API keys:', missing.map(([k]) => k).join(', '));
  } else {
    console.log('[API] ✅ All API keys configured');
  }
};
checkAPIKeys();

// ============================================
// CACHE MANAGER - เพิ่ม Cache Duration
// ============================================
const CacheManager = {
  PRICE_CACHE_KEY: 'price_cache_v2',
  CACHE_DURATION: 15 * 60 * 1000, // เพิ่มเป็น 15 นาที
  
  getPriceCache: (symbol) => {
    try {
      const cache = JSON.parse(localStorage.getItem(CacheManager.PRICE_CACHE_KEY) || '{}');
      const cached = cache[symbol];
      if (cached && Date.now() - new Date(cached.timestamp).getTime() < CacheManager.CACHE_DURATION) {
        console.log(`[Cache] ✅ Hit: ${symbol}`);
        return cached;
      }
      console.log(`[Cache] ❌ Miss: ${symbol}`);
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
      console.log(`[Cache] ✅ Saved: ${symbol}`);
    } catch (e) {
      console.error('[Cache] Write error:', e);
    }
  },

  clearCache: () => {
    try {
      localStorage.removeItem(CacheManager.PRICE_CACHE_KEY);
      console.log('[Cache] ✅ Cleared');
    } catch (e) {
      console.error('[Cache] Clear error:', e);
    }
  }
};

// ============================================
// API SERVICE - ปรับปรุง Error Handling และ Retry Logic
// ============================================
const APIService = {
  // Helper: Fetch with retry
  async fetchWithRetry(url, options = {}, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(10000) // 10 second timeout
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
      } catch (error) {
        console.error(`[API] Attempt ${i + 1}/${retries + 1} failed:`, error.message);
        
        if (i === retries) throw error;
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
      }
    }
  },

  async fetchFromFMP(symbol) {
    if (!API_KEYS.FMP) {
      console.warn('[API] FMP key not configured');
      return null;
    }
    
    try {
      console.log(`[API] 🔄 FMP: Fetching ${symbol}...`);
      const data = await this.fetchWithRetry(
        `https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${API_KEYS.FMP}`
      );
      
      if (data && data[0] && data[0].price) {
        console.log(`[API] ✅ FMP: ${symbol} = $${data[0].price}`);
        return {
          price: data[0].price,
          change: data[0].change || 0,
          changePercent: data[0].changesPercentage || 0,
          source: 'FMP'
        };
      }
      
      console.warn(`[API] ⚠️ FMP: No data for ${symbol}`);
      return null;
    } catch (error) {
      console.error(`[API] ❌ FMP error for ${symbol}:`, error.message);
      return null;
    }
  },

  async fetchFromFinnhub(symbol) {
    if (!API_KEYS.FINNHUB) {
      console.warn('[API] Finnhub key not configured');
      return null;
    }
    
    try {
      console.log(`[API] 🔄 Finnhub: Fetching ${symbol}...`);
      const data = await this.fetchWithRetry(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${API_KEYS.FINNHUB}`
      );
      
      if (data && data.c > 0) {
        console.log(`[API] ✅ Finnhub: ${symbol} = $${data.c}`);
        return {
          price: data.c,
          change: data.d || 0,
          changePercent: data.dp || 0,
          source: 'Finnhub'
        };
      }
      
      console.warn(`[API] ⚠️ Finnhub: No data for ${symbol}`);
      return null;
    } catch (error) {
      console.error(`[API] ❌ Finnhub error for ${symbol}:`, error.message);
      return null;
    }
  },

  async fetchFromTwelve(symbol) {
    if (!API_KEYS.TWELVE) {
      console.warn('[API] Twelve Data key not configured');
      return null;
    }
    
    try {
      console.log(`[API] 🔄 Twelve Data: Fetching ${symbol}...`);
      const data = await this.fetchWithRetry(
        `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${API_KEYS.TWELVE}`
      );
      
      if (data && data.price) {
        console.log(`[API] ✅ Twelve Data: ${symbol} = $${data.price}`);
        return {
          price: parseFloat(data.price),
          change: 0,
          changePercent: 0,
          source: 'TwelveData'
        };
      }
      
      console.warn(`[API] ⚠️ Twelve Data: No data for ${symbol}`);
      return null;
    } catch (error) {
      console.error(`[API] ❌ Twelve Data error for ${symbol}:`, error.message);
      return null;
    }
  },

  async fetchLivePrice(symbol) {
    // ตรวจสอบ cache ก่อน
    const cached = CacheManager.getPriceCache(symbol);
    if (cached) return cached;

    console.log(`[API] 🎯 Fetching live price for ${symbol}...`);
    
    // พยายามดึงจาก API แต่ละตัว
    const apis = [
      { name: 'FMP', fn: () => this.fetchFromFMP(symbol) },
      { name: 'Finnhub', fn: () => this.fetchFromFinnhub(symbol) },
      { name: 'Twelve Data', fn: () => this.fetchFromTwelve(symbol) }
    ];

    for (const api of apis) {
      try {
        const result = await api.fn();
        if (result && result.price > 0) {
          console.log(`[API] ✅ Success with ${api.name} for ${symbol}`);
          CacheManager.setPriceCache(symbol, result);
          return result;
        }
      } catch (error) {
        console.error(`[API] ${api.name} failed:`, error);
      }
    }

    console.error(`[API] ❌ All APIs failed for ${symbol}`);
    return null;
  }
};

// ============================================
// DIVIDEND FREQUENCIES
// ============================================
const DIVIDEND_FREQUENCIES = {
  monthly: { label: 'รายเดือน', perYear: 12 },
  quarterly: { label: 'ราย 3 เดือน', perYear: 4 },
  semiannual: { label: 'ราย 6 เดือน', perYear: 2 },
  annual: { label: 'รายปี', perYear: 1 }
};

// ============================================
// TOAST NOTIFICATION COMPONENT
// ============================================
const Toast = ({ message, type = 'info', onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    info: 'bg-blue-500',
    warning: 'bg-yellow-500'
  }[type];

  return (
    <div className={`fixed top-4 right-4 ${bgColor} text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-slide-in`}>
      {message}
    </div>
  );
};

// ============================================
// MAIN APP COMPONENT
// ============================================
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
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [errors, setErrors] = useState([]);

  // Toast helper
  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
  }, []);

  // ============================================
  // FIREBASE AUTHENTICATION
  // ============================================
  useEffect(() => {
    if (!auth) {
      console.error('[Firebase] Auth not initialized');
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        console.log('[Firebase] ✅ User authenticated:', currentUser.uid);
      } else {
        console.log('[Firebase] 🔄 Signing in anonymously...');
        signInAnonymously(auth)
          .then(() => console.log('[Firebase] ✅ Anonymous sign-in successful'))
          .catch(err => {
            console.error('[Firebase] ❌ Auth error:', err);
            setErrors(prev => [...prev, 'Firebase authentication failed']);
          });
      }
    });
    
    return () => unsubscribe();
  }, []);

  // ============================================
  // LOAD ASSETS DATA
  // ============================================
  useEffect(() => {
    const loadAssetsData = async () => {
      // ลองโหลดจาก cache ก่อน
      const cached = localStorage.getItem('etf_local_cache_v7');
      if (cached) {
        try {
          const parsedData = JSON.parse(cached);
          console.log('[Data] ✅ Loaded from cache:', parsedData.length, 'assets');
          setAllAssets(parsedData);
          return;
        } catch (e) {
          console.error('[Data] Cache parse error:', e);
        }
      }

      // ถ้าไม่มี cache ให้ดึงจาก GitHub
      console.log('[Data] 🔄 Fetching from GitHub...');
      setLoading(true);
      
      try {
        const response = await fetch(
          'https://raw.githubusercontent.com/navykao/my-etf-portfolio/main/public/data/combined-746-assets.json',
          { cache: 'no-cache' }
        );
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        console.log('[Data] ✅ Fetched from GitHub:', data.length, 'assets');
        
        setAllAssets(data);
        localStorage.setItem('etf_local_cache_v7', JSON.stringify(data));
        showToast('ข้อมูลโหลดสำเร็จ', 'success');
      } catch (error) {
        console.error('[Data] ❌ Fetch error:', error);
        setErrors(prev => [...prev, 'Failed to load assets data']);
        showToast('โหลดข้อมูลล้มเหลว', 'error');
      } finally {
        setLoading(false);
      }
    };

    loadAssetsData();
  }, [showToast]);

  // ============================================
  // LOAD USER DATA FROM FIREBASE
  // ============================================
  useEffect(() => {
    if (!user || !db) return;

    const loadUserData = async () => {
      try {
        console.log('[Firebase] 🔄 Loading user data...');
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          console.log('[Firebase] ✅ User data loaded');
          setHoldings(data.holdings || []);
          setWatchlist(data.watchlist || []);
          setAlerts(data.alerts || []);
          setTotalInvestment(data.totalInvestment || 100000);
        } else {
          console.log('[Firebase] ℹ️ No existing user data');
        }
      } catch (error) {
        console.error('[Firebase] ❌ Load error:', error);
        setErrors(prev => [...prev, 'Failed to load user data']);
      }
    };

    loadUserData();
  }, [user]);

  // ============================================
  // SAVE USER DATA TO FIREBASE
  // ============================================
  const saveUserData = useCallback(async () => {
    if (!user || !db) return;

    try {
      console.log('[Firebase] 💾 Saving user data...');
      const docRef = doc(db, 'users', user.uid);
      await setDoc(docRef, {
        holdings,
        watchlist,
        alerts,
        totalInvestment,
        lastUpdated: new Date().toISOString()
      });
      console.log('[Firebase] ✅ Data saved');
    } catch (error) {
      console.error('[Firebase] ❌ Save error:', error);
      showToast('บันทึกข้อมูลล้มเหลว', 'error');
    }
  }, [user, holdings, watchlist, alerts, totalInvestment, showToast]);

  // Auto-save เมื่อข้อมูลเปลี่ยน
  useEffect(() => {
    if (user) {
      const timer = setTimeout(() => {
        saveUserData();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [holdings, watchlist, alerts, totalInvestment, user, saveUserData]);

  // ============================================
  // LIVE MODE - UPDATE PRICES
  // ============================================
  useEffect(() => {
    if (!isLiveMode || holdings.length === 0) return;

    const updatePrices = async () => {
      console.log('[Live] 🔄 Updating prices...');
      setLoading(true);

      const updatedHoldings = [];
      for (const holding of holdings) {
        const liveData = await APIService.fetchLivePrice(holding.symbol);
        
        if (liveData) {
          updatedHoldings.push({
            ...holding,
            currentPrice: liveData.price,
            change: liveData.change,
            changePercent: liveData.changePercent,
            dataSource: liveData.source
          });
        } else {
          updatedHoldings.push(holding);
        }
      }

      setHoldings(updatedHoldings);
      setLastUpdate(new Date());
      setLoading(false);
      console.log('[Live] ✅ Prices updated');
    };

    updatePrices();
    const interval = setInterval(updatePrices, 60000); // ทุก 1 นาที

    return () => clearInterval(interval);
  }, [isLiveMode, holdings.length]); // ใช้ length แทน holdings ทั้งหมด

  // ============================================
  // COMPUTED STATS - ใช้ useMemo เพื่อ Performance
  // ============================================
  const stats = useMemo(() => {
    const totalValue = holdings.reduce((sum, h) => sum + (h.shares * h.currentPrice), 0);
    const totalDividend = holdings.reduce((sum, h) => sum + h.annualDiv, 0);
    const avgYield = holdings.length > 0 
      ? holdings.reduce((sum, h) => sum + h.dividendYield, 0) / holdings.length 
      : 0;

    return {
      totalValue,
      totalDividend,
      avgYield,
      holdings: holdings.map(h => ({
        ...h,
        value: h.shares * h.currentPrice,
        annualDiv: h.shares * h.currentPrice * (h.dividendYield / 100)
      }))
    };
  }, [holdings]);

  // ============================================
  // SEARCH RESULTS - ใช้ useMemo
  // ============================================
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    
    const query = searchQuery.toLowerCase();
    return allAssets
      .filter(asset => 
        asset.symbol.toLowerCase().includes(query) ||
        asset.name.toLowerCase().includes(query)
      )
      .slice(0, 20);
  }, [searchQuery, allAssets]);

  // ============================================
  // PORTFOLIO ACTIONS
  // ============================================
  const addToPortfolio = useCallback((asset) => {
    const shares = prompt(`How many shares of ${asset.symbol}?`);
    if (!shares || isNaN(shares)) return;

    const newHolding = {
      symbol: asset.symbol,
      name: asset.name,
      shares: parseFloat(shares),
      currentPrice: parseFloat(asset.price || 0),
      dividendYield: parseFloat(asset.dividendYield || 0),
      divFrequency: 'quarterly',
      change: 0,
      changePercent: 0
    };

    setHoldings(prev => [...prev, newHolding]);
    showToast(`เพิ่ม ${asset.symbol} สำเร็จ`, 'success');
  }, [showToast]);

  const deleteFromPortfolio = useCallback((symbol) => {
    if (confirm(`Delete ${symbol} from portfolio?`)) {
      setHoldings(prev => prev.filter(h => h.symbol !== symbol));
      showToast(`ลบ ${symbol} สำเร็จ`, 'success');
    }
  }, [showToast]);

  const refreshPrices = useCallback(async () => {
    console.log('[Refresh] 🔄 Manual refresh triggered');
    CacheManager.clearCache();
    setIsLiveMode(false);
    setTimeout(() => setIsLiveMode(true), 100);
    showToast('กำลังรีเฟรชข้อมูล...', 'info');
  }, [showToast]);

  // ============================================
  // PIE CHART DATA
  // ============================================
  const pieData = useMemo(() => 
    stats.holdings.map(h => ({
      name: h.symbol,
      value: h.value
    })),
    [stats.holdings]
  );

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

  // ============================================
  // RENDER
  // ============================================
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Toast Notifications */}
      {toast && (
        <Toast 
          message={toast.message} 
          type={toast.type} 
          onClose={() => setToast(null)} 
        />
      )}

      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <DollarSign className="text-blue-600" size={32} />
              <div>
                <h1 className="text-2xl font-bold text-slate-800">ETF Portfolio Tracker</h1>
                <p className="text-sm text-slate-500">v6.3 Enhanced Edition</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              {/* Live Mode Toggle */}
              <button
                onClick={() => setIsLiveMode(!isLiveMode)}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  isLiveMode 
                    ? 'bg-green-500 text-white shadow-lg' 
                    : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                }`}
              >
                {isLiveMode ? '🟢 Live Mode' : '⚫ Static Mode'}
              </button>

              {/* Refresh Button */}
              <button
                onClick={refreshPrices}
                disabled={loading}
                className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-all"
                title="Refresh Prices"
              >
                <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
              </button>

              {lastUpdate && (
                <div className="text-xs text-slate-500">
                  Updated: {lastUpdate.toLocaleTimeString('th-TH')}
                </div>
              )}
            </div>
          </div>

          {/* Error Messages */}
          {errors.length > 0 && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="text-red-500 flex-shrink-0" size={20} />
                <div className="text-sm text-red-700">
                  {errors.map((error, i) => (
                    <div key={i}>• {error}</div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex gap-2 overflow-x-auto">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: TrendingUp },
            { id: 'search', label: 'Search', icon: Search },
            { id: 'watchlist', label: 'Watchlist', icon: Star },
            { id: 'alerts', label: 'Alerts', icon: Bell },
            { id: 'dividends', label: 'Dividends', icon: DollarSign }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-blue-500 text-white shadow-md'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 pb-8">
        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                <div className="text-sm text-slate-500 mb-1">Total Value</div>
                <div className="text-2xl font-bold text-slate-800">
                  ฿{Math.round(stats.totalValue).toLocaleString()}
                </div>
              </div>
              
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                <div className="text-sm text-slate-500 mb-1">Investment</div>
                <div className="text-2xl font-bold text-slate-800">
                  ฿{totalInvestment.toLocaleString()}
                </div>
              </div>
              
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                <div className="text-sm text-slate-500 mb-1">Annual Dividend</div>
                <div className="text-2xl font-bold text-green-600">
                  ฿{Math.round(stats.totalDividend).toLocaleString()}
                </div>
              </div>
              
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                <div className="text-sm text-slate-500 mb-1">Avg Yield</div>
                <div className="text-2xl font-bold text-blue-600">
                  {stats.avgYield.toFixed(2)}%
                </div>
              </div>
            </div>

            {/* Chart & Portfolio */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Pie Chart */}
              {holdings.length > 0 && (
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                  <h2 className="text-xl font-bold mb-4 text-slate-800">Portfolio Allocation</h2>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => `฿${Math.round(value).toLocaleString()}`} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Holdings Table */}
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                <h2 className="text-xl font-bold mb-4 text-slate-800">Holdings</h2>
                {holdings.length === 0 ? (
                  <p className="text-slate-500 text-center py-8">No holdings yet. Add some from Search!</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="py-2 px-2 text-left">Symbol</th>
                          <th className="py-2 px-2 text-right">Shares</th>
                          <th className="py-2 px-2 text-right">Price</th>
                          <th className="py-2 px-2 text-right">Yield</th>
                          {isLiveMode && <th className="py-2 px-2 text-right">Change</th>}
                          <th className="py-2 px-2 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.holdings.map((holding, idx) => (
                          <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-3 px-2 font-medium text-blue-600">{holding.symbol}</td>
                            <td className="py-3 px-2 text-right">{holding.shares}</td>
                            <td className="py-3 px-2 text-right">
                              ${holding.currentPrice.toFixed(2)}
                              {holding.dataSource && (
                                <span className="ml-1 text-xs bg-blue-100 text-blue-600 px-1 py-0.5 rounded">
                                  {holding.dataSource}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-2 text-right">{holding.dividendYield.toFixed(2)}%</td>
                            {isLiveMode && (
                              <td className="py-3 px-2 text-right">
                                <span className={holding.changePercent >= 0 ? 'text-green-600' : 'text-red-600'}>
                                  {holding.changePercent >= 0 ? '+' : ''}{holding.changePercent?.toFixed(2)}%
                                </span>
                              </td>
                            )}
                            <td className="py-3 px-2 text-center">
                              <button
                                onClick={() => deleteFromPortfolio(holding.symbol)}
                                className="text-red-500 hover:text-red-700 transition-colors"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Search Tab */}
        {activeTab === 'search' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <div className="mb-6">
              <input
                type="text"
                placeholder="Search stocks or ETFs by symbol or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-500 mt-2">
                {allAssets.length} assets available • {searchResults.length} results
              </p>
            </div>
            
            {searchResults.length > 0 ? (
              <div className="space-y-2">
                <div className="grid grid-cols-6 gap-4 py-2 px-4 bg-slate-50 rounded-lg font-medium text-sm text-slate-600">
                  <div>SYMBOL</div>
                  <div className="col-span-2">NAME</div>
                  <div className="text-right">PRICE</div>
                  <div className="text-right">YIELD</div>
                  <div className="text-center">ACTIONS</div>
                </div>
                {searchResults.map((asset, idx) => (
                  <div key={idx} className="grid grid-cols-6 gap-4 py-3 px-4 hover:bg-slate-50 rounded-lg items-center border border-slate-100">
                    <div className="font-medium text-blue-600">{asset.symbol}</div>
                    <div className="text-sm text-slate-600 col-span-2 truncate">{asset.name}</div>
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
                            showToast(`เพิ่ม ${asset.symbol} ใน Watchlist`, 'success');
                          }
                        }}
                        className="p-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors"
                        title="Add to Watchlist"
                      >
                        <Star size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : searchQuery ? (
              <p className="text-slate-500 text-center py-8">No results found</p>
            ) : (
              <p className="text-slate-500 text-center py-8">Start typing to search...</p>
            )}
          </div>
        )}

        {/* Watchlist Tab */}
        {activeTab === 'watchlist' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <h2 className="text-xl font-bold mb-4 text-slate-800">Watchlist</h2>
            {watchlist.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No items in watchlist</p>
            ) : (
              <div className="space-y-2">
                {watchlist.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center p-4 hover:bg-slate-50 rounded-lg border border-slate-100">
                    <div>
                      <div className="font-medium text-blue-600">{item.symbol}</div>
                      <div className="text-sm text-slate-600">{item.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">${parseFloat(item.price || 0).toFixed(2)}</div>
                      <div className="text-sm text-slate-600">{parseFloat(item.dividendYield || 0).toFixed(2)}% yield</div>
                    </div>
                    <button
                      onClick={() => {
                        setWatchlist(watchlist.filter((_, i) => i !== idx));
                        showToast(`ลบ ${item.symbol} จาก Watchlist`, 'success');
                      }}
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
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <h2 className="text-xl font-bold mb-4 text-slate-800">Price Alerts</h2>
            {alerts.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No alerts set</p>
            ) : (
              <div className="space-y-2">
                {alerts.map((alert, idx) => (
                  <div key={idx} className="flex justify-between items-center p-4 hover:bg-slate-50 rounded-lg border border-slate-100">
                    <div>
                      <div className="font-medium text-blue-600">{alert.symbol}</div>
                      <div className="text-sm text-slate-600">
                        Current: ${alert.currentPrice.toFixed(2)} → Target: ${alert.targetPrice.toFixed(2)}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setAlerts(alerts.filter((_, i) => i !== idx));
                        showToast(`ลบ Alert สำหรับ ${alert.symbol}`, 'success');
                      }}
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
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <h2 className="text-xl font-bold mb-4 text-slate-800">Dividend Calendar</h2>
            {holdings.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No holdings to show dividends</p>
            ) : (
              <div className="space-y-4">
                {stats.holdings.map((holding, idx) => {
                  const freq = DIVIDEND_FREQUENCIES[holding.divFrequency || 'quarterly'];
                  const periodDiv = holding.annualDiv / freq.perYear;
                  
                  return (
                    <div key={idx} className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="font-medium text-blue-600">{holding.symbol}</div>
                          <div className="text-sm text-slate-600">{freq.label}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-medium text-green-600">
                            ฿{Math.round(periodDiv).toLocaleString()} / period
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
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="max-w-7xl mx-auto px-4 py-8 text-center text-sm text-slate-500 border-t border-slate-200">
        <p>ETF Portfolio Tracker v6.3 — Enhanced with Better Error Handling & Performance</p>
        <p className="text-xs mt-1">Cache: 15min • Live Mode: 1min update • Auto-save enabled</p>
      </div>

      {/* CSS Animation */}
      <style jsx>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}

export default App;
