/**
 * =====================================================
 * App.jsx v6.0 — Enhanced Features Edition
 * =====================================================
 * 
 * ✅ v6.0 อัพเดต (May 12, 2026):
 *   1. [NEW] 📊 Pie Chart - แสดงสัดส่วนพอร์ต
 *   2. [NEW] 💾 Data Source Indicator - แสดงแหล่งข้อมูล + Timestamp
 *   3. [NEW] 💰 Dividend Calendar - ปฏิทินเงินปันผล
 *   4. [NEW] ⭐ Watchlist + 🔔 Alerts - ติดตามหุ้น + แจ้งเตือนราคา
 *   5. [IMPROVED] 🔥 Firebase Integration - บันทึกพอร์ตอัตโนมัติ
 *   6. [IMPROVED] 🎨 Modern Minimal Design - ออกแบบใหม่สไตล์มินิมอล
 * 
 * ⚠️ คำแนะนำการติดตั้ง:
 * 1. แทนที่ไฟล์ App.jsx เดิมด้วยไฟล์นี้
 * 2. Commit และ push ขึ้น GitHub
 * 3. Deploy จะอัพเดทอัตโนมัติ
 * =====================================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  LineChart, Wallet, TrendingUp, PiggyBank, RefreshCw, 
  Calculator, Calendar, ArrowUpRight, DollarSign, 
  AlertCircle, Trash2, Plus, Info, CheckCircle2, 
  Database, Cloud, CloudOff, Save, X, HardDrive,
  Clock, Zap, Shield, Github, Server, Smartphone,
  Settings, BarChart3, Activity, Package, Radio,
  Bell, Star, Search, Filter
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';

// =====================================================
// 🔥 FIREBASE CONFIG
// =====================================================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDzl3so9I793U1GGs6aQUs3d0GK-4uyy8k",
  authDomain: "my-etf-portfolio.firebaseapp.com",
  projectId: "my-etf-portfolio",
  storageBucket: "my-etf-portfolio.firebasestorage.app",
  messagingSenderId: "999667791801",
  appId: "1:999667791801:web:6e413d5e34f37982002868"
};

const hasFirebaseConfig = FIREBASE_CONFIG.apiKey !== "" && FIREBASE_CONFIG.projectId !== "";

// =====================================================
// ✨ Dividend Frequency Configuration
// =====================================================
const DIVIDEND_FREQUENCIES = {
  monthly: { label: 'รายเดือน', months: 1, periodsPerYear: 12 },
  quarterly: { label: 'รายไตรมาส', months: 3, periodsPerYear: 4 },
  semiannual: { label: 'ราย 6 เดือน', months: 6, periodsPerYear: 2 },
  annual: { label: 'รายปี', months: 12, periodsPerYear: 1 },
};

// =====================================================
// Cache Configuration
// =====================================================
const DEFAULT_CACHE_CONFIG = {
  LOCAL_CACHE_KEY: 'etf_local_cache_v6',
  LOCAL_CACHE_DAYS: 7,
  GITHUB_JSON_URL: 'https://raw.githubusercontent.com/navykao/my-etf-portfolio/main/data/combined-all-assets.json',
  GITHUB_CACHE_KEY: 'etf_github_cache_v6',
  GITHUB_CACHE_HOURS: 6,
  API_CALL_LOG_KEY: 'etf_api_calls_v6',
  DAILY_API_LIMIT: 30,
  SETTINGS_KEY: 'etf_cache_settings_v6',
  STATS_KEY: 'etf_cache_stats_v6',
};

// =====================================================
// Color Palette - Modern Minimal
// =====================================================
const PIE_COLORS = [
  '#A8DADC', '#457B9D', '#F1FAEE', '#E63946', '#F4A261',
  '#2A9D8F', '#E76F51', '#264653', '#8AB4F8', '#FAD2E1',
  '#C9ADA7', '#9A8C98', '#4A4E69', '#F2CC8F', '#81B29A'
];

// =====================================================
// Cache Manager with Hit/Miss Stats
// =====================================================
const CacheManager = {
  config: { ...DEFAULT_CACHE_CONFIG },
  stats: { hits: 0, misses: 0, apiCalls: 0 },

  loadSettings: () => {
    try {
      const saved = localStorage.getItem(DEFAULT_CACHE_CONFIG.SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        CacheManager.config.LOCAL_CACHE_DAYS = parsed.cacheDays || 7;
        CacheManager.config.GITHUB_CACHE_HOURS = parsed.githubCacheHours || 6;
      }
    } catch { }
  },

  saveSettings: (settings) => {
    CacheManager.config.LOCAL_CACHE_DAYS = settings.cacheDays;
    CacheManager.config.GITHUB_CACHE_HOURS = settings.githubCacheHours;
    localStorage.setItem(DEFAULT_CACHE_CONFIG.SETTINGS_KEY, JSON.stringify(settings));
  },

  loadStats: () => {
    try {
      const saved = localStorage.getItem(DEFAULT_CACHE_CONFIG.STATS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.date === new Date().toDateString()) {
          CacheManager.stats = parsed;
        } else {
          CacheManager.stats = { hits: 0, misses: 0, apiCalls: 0, date: new Date().toDateString() };
        }
      }
    } catch { }
  },

  saveStats: () => {
    try {
      const stats = { ...CacheManager.stats, date: new Date().toDateString() };
      localStorage.setItem(DEFAULT_CACHE_CONFIG.STATS_KEY, JSON.stringify(stats));
    } catch { }
  },

  recordCacheHit: () => { CacheManager.stats.hits++; CacheManager.saveStats(); },
  recordCacheMiss: () => { CacheManager.stats.misses++; CacheManager.saveStats(); },
  recordApiCall: () => { CacheManager.stats.apiCalls++; CacheManager.saveStats(); },

  canMakeApiCall: () => {
    const log = localStorage.getItem(DEFAULT_CACHE_CONFIG.API_CALL_LOG_KEY);
    if (!log) return true;
    const entries = JSON.parse(log);
    const today = new Date().toDateString();
    const todayCalls = entries.filter(e => e.date === today).length;
    return todayCalls < DEFAULT_CACHE_CONFIG.DAILY_API_LIMIT;
  },

  logApiCall: () => {
    const log = localStorage.getItem(DEFAULT_CACHE_CONFIG.API_CALL_LOG_KEY) || '[]';
    const entries = JSON.parse(log);
    entries.push({ date: new Date().toDateString(), time: new Date().toISOString() });
    const last7days = new Date(Date.now() - 7 * 86400000).toDateString();
    const filtered = entries.filter(e => new Date(e.date) >= new Date(last7days));
    localStorage.setItem(DEFAULT_CACHE_CONFIG.API_CALL_LOG_KEY, JSON.stringify(filtered.slice(-100)));
    CacheManager.recordApiCall();
  },
};

CacheManager.loadSettings();
CacheManager.loadStats();

// =====================================================
// INITIAL DATA
// =====================================================
const INITIAL_PORTFOLIO = [
  { symbol: 'SCHD', allocation: 30, divFrequency: 'quarterly', data: null },
  { symbol: 'VYM', allocation: 25, divFrequency: 'quarterly', data: null },
  { symbol: 'JEPI', allocation: 20, divFrequency: 'monthly', data: null },
  { symbol: 'VOO', allocation: 15, divFrequency: 'quarterly', data: null },
  { symbol: 'VNQ', allocation: 10, divFrequency: 'quarterly', data: null },
];

// =====================================================
// Firebase Setup
// =====================================================
let firebaseApp = null;
let firestoreDb = null;
let auth = null;

if (hasFirebaseConfig) {
  try {
    firebaseApp = initializeApp(FIREBASE_CONFIG);
    firestoreDb = getFirestore(firebaseApp);
    auth = getAuth(firebaseApp);
  } catch (error) {
    console.error('[Firebase Init Error]', error);
  }
}

// =====================================================
// Utility Functions
// =====================================================
const formatCurrency = (value) => {
  return new Intl.NumberFormat('th-TH', { 
    style: 'currency', 
    currency: 'THB', 
    maximumFractionDigits: 0 
  }).format(value);
};

const formatNumber = (num, decimals = 2) => {
  return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

// =====================================================
// Main App Component
// =====================================================
export default function App() {
  // Portfolio State
  const [portfolio, setPortfolio] = useState(INITIAL_PORTFOLIO);
  const [allAssets, setAllAssets] = useState([]);
  const [totalInvestment, setTotalInvestment] = useState(100000);
  
  // UI State
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Data Source State
  const [dataSource, setDataSource] = useState({ 
    type: 'cache', 
    timestamp: null,
    assetsCount: 0
  });
  
  // Watchlist & Alerts State
  const [watchlist, setWatchlist] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [selectedAssetForAlert, setSelectedAssetForAlert] = useState(null);
  const [alertForm, setAlertForm] = useState({ priceHigh: '', priceLow: '' });
  
  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  
  // Dividend Calendar State
  const [selectedQuarter, setSelectedQuarter] = useState('all');
  
  // Firebase State
  const [currentUser, setCurrentUser] = useState(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState('disconnected');

  // =====================================================
  // Firebase Auth
  // =====================================================
  useEffect(() => {
    if (!hasFirebaseConfig || !auth) return;
    
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        setCloudSyncStatus('connected');
        console.log('[Firebase] User authenticated:', user.uid);
      } else {
        signInAnonymously(auth).catch(err => {
          console.error('[Firebase] Auth error:', err);
          setCloudSyncStatus('error');
        });
      }
    });

    return () => unsubscribe();
  }, []);

  // =====================================================
  // Load Portfolio from Firebase
  // =====================================================
  useEffect(() => {
    if (!currentUser || !firestoreDb) return;

    const portfolioRef = doc(firestoreDb, 'portfolios', currentUser.uid);
    
    const unsubscribe = onSnapshot(portfolioRef, 
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.holdings) setPortfolio(data.holdings);
          if (data.totalInvestment) setTotalInvestment(data.totalInvestment);
          if (data.watchlist) setWatchlist(data.watchlist);
          if (data.alerts) setAlerts(data.alerts);
          console.log('[Firebase] Portfolio loaded from cloud');
        }
      },
      (error) => {
        console.error('[Firebase] Snapshot error:', error);
        setCloudSyncStatus('error');
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  // =====================================================
  // Save Portfolio to Firebase
  // =====================================================
  const saveToFirebase = async (data) => {
    if (!currentUser || !firestoreDb) return;
    
    try {
      const portfolioRef = doc(firestoreDb, 'portfolios', currentUser.uid);
      await setDoc(portfolioRef, {
        ...data,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      console.log('[Firebase] Portfolio saved to cloud');
    } catch (error) {
      console.error('[Firebase] Save error:', error);
    }
  };

  // =====================================================
  // Load Assets Data
  // =====================================================
  const loadAssetsData = async (forceRefresh = false) => {
    setIsRefreshing(true);
    
    try {
      // Check local cache first
      if (!forceRefresh) {
        const cached = localStorage.getItem(DEFAULT_CACHE_CONFIG.LOCAL_CACHE_KEY);
        const timestamp = localStorage.getItem('etf_cache_timestamp');
        
        if (cached && timestamp) {
          const data = JSON.parse(cached);
          setAllAssets(data);
          setDataSource({ 
            type: 'cache', 
            timestamp: new Date(timestamp),
            assetsCount: data.length
          });
          setIsLoading(false);
          setIsRefreshing(false);
          CacheManager.recordCacheHit();
          return;
        }
      }
      
      // Check API limit
      if (!CacheManager.canMakeApiCall()) {
        alert('เกินจำนวน API calls วันนี้แล้ว (30 calls/day)');
        setIsRefreshing(false);
        return;
      }
      
      // Fetch from GitHub
      console.log('[Data] Fetching from GitHub...');
      const response = await fetch(DEFAULT_CACHE_CONFIG.GITHUB_JSON_URL);
      const data = await response.json();
      
      setAllAssets(data);
      const now = new Date();
      
      // Save to cache
      localStorage.setItem(DEFAULT_CACHE_CONFIG.LOCAL_CACHE_KEY, JSON.stringify(data));
      localStorage.setItem('etf_cache_timestamp', now.toISOString());
      
      setDataSource({ 
        type: 'github', 
        timestamp: now,
        assetsCount: data.length
      });
      
      CacheManager.logApiCall();
      CacheManager.recordCacheMiss();
      
    } catch (error) {
      console.error('[Data] Load error:', error);
      alert('ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // Load data on mount
  useEffect(() => {
    loadAssetsData();
  }, []);

  // =====================================================
  // Load Watchlist & Alerts from localStorage
  // =====================================================
  useEffect(() => {
    try {
      const savedWatchlist = localStorage.getItem('etf_watchlist_v6');
      const savedAlerts = localStorage.getItem('etf_alerts_v6');
      if (savedWatchlist) setWatchlist(JSON.parse(savedWatchlist));
      if (savedAlerts) setAlerts(JSON.parse(savedAlerts));
    } catch (error) {
      console.error('[Storage] Load error:', error);
    }
  }, []);

  // =====================================================
  // Request Notification Permission
  // =====================================================
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // =====================================================
  // Check Price Alerts
  // =====================================================
  useEffect(() => {
    if (alerts.length === 0 || allAssets.length === 0) return;
    
    alerts.forEach(alert => {
      const asset = allAssets.find(a => a.symbol === alert.symbol);
      if (!asset) return;
      
      const price = parseFloat(asset.price);
      const high = parseFloat(alert.priceHigh);
      const low = parseFloat(alert.priceLow);
      
      if ((high && price >= high) || (low && price <= low)) {
        // Show notification
        if (Notification.permission === 'granted') {
          new Notification(`🔔 Alert: ${alert.symbol}`, {
            body: `ราคา: $${price} (เป้า: สูง $${high}, ต่ำ $${low})`,
            icon: '📈'
          });
        }
      }
    });
  }, [allAssets, alerts]);

  // =====================================================
  // Portfolio Calculations
  // =====================================================
  const portfolioWithData = useMemo(() => {
    return portfolio.map(item => {
      const asset = allAssets.find(a => a.symbol === item.symbol);
      const amount = totalInvestment * (item.allocation / 100);
      const shares = asset ? amount / parseFloat(asset.price) : 0;
      const currentValue = asset ? shares * parseFloat(asset.price) : amount;
      const dividendYield = asset?.dividendYield ? parseFloat(asset.dividendYield) : 0;
      const annualDividend = currentValue * (dividendYield / 100);
      
      return {
        ...item,
        asset,
        amount,
        shares,
        currentValue,
        price: asset ? parseFloat(asset.price) : 0,
        dividendYield,
        annualDividend
      };
    });
  }, [portfolio, allAssets, totalInvestment]);

  const totalValue = portfolioWithData.reduce((sum, item) => sum + item.currentValue, 0);
  const totalAnnualDividend = portfolioWithData.reduce((sum, item) => sum + item.annualDividend, 0);
  const portfolioYield = totalValue > 0 ? (totalAnnualDividend / totalValue) * 100 : 0;

  // =====================================================
  // Pie Chart Data
  // =====================================================
  const pieData = portfolioWithData.map(item => ({
    name: item.symbol,
    value: item.allocation,
    amount: item.currentValue
  }));

  // =====================================================
  // Dividend Calendar (Mock Data - แทนด้วยข้อมูลจริงภายหลัง)
  // =====================================================
  const dividendCalendar = useMemo(() => {
    return portfolioWithData.map(item => {
      const freq = DIVIDEND_FREQUENCIES[item.divFrequency];
      const dividendPerPeriod = item.annualDividend / freq.periodsPerYear;
      
      return {
        symbol: item.symbol,
        name: item.asset?.name || item.symbol,
        frequency: freq.label,
        periodsPerYear: freq.periodsPerYear,
        dividendPerPeriod,
        annualDividend: item.annualDividend,
        exDate: new Date(2026, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1),
        payDate: new Date(2026, Math.floor(Math.random() * 12) + 1, Math.floor(Math.random() * 28) + 1)
      };
    }).sort((a, b) => a.exDate - b.exDate);
  }, [portfolioWithData]);

  const filteredDividends = useMemo(() => {
    if (selectedQuarter === 'all') return dividendCalendar;
    const q = parseInt(selectedQuarter);
    return dividendCalendar.filter(d => Math.ceil((d.exDate.getMonth() + 1) / 3) === q);
  }, [dividendCalendar, selectedQuarter]);

  // =====================================================
  // Search Filtered Assets
  // =====================================================
  const filteredAssets = useMemo(() => {
    if (!searchQuery) return allAssets.slice(0, 50);
    const query = searchQuery.toLowerCase();
    return allAssets.filter(a => 
      a.symbol.toLowerCase().includes(query) || 
      a.name?.toLowerCase().includes(query)
    ).slice(0, 50);
  }, [allAssets, searchQuery]);

  // =====================================================
  // Watchlist Management
  // =====================================================
  const addToWatchlist = (asset) => {
    if (watchlist.find(w => w.symbol === asset.symbol)) {
      alert('มีในรายการติดตามอยู่แล้ว');
      return;
    }
    const updated = [...watchlist, { symbol: asset.symbol, name: asset.name }];
    setWatchlist(updated);
    localStorage.setItem('etf_watchlist_v6', JSON.stringify(updated));
    saveToFirebase({ watchlist: updated });
  };

  const removeFromWatchlist = (symbol) => {
    const updated = watchlist.filter(w => w.symbol !== symbol);
    setWatchlist(updated);
    localStorage.setItem('etf_watchlist_v6', JSON.stringify(updated));
    saveToFirebase({ watchlist: updated });
  };

  // =====================================================
  // Alert Management
  // =====================================================
  const openAlertModal = (asset) => {
    setSelectedAssetForAlert(asset);
    setShowAlertModal(true);
    setAlertForm({ priceHigh: '', priceLow: '' });
  };

  const saveAlert = () => {
    if (!selectedAssetForAlert) return;
    if (!alertForm.priceHigh && !alertForm.priceLow) {
      alert('กรุณาระบุราคาเป้าหมายอย่างน้อย 1 ค่า');
      return;
    }
    
    const newAlert = {
      symbol: selectedAssetForAlert.symbol,
      name: selectedAssetForAlert.name || selectedAssetForAlert.symbol,
      priceHigh: alertForm.priceHigh,
      priceLow: alertForm.priceLow,
      createdAt: new Date().toISOString()
    };
    
    const updated = [...alerts, newAlert];
    setAlerts(updated);
    localStorage.setItem('etf_alerts_v6', JSON.stringify(updated));
    saveToFirebase({ alerts: updated });
    setShowAlertModal(false);
  };

  const removeAlert = (index) => {
    const updated = alerts.filter((_, i) => i !== index);
    setAlerts(updated);
    localStorage.setItem('etf_alerts_v6', JSON.stringify(updated));
    saveToFirebase({ alerts: updated });
  };

  // =====================================================
  // Portfolio Management
  // =====================================================
  const updateAllocation = (symbol, newAllocation) => {
    const updated = portfolio.map(item => 
      item.symbol === symbol ? { ...item, allocation: newAllocation } : item
    );
    setPortfolio(updated);
    saveToFirebase({ holdings: updated });
  };

  const removeFromPortfolio = (symbol) => {
    const updated = portfolio.filter(item => item.symbol !== symbol);
    setPortfolio(updated);
    saveToFirebase({ holdings: updated });
  };

  const addToPortfolio = (asset) => {
    const allocation = prompt(`เปอร์เซ็นต์การลงทุนใน ${asset.symbol}? (0-100)`);
    if (!allocation || isNaN(allocation)) return;
    
    const newAllocation = parseFloat(allocation);
    if (newAllocation <= 0 || newAllocation > 100) {
      alert('กรุณาระบุค่าระหว่าง 0-100');
      return;
    }
    
    const divFreq = prompt('ความถี่เงินปันผล? (monthly/quarterly/semiannual/annual)', 'quarterly');
    if (!DIVIDEND_FREQUENCIES[divFreq]) {
      alert('กรุณาระบุ: monthly, quarterly, semiannual, หรือ annual');
      return;
    }
    
    const newItem = {
      symbol: asset.symbol,
      allocation: newAllocation,
      divFrequency: divFreq,
      data: null
    };
    
    const updated = [...portfolio, newItem];
    setPortfolio(updated);
    saveToFirebase({ holdings: updated });
  };

  // =====================================================
  // Loading Screen
  // =====================================================
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-slate-600 font-medium">กำลังโหลดข้อมูล...</p>
          <p className="text-slate-400 text-sm mt-2">746 assets • 487 stocks • 259 ETFs</p>
        </div>
      </div>
    );
  }

  // =====================================================
  // Main Render
  // =====================================================
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                My ETF Portfolio v6.0
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                {dataSource.assetsCount} assets • {portfolio.length} holdings
              </p>
            </div>
            
            {/* Data Source Indicator */}
            <div className="flex items-center gap-3">
              <div className="bg-white rounded-lg px-4 py-2 shadow-sm border border-slate-200">
                <div className="flex items-center gap-2 text-sm">
                  {dataSource.type === 'cache' ? (
                    <>
                      <HardDrive className="w-4 h-4 text-green-500" />
                      <span className="font-medium text-slate-700">💾 Local Cache</span>
                    </>
                  ) : (
                    <>
                      <Cloud className="w-4 h-4 text-blue-500" />
                      <span className="font-medium text-slate-700">🌐 GitHub API</span>
                    </>
                  )}
                </div>
                {dataSource.timestamp && (
                  <div className="text-xs text-slate-500 mt-1">
                    {dataSource.timestamp.toLocaleString('th-TH')}
                  </div>
                )}
              </div>
              
              {hasFirebaseConfig && (
                <div className={`bg-white rounded-lg px-3 py-2 shadow-sm border ${
                  cloudSyncStatus === 'connected' ? 'border-green-200' : 'border-slate-200'
                }`}>
                  <div className="flex items-center gap-2">
                    {cloudSyncStatus === 'connected' ? (
                      <>
                        <Shield className="w-4 h-4 text-green-500" />
                        <span className="text-xs font-medium text-green-700">Cloud Sync</span>
                      </>
                    ) : (
                      <>
                        <CloudOff className="w-4 h-4 text-slate-400" />
                        <span className="text-xs font-medium text-slate-500">Offline</span>
                      </>
                    )}
                  </div>
                </div>
              )}
              
              <button
                onClick={() => loadAssetsData(true)}
                disabled={isRefreshing}
                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span className="text-sm font-medium">Refresh</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Tabs */}
        <div className="flex gap-2 mb-6 bg-white/60 backdrop-blur-sm p-2 rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          {[
            { id: 'dashboard', icon: '📊', label: 'Dashboard' },
            { id: 'search', icon: '🔍', label: 'Search' },
            { id: 'watchlist', icon: '⭐', label: 'Watchlist' },
            { id: 'alerts', icon: '🔔', label: 'Alerts' },
            { id: 'dividends', icon: '💰', label: 'Dividends' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 min-w-[120px] px-4 py-3 rounded-lg font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-md'
                  : 'text-slate-600 hover:bg-white/80'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl p-6 shadow-md border border-slate-200">
                <div className="text-sm text-slate-500 mb-1">มูลค่าพอร์ต</div>
                <div className="text-2xl font-bold text-slate-800">
                  {formatCurrency(totalValue)}
                </div>
              </div>
              
              <div className="bg-white rounded-xl p-6 shadow-md border border-slate-200">
                <div className="text-sm text-slate-500 mb-1">เงินปันผลต่อปี</div>
                <div className="text-2xl font-bold text-emerald-600">
                  {formatCurrency(totalAnnualDividend)}
                </div>
              </div>
              
              <div className="bg-white rounded-xl p-6 shadow-md border border-slate-200">
                <div className="text-sm text-slate-500 mb-1">Dividend Yield</div>
                <div className="text-2xl font-bold text-blue-600">
                  {portfolioYield.toFixed(2)}%
                </div>
              </div>
            </div>

            {/* Pie Chart */}
            {portfolio.length > 0 && (
              <div className="bg-white rounded-xl p-6 shadow-md border border-slate-200">
                <h2 className="text-xl font-bold text-slate-800 mb-4">สัดส่วนการลงทุน</h2>
                <ResponsiveContainer width="100%" height={400}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name} ${value}%`}
                      outerRadius={120}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      formatter={(value, name, props) => [
                        `${value}% (${formatCurrency(props.payload.amount)})`,
                        name
                      ]}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Portfolio Table */}
            <div className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-800">Holdings</h2>
                <div className="text-sm text-slate-500">
                  Total Investment: {formatCurrency(totalInvestment)}
                </div>
              </div>
              
              {portfolio.length === 0 ? (
                <div className="p-12 text-center">
                  <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-500 text-lg">ยังไม่มีการลงทุน</p>
                  <p className="text-slate-400 text-sm mt-2">ไปที่ Search เพื่อเพิ่มหุ้น</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Symbol</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Name</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Allocation</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Amount</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Shares</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Price</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Yield</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Annual Div</th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {portfolioWithData.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 font-bold text-blue-600">{item.symbol}</td>
                          <td className="px-6 py-4 text-slate-700">{item.asset?.name || '-'}</td>
                          <td className="px-6 py-4 text-right text-slate-700">{item.allocation}%</td>
                          <td className="px-6 py-4 text-right text-slate-700">{formatCurrency(item.amount)}</td>
                          <td className="px-6 py-4 text-right text-slate-700">{formatNumber(item.shares, 2)}</td>
                          <td className="px-6 py-4 text-right text-slate-700">${formatNumber(item.price, 2)}</td>
                          <td className="px-6 py-4 text-right text-emerald-600 font-semibold">{item.dividendYield.toFixed(2)}%</td>
                          <td className="px-6 py-4 text-right text-emerald-600 font-semibold">{formatCurrency(item.annualDividend)}</td>
                          <td className="px-6 py-4 text-center">
                            <button
                              onClick={() => removeFromPortfolio(item.symbol)}
                              className="text-rose-500 hover:text-rose-700 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
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
        )}

        {/* Search Tab */}
        {activeTab === 'search' && (
          <div className="space-y-6">
            
            <div className="bg-white rounded-xl p-6 shadow-md border border-slate-200">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="ค้นหาด้วย Symbol หรือชื่อ..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                />
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Symbol</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Name</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Price</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Yield</th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAssets.map((asset, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 font-bold text-blue-600">{asset.symbol}</td>
                        <td className="px-6 py-4 text-slate-700">{asset.name || '-'}</td>
                        <td className="px-6 py-4 text-right text-slate-700">${formatNumber(parseFloat(asset.price), 2)}</td>
                        <td className="px-6 py-4 text-right text-emerald-600">
                          {asset.dividendYield ? `${parseFloat(asset.dividendYield).toFixed(2)}%` : '-'}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => addToPortfolio(asset)}
                              className="bg-blue-500 hover:bg-blue-600 text-white p-2 rounded-lg text-sm transition-all"
                              title="เพิ่มเข้าพอร์ต"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => addToWatchlist(asset)}
                              className="bg-amber-500 hover:bg-amber-600 text-white p-2 rounded-lg text-sm transition-all"
                              title="เพิ่มเข้า Watchlist"
                            >
                              <Star className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => openAlertModal(asset)}
                              className="bg-rose-500 hover:bg-rose-600 text-white p-2 rounded-lg text-sm transition-all"
                              title="ตั้งแจ้งเตือนราคา"
                            >
                              <Bell className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            
          </div>
        )}

        {/* Watchlist Tab */}
        {activeTab === 'watchlist' && (
          <div className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="text-xl font-bold text-slate-800">⭐ Watchlist</h2>
            </div>
            
            {watchlist.length === 0 ? (
              <div className="p-12 text-center">
                <Star className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-500 text-lg">ยังไม่มีรายการติดตาม</p>
                <p className="text-slate-400 text-sm mt-2">เพิ่มจาก Search tab</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Symbol</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Name</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Current Price</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Yield</th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {watchlist.map((item, idx) => {
                      const asset = allAssets.find(a => a.symbol === item.symbol);
                      return (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 font-bold text-blue-600">{item.symbol}</td>
                          <td className="px-6 py-4 text-slate-700">{item.name}</td>
                          <td className="px-6 py-4 text-right text-slate-700">
                            {asset ? `$${formatNumber(parseFloat(asset.price), 2)}` : 'N/A'}
                          </td>
                          <td className="px-6 py-4 text-right text-emerald-600">
                            {asset?.dividendYield ? `${parseFloat(asset.dividendYield).toFixed(2)}%` : '-'}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => asset && addToPortfolio(asset)}
                                className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-lg text-sm transition-all"
                                disabled={!asset}
                              >
                                เพิ่มเข้าพอร์ต
                              </button>
                              <button
                                onClick={() => removeFromWatchlist(item.symbol)}
                                className="text-rose-500 hover:text-rose-700 transition-colors"
                              >
                                <X className="w-5 h-5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Alerts Tab */}
        {activeTab === 'alerts' && (
          <div className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="text-xl font-bold text-slate-800">🔔 Price Alerts</h2>
            </div>
            
            {alerts.length === 0 ? (
              <div className="p-12 text-center">
                <Bell className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-500 text-lg">ยังไม่มีการตั้งแจ้งเตือน</p>
                <p className="text-slate-400 text-sm mt-2">ตั้งแจ้งเตือนจาก Search tab</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Symbol</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Name</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Current</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Target High</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Target Low</th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {alerts.map((alert, idx) => {
                      const asset = allAssets.find(a => a.symbol === alert.symbol);
                      const currentPrice = asset ? parseFloat(asset.price) : 0;
                      return (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 font-bold text-blue-600">{alert.symbol}</td>
                          <td className="px-6 py-4 text-slate-700">{alert.name}</td>
                          <td className="px-6 py-4 text-right text-slate-700">
                            ${formatNumber(currentPrice, 2)}
                          </td>
                          <td className="px-6 py-4 text-right text-emerald-600 font-semibold">
                            {alert.priceHigh ? `$${alert.priceHigh}` : '-'}
                          </td>
                          <td className="px-6 py-4 text-right text-rose-600 font-semibold">
                            {alert.priceLow ? `$${alert.priceLow}` : '-'}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <button
                              onClick={() => removeAlert(idx)}
                              className="text-rose-500 hover:text-rose-700 transition-colors"
                            >
                              <X className="w-5 h-5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Dividends Tab */}
        {activeTab === 'dividends' && (
          <div className="space-y-6">
            
            <div className="bg-white rounded-xl p-6 shadow-md border border-slate-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-800">💰 Dividend Calendar</h2>
                <select
                  value={selectedQuarter}
                  onChange={(e) => setSelectedQuarter(e.target.value)}
                  className="px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                >
                  <option value="all">ทุกไตรมาส</option>
                  <option value="1">Q1 (ม.ค.-มี.ค.)</option>
                  <option value="2">Q2 (เม.ย.-มิ.ย.)</option>
                  <option value="3">Q3 (ก.ค.-ก.ย.)</option>
                  <option value="4">Q4 (ต.ค.-ธ.ค.)</option>
                </select>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
              {filteredDividends.length === 0 ? (
                <div className="p-12 text-center">
                  <Calendar className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-500 text-lg">ไม่มีกำหนดการจ่ายเงินปันผล</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Symbol</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Name</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Frequency</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Ex-Date</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Pay Date</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Per Period</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Annual</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredDividends.map((div, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 font-bold text-blue-600">{div.symbol}</td>
                          <td className="px-6 py-4 text-slate-700">{div.name}</td>
                          <td className="px-6 py-4 text-slate-600">
                            <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-medium">
                              {div.frequency}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right text-slate-700">
                            {div.exDate.toLocaleDateString('th-TH')}
                          </td>
                          <td className="px-6 py-4 text-right text-slate-700">
                            {div.payDate.toLocaleDateString('th-TH')}
                          </td>
                          <td className="px-6 py-4 text-right text-emerald-600 font-semibold">
                            {formatCurrency(div.dividendPerPeriod)}
                          </td>
                          <td className="px-6 py-4 text-right text-emerald-600 font-bold">
                            {formatCurrency(div.annualDividend)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            
          </div>
        )}

      </div>

      {/* Alert Modal */}
      {showAlertModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-slate-800">ตั้งแจ้งเตือนราคา</h3>
              <button
                onClick={() => setShowAlertModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <p className="text-lg font-semibold text-slate-700 mb-2">
                  {selectedAssetForAlert?.symbol} - {selectedAssetForAlert?.name}
                </p>
                <p className="text-sm text-slate-500">
                  ราคาปัจจุบัน: ${selectedAssetForAlert && formatNumber(parseFloat(selectedAssetForAlert.price), 2)}
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  ราคาเป้าหมายสูงสุด ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={alertForm.priceHigh}
                  onChange={(e) => setAlertForm({ ...alertForm, priceHigh: e.target.value })}
                  placeholder="เช่น 150.00"
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  ราคาเป้าหมายต่ำสุด ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={alertForm.priceLow}
                  onChange={(e) => setAlertForm({ ...alertForm, priceLow: e.target.value })}
                  placeholder="เช่น 100.00"
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none"
                />
              </div>
              
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowAlertModal(false)}
                  className="flex-1 px-4 py-3 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-all"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={saveAlert}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-lg hover:from-blue-600 hover:to-indigo-600 transition-all shadow-md"
                >
                  บันทึก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="text-center text-xs text-slate-400 py-8">
        ETF Portfolio Tracker v6.0 — Enhanced Features Edition
      </footer>

    </div>
  );
}
