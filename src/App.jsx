import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Search, Star, Bell, DollarSign, TrendingUp, Trash2, Plus, RefreshCw, Menu, X, Calendar, TrendingDown } from 'lucide-react';

// Import data files
import assetsData from './combined-746-assets.json';
// or use: import assetsData from './combined-all-assets.json';

// Firebase Configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDqL8F3qH_VvX9jW6kZ7nN8mP5oQ2rS4tU",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "my-etf-portfolio.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "my-etf-portfolio",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "my-etf-portfolio.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "123456789012",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:123456789012:web:abcdef1234567890abcdef"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// API Configuration - ใช้ || fallback เพื่อป้องกันค่า undefined
const API_KEYS = {
  FMP: import.meta.env.VITE_FMP_API_KEY || '',
  FINNHUB: import.meta.env.VITE_FINNHUB_API_KEY || '',
  TWELVE: import.meta.env.VITE_TWELVE_DATA_API_KEY || '',
  EODHD: import.meta.env.VITE_EODHD_API_KEY || ''
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
  const [isLoading, setIsLoading] = useState(true);

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

  // Load Assets Data from imported JSON
  useEffect(() => {
    console.log('[Data] Loading assets from imported JSON...');
    try {
      if (assetsData && Array.isArray(assetsData)) {
        setAllAssets(assetsData);
        console.log(`[Data] Loaded ${assetsData.length} assets successfully`);
      } else {
        console.error('[Data] Invalid assets data format');
        setAllAssets([]);
      }
    } catch (error) {
      console.error('[Data] Error loading assets:', error);
      setAllAssets([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load User Data from Firebase
  useEffect(() => {
    if (!user) return;

    const loadUserData = async () => {
      try {
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          console.log('[Firebase] User data loaded:', data);
          setHoldings(data.holdings || []);
          setWatchlist(data.watchlist || []);
          setAlerts(data.alerts || []);
          setTotalInvestment(data.totalInvestment || 100000);
        } else {
          console.log('[Firebase] No user data found, using defaults');
        }
      } catch (error) {
        console.error('[Firebase] Error loading user data:', error);
      }
    };

    loadUserData();
  }, [user]);

  // Save User Data to Firebase
  const saveUserData = useCallback(async () => {
    if (!user) return;

    try {
      const docRef = doc(db, 'users', user.uid);
      await setDoc(docRef, {
        holdings,
        watchlist,
        alerts,
        totalInvestment,
        lastUpdated: new Date().toISOString()
      });
      console.log('[Firebase] User data saved successfully');
    } catch (error) {
      console.error('[Firebase] Error saving user data:', error);
    }
  }, [user, holdings, watchlist, alerts, totalInvestment]);

  // Auto-save when data changes
  useEffect(() => {
    if (user) {
      const timeoutId = setTimeout(saveUserData, 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [holdings, watchlist, alerts, totalInvestment, user, saveUserData]);

  // Calculate Portfolio Statistics
  const stats = React.useMemo(() => {
    const holdingsWithDetails = holdings.map(h => {
      const asset = allAssets.find(a => a.symbol === h.symbol);
      if (!asset) return null;

      const shares = h.shares || 0;
      const currentValue = shares * parseFloat(asset.price || 0);
      const invested = h.invested || 0;
      const gain = currentValue - invested;
      const gainPercent = invested > 0 ? (gain / invested) * 100 : 0;

      const divYield = parseFloat(asset.divYield || asset.dividendYield || 0);
      const annualDiv = currentValue * (divYield / 100);
      const divFrequency = asset.divFrequency || 'quarterly';

      return {
        ...h,
        ...asset,
        shares,
        currentValue,
        invested,
        gain,
        gainPercent,
        dividendYield: divYield,
        annualDiv,
        divFrequency,
        trailingDividendRate: parseFloat(asset.trailingDividendRate || 0),
        divGrowth3Y: asset.divGrowth3Y,
        divGrowth5Y: asset.divGrowth5Y,
        divGrowth10Y: asset.divGrowth10Y
      };
    }).filter(Boolean);

    const totalValue = holdingsWithDetails.reduce((sum, h) => sum + h.currentValue, 0);
    const totalGain = holdingsWithDetails.reduce((sum, h) => sum + h.gain, 0);
    const totalGainPercent = totalInvestment > 0 ? (totalGain / totalInvestment) * 100 : 0;
    const totalAnnualDiv = holdingsWithDetails.reduce((sum, h) => sum + h.annualDiv, 0);
    const avgYield = totalValue > 0 ? (totalAnnualDiv / totalValue) * 100 : 0;

    return {
      holdings: holdingsWithDetails,
      totalValue,
      totalGain,
      totalGainPercent,
      totalAnnualDiv,
      avgYield
    };
  }, [holdings, allAssets, totalInvestment]);

  // Filtered Assets for Search
  const filteredAssets = React.useMemo(() => {
    if (!searchQuery.trim()) return [];
    
    const query = searchQuery.toLowerCase();
    return allAssets
      .filter(asset => 
        asset.symbol.toLowerCase().includes(query) ||
        asset.name.toLowerCase().includes(query)
      )
      .slice(0, 20);
  }, [searchQuery, allAssets]);

  // Add to Holdings
  const addToHoldings = (asset) => {
    const shares = parseFloat(prompt(`จำนวนหุ้น ${asset.symbol}:`) || '0');
    if (shares <= 0 || isNaN(shares)) return;

    const avgPrice = parseFloat(prompt(`ราคาเฉลี่ย (ปัจจุบัน: $${asset.price}):`) || asset.price);
    const invested = shares * avgPrice;

    const newHolding = {
      symbol: asset.symbol,
      shares,
      invested,
      addedAt: new Date().toISOString()
    };

    setHoldings(prev => [...prev, newHolding]);
    setSearchQuery('');
  };

  // Delete from Holdings
  const deleteHolding = (index) => {
    if (confirm('ต้องการลบหุ้นนี้ออกจากพอร์ตหรือไม่?')) {
      setHoldings(prev => prev.filter((_, i) => i !== index));
    }
  };

  // Refresh Live Prices
  const refreshLivePrices = async () => {
    if (!isLiveMode) {
      alert('⚠️ กรุณาเปิดโหมด Live Prices ก่อน');
      return;
    }

    setLastUpdate('กำลังอัปเดต...');
    
    for (const holding of stats.holdings) {
      const liveData = await APIService.fetchLivePrice(holding.symbol);
      if (liveData) {
        console.log(`[Update] ${holding.symbol}: $${liveData.price}`);
      }
    }

    setLastUpdate(new Date().toLocaleString('th-TH'));
  };

  // Loading State
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="animate-spin mx-auto mb-4 text-blue-600" size={48} />
          <p className="text-lg text-slate-600">กำลังโหลดข้อมูล...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">My ETF Portfolio</h1>
              <p className="text-sm text-slate-500 mt-1">
                {allAssets.length} assets • {holdings.length} holdings
              </p>
            </div>

            {/* Mobile Menu Toggle */}
            <button 
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="lg:hidden p-2 rounded-lg hover:bg-slate-100"
            >
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center gap-2">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === 'dashboard'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <TrendingUp size={18} />
                <span className="hidden sm:inline">Dashboard</span>
              </button>
              <button
                onClick={() => setActiveTab('search')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === 'search'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Search size={18} />
                <span className="hidden sm:inline">Search</span>
              </button>
              <button
                onClick={() => setActiveTab('watchlist')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === 'watchlist'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Star size={18} />
                <span className="hidden sm:inline">Watchlist</span>
              </button>
              <button
                onClick={() => setActiveTab('alerts')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === 'alerts'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Bell size={18} />
                <span className="hidden sm:inline">Alerts</span>
              </button>
              <button
                onClick={() => setActiveTab('dividends')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === 'dividends'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <DollarSign size={18} />
                <span className="hidden sm:inline">Dividends</span>
              </button>
            </nav>
          </div>

          {/* Mobile Navigation */}
          {isMobileMenuOpen && (
            <nav className="lg:hidden mt-4 flex flex-col gap-2 pb-2">
              <button
                onClick={() => {
                  setActiveTab('dashboard');
                  setIsMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg font-medium ${
                  activeTab === 'dashboard'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                <TrendingUp size={18} />
                Dashboard
              </button>
              <button
                onClick={() => {
                  setActiveTab('search');
                  setIsMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg font-medium ${
                  activeTab === 'search'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                <Search size={18} />
                Search
              </button>
              <button
                onClick={() => {
                  setActiveTab('watchlist');
                  setIsMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg font-medium ${
                  activeTab === 'watchlist'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                <Star size={18} />
                Watchlist
              </button>
              <button
                onClick={() => {
                  setActiveTab('alerts');
                  setIsMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg font-medium ${
                  activeTab === 'alerts'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                <Bell size={18} />
                Alerts
              </button>
              <button
                onClick={() => {
                  setActiveTab('dividends');
                  setIsMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg font-medium ${
                  activeTab === 'dividends'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                <DollarSign size={18} />
                Dividends
              </button>
            </nav>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-500">มูลค่าพอร์ต</span>
                  <DollarSign className="text-blue-600" size={20} />
                </div>
                <div className="text-2xl font-bold text-slate-800">
                  ฿{Math.round(stats.totalValue).toLocaleString()}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  ลงทุน: ฿{Math.round(totalInvestment).toLocaleString()}
                </div>
              </div>

              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-500">กำไร/ขาดทุน</span>
                  <TrendingUp className={stats.totalGain >= 0 ? 'text-green-600' : 'text-red-600'} size={20} />
                </div>
                <div className={`text-2xl font-bold ${stats.totalGain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {stats.totalGain >= 0 ? '+' : ''}฿{Math.round(stats.totalGain).toLocaleString()}
                </div>
                <div className={`text-xs mt-1 ${stats.totalGainPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {stats.totalGainPercent >= 0 ? '+' : ''}{stats.totalGainPercent.toFixed(2)}%
                </div>
              </div>

              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-500">เงินปันผลรายปี</span>
                  <DollarSign className="text-green-600" size={20} />
                </div>
                <div className="text-2xl font-bold text-green-600">
                  ฿{Math.round(stats.totalAnnualDiv).toLocaleString()}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  ~฿{Math.round(stats.totalAnnualDiv / 12).toLocaleString()} / เดือน
                </div>
              </div>

              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-500">Avg Yield</span>
                  <Percent className="text-emerald-600" size={20} />
                </div>
                <div className="text-2xl font-bold text-emerald-600">
                  {stats.avgYield.toFixed(2)}%
                </div>
              </div>
            </div>

            {/* Holdings Section */}
            <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg sm:text-xl font-bold">Holdings</h2>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={isLiveMode}
                      onChange={(e) => setIsLiveMode(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-slate-600">Live Prices</span>
                  </label>
                  {isLiveMode && (
                    <button
                      onClick={refreshLivePrices}
                      className="p-2 hover:bg-slate-100 rounded-lg"
                      title="Refresh prices"
                    >
                      <RefreshCw size={16} className="text-blue-600" />
                    </button>
                  )}
                </div>
              </div>

              {holdings.length === 0 ? (
                <div className="text-center py-12">
                  <TrendingDown size={48} className="mx-auto text-slate-300 mb-4" />
                  <p className="text-slate-500 mb-4">ยังไม่มีหุ้นในพอร์ต</p>
                  <button
                    onClick={() => setActiveTab('search')}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 inline-flex items-center gap-2"
                  >
                    <Plus size={18} />
                    เพิ่มหุ้นเข้าพอร์ต
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto -mx-4 sm:mx-0">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-y border-slate-200">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-slate-600">Symbol</th>
                        <th className="px-4 py-3 text-left font-medium text-slate-600 hidden sm:table-cell">Name</th>
                        <th className="px-4 py-3 text-right font-medium text-slate-600">Shares</th>
                        <th className="px-4 py-3 text-right font-medium text-slate-600">Price</th>
                        <th className="px-4 py-3 text-right font-medium text-slate-600">Value</th>
                        <th className="px-4 py-3 text-right font-medium text-slate-600 hidden md:table-cell">Gain/Loss</th>
                        <th className="px-4 py-3 text-right font-medium text-slate-600 hidden lg:table-cell">Yield</th>
                        <th className="px-4 py-3 text-center font-medium text-slate-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {stats.holdings.map((holding, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="font-bold text-blue-600">{holding.symbol}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-600 hidden sm:table-cell max-w-xs truncate">
                            {holding.name}
                          </td>
                          <td className="px-4 py-3 text-right">{holding.shares}</td>
                          <td className="px-4 py-3 text-right font-medium">
                            ${parseFloat(holding.price || 0).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-right font-bold">
                            ฿{Math.round(holding.currentValue).toLocaleString()}
                          </td>
                          <td className={`px-4 py-3 text-right font-medium hidden md:table-cell ${
                            holding.gain >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {holding.gain >= 0 ? '+' : ''}฿{Math.round(holding.gain).toLocaleString()}
                            <div className="text-xs">
                              ({holding.gainPercent >= 0 ? '+' : ''}{holding.gainPercent.toFixed(1)}%)
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right text-green-600 font-medium hidden lg:table-cell">
                            {holding.dividendYield.toFixed(2)}%
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => deleteHolding(idx)}
                              className="text-red-500 hover:text-red-700 p-2"
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

              {lastUpdate && (
                <div className="mt-4 text-xs text-slate-500 text-center">
                  Last update: {lastUpdate}
                </div>
              )}
            </div>
          </>
        )}

        {/* Search Tab */}
        {activeTab === 'search' && (
          <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm">
            <h2 className="text-lg sm:text-xl font-bold mb-4">ค้นหาหุ้น</h2>
            
            <div className="relative mb-6">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400" size={20} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาด้วย Symbol หรือชื่อหุ้น..."
                className="w-full pl-12 pr-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-3">
              {filteredAssets.length === 0 && searchQuery && (
                <p className="text-center text-slate-500 py-8">ไม่พบข้อมูลที่ค้นหา</p>
              )}
              
              {filteredAssets.map((asset, idx) => (
                <div key={idx} className="p-4 border border-slate-200 rounded-xl hover:border-blue-300 transition-colors">
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                    <div className="flex-1">
                      <div className="font-bold text-blue-600 text-lg">{asset.symbol}</div>
                      <div className="text-sm text-slate-600 mt-1">{asset.name}</div>
                      
                      <div className="mt-2 flex flex-wrap gap-3 text-xs">
                        <div>
                          <span className="text-slate-500">Price: </span>
                          <span className="font-medium">${parseFloat(asset.price || 0).toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Yield: </span>
                          <span className="font-medium text-green-600">
                            {parseFloat(asset.divYield || asset.dividendYield || 0).toFixed(2)}%
                          </span>
                        </div>
                        {asset.trailingDividendRate > 0 && (
                          <div>
                            <span className="text-slate-500">Div: </span>
                            <span className="font-medium text-green-700">
                              ${asset.trailingDividendRate.toFixed(3)}/sh
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex gap-2 w-full sm:w-auto">
                      <button
                        onClick={() => addToHoldings(asset)}
                        className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 text-sm font-medium"
                      >
                        <Plus size={16} />
                        Add
                      </button>
                      <button
                        onClick={() => setWatchlist([...watchlist, asset])}
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
        <p className="mt-1">Loaded {allAssets.length} assets from JSON</p>
      </div>
    </div>
  );
}

export default App;
