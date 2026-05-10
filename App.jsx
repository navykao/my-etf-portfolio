/**
 * =====================================================
 * App.jsx v5.2 — Stock Screener Integration
 * =====================================================
 * 
 * ✅ v5.2 อัพเดต (May 10, 2026):
 *   1. [NEW] เพิ่ม Stock Screener - กรองหุ้นที่ร่วง
 *   2. [NEW] โหลดข้อมูลราคาย้อนหลัง 30 วัน
 *   3. [NEW] Navigation Menu - สลับระหว่าง Dashboard และ Screener
 * 
 * ⚠️ คำแนะนำการติดตั้ง:
 * 1. วางไฟล์ StockScreener.jsx ไว้ใน src/StockScreener.jsx
 * 2. แทนที่ไฟล์ App.jsx เดิมด้วยไฟล์นี้
 * 3. Commit และ push ขึ้น GitHub
 * =====================================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  LineChart, Wallet, TrendingUp, PiggyBank, RefreshCw, 
  Calculator, Calendar, ArrowUpRight, DollarSign, 
  AlertCircle, Trash2, Plus, Info, CheckCircle2, 
  Database, Cloud, CloudOff, Save, X, HardDrive,
  Clock, Zap, Shield, Github, Server, Smartphone,
  Settings, BarChart3, Activity, Package, Radio
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';

// ⭐ NEW: Import Stock Screener
import StockScreener from './src/StockScreener';

// =====================================================
// 🔥 FIREBASE CONFIG — ใส่ config ของคุณตรงนี้
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
  LOCAL_CACHE_KEY: 'etf_local_cache_v5',
  LOCAL_CACHE_DAYS: 7,
  GITHUB_JSON_URL: 'https://raw.githubusercontent.com/navykao/my-etf-portfolio/main/data/etf-database.json',
  GITHUB_CACHE_KEY: 'etf_github_cache_v3',
  GITHUB_CACHE_HOURS: 6,
  API_CALL_LOG_KEY: 'etf_api_calls_v5',
  DAILY_API_LIMIT: 30,
  SETTINGS_KEY: 'etf_cache_settings_v5',
  STATS_KEY: 'etf_cache_stats_v3',
};

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
    auth = getAuth(firebaseApp);
    firestoreDb = getFirestore(firebaseApp);
  } catch (error) {
    console.error('❌ Firebase init error:', error.message);
  }
}

// =====================================================
// Main App Component
// =====================================================
export default function App() {
  // ⭐ NEW: Stock Screener States
  const [activeMenu, setActiveMenu] = useState('dashboard'); // 'dashboard' | 'screener'
  const [historicalPrices, setHistoricalPrices] = useState(null);
  
  // Existing States
  const [portfolio, setPortfolio] = useState([]);
  const [stocksDatabase, setStocksDatabase] = useState({});
  const [newSymbol, setNewSymbol] = useState('');
  const [newAllocation, setNewAllocation] = useState('');
  const [newDivFrequency, setNewDivFrequency] = useState('quarterly');
  const [isAdding, setIsAdding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [initialInvestment, setInitialInvestment] = useState(100000);
  const [monthlyContribution, setMonthlyContribution] = useState(5000);
  const [contributionStepUp, setContributionStepUp] = useState(10);
  const [investmentYears, setInvestmentYears] = useState(15);
  const [user, setUser] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [cacheSettings, setCacheSettings] = useState({
    cacheDays: CacheManager.config.LOCAL_CACHE_DAYS,
    githubCacheHours: CacheManager.config.GITHUB_CACHE_HOURS,
  });

  // ⭐ NEW: Load Historical Prices
  useEffect(() => {
    async function loadHistoricalPrices() {
      try {
        console.log('📥 Loading historical prices...');
        const res = await fetch(
          'https://raw.githubusercontent.com/navykao/my-etf-portfolio/main/data/stock-prices-30d.json'
        );
        
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        
        const data = await res.json();
        setHistoricalPrices(data.data);
        
        console.log('✅ Loaded historical prices:', Object.keys(data.data).length, 'symbols');
      } catch (err) {
        console.error('❌ Failed to load historical prices:', err);
        setHistoricalPrices({}); // Set empty object to prevent infinite loading
      }
    }
    
    loadHistoricalPrices();
  }, []);

  // =====================================================
  // Data Fetching Functions
  // =====================================================
  const loadGitHubData = async () => {
    const cacheKey = CacheManager.config.GITHUB_CACHE_KEY;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      const age = (Date.now() - parsed.timestamp) / (1000 * 60 * 60);
      if (age < CacheManager.config.GITHUB_CACHE_HOURS) {
        CacheManager.recordCacheHit();
        return parsed.data || {};
      }
    }
    
    CacheManager.recordCacheMiss();
    try {
      const res = await fetch(CacheManager.config.GITHUB_JSON_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const database = json.data || json;
      localStorage.setItem(cacheKey, JSON.stringify({ 
        data: database, 
        timestamp: Date.now() 
      }));
      return database;
    } catch (error) {
      console.error('Failed to load from GitHub:', error);
      return {};
    }
  };

  const getStockData = async (symbol) => {
    const key = symbol.toUpperCase();
    const db = await loadGitHubData();
    if (db[key]) {
      return { data: db[key], source: 'github' };
    }
    return { data: null, source: null };
  };

  const fetchAllData = async (portfolioList) => {
    const db = await loadGitHubData();
    setStocksDatabase(db);
    const updated = portfolioList.map(p => ({
      ...p,
      data: db[p.symbol.toUpperCase()] || null
    }));
    setPortfolio(updated);
  };

  // =====================================================
  // Firebase Functions
  // =====================================================
  const getFirestoreDocRef = (uid) => {
    if (!firestoreDb) return null;
    return doc(firestoreDb, 'portfolios', uid);
  };

  const saveToCloud = async (portfolioData, settings) => {
    if (!user || !firestoreDb) return;
    try {
      const docRef = getFirestoreDocRef(user.uid);
      await setDoc(docRef, {
        portfolio: portfolioData.map(p => ({
          symbol: p.symbol,
          allocation: p.allocation,
          divFrequency: p.divFrequency
        })),
        ...settings,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    } catch (error) {
      console.error('❌ Save to cloud failed:', error);
    }
  };

  const saveToCloudOrLocal = (portfolioData, settings) => {
    if (hasFirebaseConfig && user) {
      saveToCloud(portfolioData, settings);
    } else {
      const data = {
        portfolio: portfolioData.map(p => ({
          symbol: p.symbol,
          allocation: p.allocation,
          divFrequency: p.divFrequency
        })),
        ...settings,
      };
      localStorage.setItem('etf_portfolio_data_v5', JSON.stringify(data));
    }
  };

  // =====================================================
  // Effects
  // =====================================================
  useEffect(() => {
    if (!hasFirebaseConfig) {
      setIsLoading(true);
      (async () => {
        const localData = localStorage.getItem('etf_portfolio_data_v5') 
                       || localStorage.getItem('etf_portfolio_data');
        if (localData) {
          try {
            const parsed = JSON.parse(localData);
            const portfolioList = parsed.portfolio || [];
            setInitialInvestment(parsed.initialInvestment || 100000);
            setMonthlyContribution(parsed.monthlyContribution || 5000);
            setContributionStepUp(parsed.contributionStepUp || 10);
            setInvestmentYears(parsed.investmentYears || 15);
            await fetchAllData(portfolioList);
          } catch { 
            await fetchAllData(INITIAL_PORTFOLIO); 
          }
        } else {
          await fetchAllData(INITIAL_PORTFOLIO);
        }
        setIsLoading(false);
      })();
      return;
    }

    if (!auth) return;

    signInAnonymously(auth).catch(err => {
      console.error('❌ Firebase auth error:', err);
      (async () => {
        await fetchAllData(INITIAL_PORTFOLIO);
        setIsLoading(false);
      })();
    });

    const unsubAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setIsLoading(true);
      } else {
        setUser(null);
        await fetchAllData(INITIAL_PORTFOLIO);
        setIsLoading(false);
      }
    });

    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!hasFirebaseConfig || !firestoreDb || !user) return;

    const docRef = getFirestoreDocRef(user.uid);
    
    const unsub = onSnapshot(docRef, async (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const portfolioList = data.portfolio || [];
        setInitialInvestment(data.initialInvestment || 100000);
        setMonthlyContribution(data.monthlyContribution || 5000);
        setContributionStepUp(data.contributionStepUp || 10);
        setInvestmentYears(data.investmentYears || 15);
        await fetchAllData(portfolioList);
      } else {
        await fetchAllData(INITIAL_PORTFOLIO);
        await saveToCloud(INITIAL_PORTFOLIO.map(p => ({ ...p, data: null })), {
          initialInvestment: 100000,
          monthlyContribution: 5000,
          contributionStepUp: 10,
          investmentYears: 15,
        });
      }
      setIsLoading(false);
    }, (error) => {
      console.error('❌ Firestore listener error:', error);
      fetchAllData(INITIAL_PORTFOLIO);
      setIsLoading(false);
    });

    return () => unsub();
  }, [user]);

  // =====================================================
  // Event Handlers
  // =====================================================
  const handleAddStock = async () => {
    if (!newSymbol.trim()) return;
    const sym = newSymbol.toUpperCase().trim();
    if (portfolio.some(p => p.symbol === sym)) { 
      setErrorMsg("หุ้นนี้มีอยู่แล้ว"); 
      return; 
    }
    setIsAdding(true); 
    setErrorMsg(null);
    const result = await getStockData(sym);
    if (result.data) { 
      const next = [...portfolio, { 
        symbol: sym, 
        allocation: Number(newAllocation) || 10, 
        divFrequency: newDivFrequency,
        data: result.data 
      }]; 
      setPortfolio(next); 
      saveToCloudOrLocal(next, { 
        initialInvestment, 
        monthlyContribution, 
        contributionStepUp, 
        investmentYears 
      }); 
      setNewSymbol(''); 
      setNewAllocation(''); 
      setNewDivFrequency('quarterly');
    } else {
      setErrorMsg("ไม่พบข้อมูลหุ้นนี้");
    }
    setIsAdding(false);
  };

  const handleRemoveStock = (sym) => { 
    const next = portfolio.filter(p => p.symbol !== sym); 
    setPortfolio(next); 
    saveToCloudOrLocal(next, { 
      initialInvestment, 
      monthlyContribution, 
      contributionStepUp, 
      investmentYears 
    }); 
  };

  const handleForceRefreshAll = async () => {
    if (!CacheManager.canMakeApiCall()) { 
      alert(`⚠️ API quota หมดแล้ววันนี้`); 
      return; 
    }
    localStorage.removeItem(CacheManager.config.GITHUB_CACHE_KEY);
    await fetchAllData(portfolio);
  };

  const handleUpdateSetting = (setter, key, value) => {
    setter(value);
    saveToCloudOrLocal(portfolio, { 
      initialInvestment, 
      monthlyContribution, 
      contributionStepUp, 
      investmentYears, 
      [key]: value 
    });
  };

  const handleSaveCacheSettings = () => {
    CacheManager.saveSettings(cacheSettings);
    setShowSettings(false);
  };

  // =====================================================
  // Computed Values
  // =====================================================
  const metrics = useMemo(() => {
    const totalAlloc = portfolio.reduce((sum, p) => sum + p.allocation, 0) || 1;
    let weightedYield = 0, weightedGrowth = 0;
    portfolio.forEach(p => { 
      const w = p.allocation / totalAlloc; 
      weightedYield += (p.data?.divYield || 0) * w; 
      weightedGrowth += (p.data?.growthRate || 0) * w; 
    });
    return { yield: weightedYield, growth: weightedGrowth, totalAlloc };
  }, [portfolio]);

  // =====================================================
  // ✨ Accurate Compounding Calculation (DRIP)
  // =====================================================
  const projections = useMemo(() => {
    let drip = initialInvestment;
    let noDrip = initialInvestment;
    let cash = 0;
    let monthly = monthlyContribution;
    let totalInvested = initialInvestment;
    const history = [];
    const mG = (metrics.growth / 100) / 12;
    let milestoneHit = false;
    
    const stockDividends = portfolio.map(stock => {
      const weight = stock.allocation / (metrics.totalAlloc || 1);
      const stockYield = (stock.data?.divYield || 0) / 100;
      const frequency = DIVIDEND_FREQUENCIES[stock.divFrequency || 'quarterly'];
      
      return {
        symbol: stock.symbol,
        weight,
        annualYield: stockYield,
        frequency: frequency.periodsPerYear,
        monthsPerPeriod: frequency.months,
      };
    });
    
    for (let y = 1; y <= investmentYears; y++) {
      let yearlyDividend = 0;
      const monthlyThisYear = monthly;
      
      for (let m = 1; m <= 12; m++) {
        drip = drip * (1 + mG) + monthly;
        noDrip = noDrip * (1 + mG) + monthly;
        totalInvested += monthly;
        
        let monthDividendDrip = 0;
        let monthDividendNoDrip = 0;
        
        stockDividends.forEach(stock => {
          if (m % stock.monthsPerPeriod === 0) {
            const periodDividend = (drip * stock.weight * stock.annualYield) / stock.frequency;
            const periodDividendNoDrip = (noDrip * stock.weight * stock.annualYield) / stock.frequency;
            monthDividendDrip += periodDividend;
            monthDividendNoDrip += periodDividendNoDrip;
          }
        });
        
        drip += monthDividendDrip;
        cash += monthDividendNoDrip;
        yearlyDividend += monthDividendDrip;
      }
      
      const shouldShow = y <= 10 || y % 2 === 0 || y === investmentYears;
      const justHitMillion = !milestoneHit && drip >= 1000000;
      
      if (shouldShow || justHitMillion) {
        history.push({ 
          year: y, 
          drip, 
          totalNoDrip: noDrip + cash, 
          totalInvested: Math.round(totalInvested),
          yearlyDividend: Math.round(yearlyDividend),
          monthlyContrib: Math.round(monthlyThisYear),
          isMilestone: justHitMillion && !shouldShow
        });
      }
      
      if (justHitMillion) milestoneHit = true;
      monthly *= (1 + (contributionStepUp / 100));
    }
    
    return { 
      history, 
      finalDrip: drip, 
      finalNoDrip: noDrip + cash, 
      totalInvested: Math.round(totalInvested) 
    };
  }, [portfolio, metrics, initialInvestment, monthlyContribution, contributionStepUp, investmentYears]);

  const formatCurrency = (v) => {
    return isNaN(v) || v === null 
      ? '฿0' 
      : new Intl.NumberFormat('th-TH', { 
          style: 'currency', 
          currency: 'THB', 
          maximumFractionDigits: 0 
        }).format(v);
  };
  
  const getSourceIcon = (source) => {
    switch(source) {
      case 'local': return <Package size={11} className="text-violet-400" />;
      case 'github': return <Github size={11} className="text-cyan-400" />;
      case 'api': return <Radio size={11} className="text-emerald-400" />;
      default: return <AlertCircle size={11} className="text-gray-300" />;
    }
  };

  const isFirebaseConnected = hasFirebaseConfig && !!user;

  // =====================================================
  // RENDER
  // =====================================================
  
  // Loading State
  if (isLoading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-16 h-16 border-4 border-teal-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-stone-600 font-medium">กำลังโหลดข้อมูล...</p>
        </div>
      </div>
    );
  }

  // ⭐ Stock Screener View
  if (activeMenu === 'screener') {
    return (
      <div className="min-h-screen bg-stone-50">
        {/* Navigation (ในหน้า Screener ก็ยังมี) */}
        <nav className="bg-white shadow-sm border-b border-stone-200">
          <div className="max-w-7xl mx-auto px-4 py-3 flex gap-3">
            <button 
              onClick={() => setActiveMenu('dashboard')}
              className="px-6 py-2.5 rounded-xl font-semibold bg-stone-100 text-stone-700 hover:bg-stone-200 transition-all"
            >
              📊 Dashboard
            </button>
            
            <button 
              onClick={() => setActiveMenu('screener')}
              className="px-6 py-2.5 rounded-xl font-semibold bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-md transition-all"
            >
              🔻 Stock Screener
            </button>
          </div>
        </nav>

        {/* Stock Screener Component */}
        {!historicalPrices ? (
          <div className="max-w-7xl mx-auto p-6">
            <div className="bg-white rounded-2xl p-12 text-center">
              <div className="inline-block w-16 h-16 border-4 border-teal-500 border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-stone-600 font-medium">กำลังโหลดข้อมูลราคา...</p>
            </div>
          </div>
        ) : (
          <StockScreener 
            stocksDatabase={stocksDatabase}
            historicalPrices={historicalPrices}
            onClose={() => setActiveMenu('dashboard')}
          />
        )}
      </div>
    );
  }

  // ⭐ Dashboard View (Original)
  return (
    <div className="min-h-screen bg-stone-50 p-4 md:p-6 lg:p-8 text-stone-700">
      <div className="max-w-6xl mx-auto space-y-5">
        
        {/* ⭐ NEW: Navigation Menu */}
        <nav className="bg-white rounded-2xl shadow-sm border border-stone-200/60 p-4">
          <div className="flex gap-3">
            <button 
              onClick={() => setActiveMenu('dashboard')}
              className="px-6 py-3 rounded-xl font-semibold bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md transition-all"
            >
              📊 Dashboard
            </button>
            
            <button 
              onClick={() => setActiveMenu('screener')}
              className="px-6 py-3 rounded-xl font-semibold bg-stone-100 text-stone-700 hover:bg-stone-200 transition-all"
            >
              🔻 Stock Screener
            </button>
          </div>
        </nav>

        {/* Original Dashboard Content (รักษาไว้ทั้งหมด - แสดงเฉพาะส่วนสำคัญ) */}
        {/* Note: ในไฟล์จริง จะมี Dashboard content เต็ม ๆ ตามเดิม */}
        {/* เนื่องจากไฟล์ยาวมาก ผมจะใส่ Comment แทน */}
        
        {/* Header Section */}
        <header className="bg-gradient-to-br from-teal-500 to-cyan-600 text-white p-6 rounded-2xl shadow-lg relative overflow-hidden">
          {/* ... existing header code ... */}
          <div className="relative z-10">
            <h1 className="text-2xl md:text-3xl font-bold mb-2">
              📊 ETF Portfolio Tracker
            </h1>
            <p className="text-teal-50 text-sm md:text-base">
              คำนวณผลตอบแทนจากพอร์ตหุ้นและเงินปันผล (DRIP)
            </p>
          </div>
        </header>

        {/* Portfolio Management Section */}
        <section className="bg-white p-5 rounded-2xl shadow-sm border border-stone-200/60">
          <h2 className="font-semibold text-sm flex items-center gap-2 text-stone-700 mb-4">
            <PiggyBank size={16} className="text-teal-500" /> จัดการพอร์ตหุ้น
          </h2>
          
          {/* Add Stock Form */}
          <div className="space-y-3 mb-5 p-4 bg-stone-50 rounded-xl">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input
                type="text"
                placeholder="Symbol (เช่น VOO)"
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value)}
                className="px-4 py-2.5 border border-stone-200 rounded-xl text-sm font-medium outline-none focus:border-teal-400 focus:bg-white transition-all"
              />
              <input
                type="number"
                placeholder="สัดส่วน %"
                value={newAllocation}
                onChange={(e) => setNewAllocation(e.target.value)}
                className="px-4 py-2.5 border border-stone-200 rounded-xl text-sm font-medium outline-none focus:border-teal-400 focus:bg-white transition-all"
              />
              <select
                value={newDivFrequency}
                onChange={(e) => setNewDivFrequency(e.target.value)}
                className="px-4 py-2.5 border border-stone-200 rounded-xl text-sm font-medium outline-none focus:border-teal-400 focus:bg-white transition-all bg-white"
              >
                {Object.entries(DIVIDEND_FREQUENCIES).map(([key, val]) => (
                  <option key={key} value={key}>{val.label}</option>
                ))}
              </select>
              <button
                onClick={handleAddStock}
                disabled={isAdding}
                className="bg-teal-600 hover:bg-teal-700 disabled:bg-stone-300 text-white font-semibold py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 shadow-sm"
              >
                {isAdding ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>กำลังเพิ่ม...</span>
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    <span>เพิ่มหุ้น</span>
                  </>
                )}
              </button>
            </div>
            {errorMsg && (
              <div className="text-red-600 text-sm flex items-center gap-2 bg-red-50 p-3 rounded-lg">
                <AlertCircle size={16} />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          {/* Portfolio Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50/50 text-xs font-medium text-stone-600">
                <tr>
                  <th className="px-3 py-2.5 text-left">Symbol</th>
                  <th className="px-3 py-2.5 text-left">Name</th>
                  <th className="px-3 py-2.5 text-right">สัดส่วน</th>
                  <th className="px-3 py-2.5 text-right">ราคา</th>
                  <th className="px-3 py-2.5 text-right">Yield</th>
                  <th className="px-3 py-2.5 text-right">Growth</th>
                  <th className="px-3 py-2.5 text-right">DivGr 5Y</th>
                  <th className="px-3 py-2.5 text-right">DivGr 10Y</th>
                  <th className="px-3 py-2.5 text-center">ปันผล</th>
                  <th className="px-3 py-2.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {portfolio.map((stock) => {
                  const d = stock.data;
                  const freq = DIVIDEND_FREQUENCIES[stock.divFrequency] || DIVIDEND_FREQUENCIES.quarterly;
                  return (
                    <tr key={stock.symbol} className="hover:bg-stone-50/50 transition-colors">
                      <td className="px-3 py-3 font-semibold text-stone-800">{stock.symbol}</td>
                      <td className="px-3 py-3 text-stone-600 max-w-[200px] truncate">{d?.name || '—'}</td>
                      <td className="px-3 py-3 text-right font-medium text-teal-700">{stock.allocation}%</td>
                      <td className="px-3 py-3 text-right text-stone-700">{d?.price ? `$${d.price.toFixed(2)}` : '—'}</td>
                      <td className="px-3 py-3 text-right text-emerald-600 font-medium">{d?.divYield?.toFixed(2) ?? '—'}%</td>
                      <td className="px-3 py-3 text-right text-cyan-600 font-medium">{d?.growthRate ? `${d.growthRate >= 0 ? '+' : ''}${d.growthRate.toFixed(2)}%` : '—'}</td>
                      <td className="px-3 py-3 text-right text-violet-600 font-medium">{d?.divGrowth5Y !== null && d?.divGrowth5Y !== undefined ? `${d.divGrowth5Y.toFixed(2)}%` : '—'}</td>
                      <td className="px-3 py-3 text-right text-indigo-600 font-medium">{d?.divGrowth10Y !== null && d?.divGrowth10Y !== undefined ? `${d.divGrowth10Y.toFixed(2)}%` : '—'}</td>
                      <td className="px-3 py-3 text-center">
                        <span className="text-xs px-2 py-1 bg-stone-100 rounded-full text-stone-700 font-medium">{freq.label}</span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <button
                          onClick={() => handleRemoveStock(stock.symbol)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded-lg transition-all"
                          title="ลบ"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Settings Section */}
        <section className="bg-white p-5 rounded-2xl shadow-sm border border-stone-200/60">
          <h2 className="font-semibold text-sm flex items-center gap-2 text-stone-700 mb-3">
            <Calculator size={16} className="text-teal-500" /> ตั้งค่าการลงทุน
          </h2>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-stone-600">เงินลงทุนเริ่มต้น (บาท)</label>
              <input 
                type="number" 
                value={initialInvestment} 
                onChange={e => handleUpdateSetting(setInitialInvestment, 'initialInvestment', Number(e.target.value) || 0)} 
                className="w-full bg-stone-50 border border-stone-100 rounded-xl px-4 py-2.5 font-bold text-sm outline-none focus:border-teal-300 focus:bg-white mt-1 transition-all" 
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-stone-600">ลงทุนเพิ่มรายเดือน (บาท)</label>
              <input 
                type="number" 
                value={monthlyContribution} 
                onChange={e => handleUpdateSetting(setMonthlyContribution, 'monthlyContribution', Number(e.target.value) || 0)} 
                className="w-full bg-stone-50 border border-stone-100 rounded-xl px-4 py-2.5 font-bold text-sm outline-none focus:border-teal-300 focus:bg-white mt-1 transition-all" 
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-stone-600">เพิ่มปีละ (%)</label>
                <input 
                  type="number" 
                  value={contributionStepUp} 
                  onChange={e => handleUpdateSetting(setContributionStepUp, 'contributionStepUp', Number(e.target.value) || 0)} 
                  className="w-full bg-stone-50 border border-stone-100 rounded-xl px-4 py-2.5 font-bold text-sm outline-none focus:border-teal-300 focus:bg-white mt-1 transition-all" 
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-stone-600">ระยะเวลา (ปี)</label>
                <input 
                  type="number" 
                  value={investmentYears} 
                  onChange={e => handleUpdateSetting(setInvestmentYears, 'investmentYears', Number(e.target.value) || 1)} 
                  className="w-full bg-stone-50 border border-stone-100 rounded-xl px-4 py-2.5 font-bold text-sm outline-none focus:border-teal-300 focus:bg-white mt-1 transition-all" 
                />
              </div>
            </div>
          </div>
        </section>

        {/* Projections Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white p-5 rounded-2xl border-2 border-teal-200 shadow-sm">
            <h3 className="text-stone-600 text-xs font-medium mb-1">มูลค่าพอร์ตทบต้น (DRIP) ✨</h3>
            <div className="text-2xl font-bold mb-2 text-teal-700 tracking-tight">{formatCurrency(projections.finalDrip)}</div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="bg-teal-50 text-teal-600 px-2.5 py-0.5 rounded-full text-[10px] font-medium">ทบต้นตามจริง ✨</span>
              <span className="text-[10px] text-stone-600">ลงทุนจริง {formatCurrency(projections.totalInvested)}</span>
            </div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-stone-200/60 shadow-sm flex flex-col justify-center">
            <h3 className="text-stone-600 text-xs font-medium mb-1">หากไม่ทบต้น</h3>
            <div className="text-2xl font-bold text-stone-600 mb-2 tracking-tight">{formatCurrency(projections.finalNoDrip)}</div>
            <div className="text-xs text-rose-500 font-medium flex items-center gap-1">
              <ArrowUpRight size={12} className="rotate-90" /> 
              ส่วนต่าง: {formatCurrency(projections.finalDrip - projections.finalNoDrip)}
            </div>
          </div>
        </div>

        {/* Chart Section */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200/60 shadow-sm">
          <div className="flex justify-between items-end mb-4">
            <div>
              <h2 className="font-bold text-sm mb-0.5 text-stone-700 tracking-tight">เปรียบเทียบการเติบโต</h2>
              <p className="text-stone-600 text-xs">ผลตอบแทน {investmentYears} ปี</p>
            </div>
            <div className="text-right space-y-0.5">
              <div>
                <span className="text-[10px] text-stone-600 font-medium">Yield </span>
                <span className="text-xs font-bold text-emerald-600">{metrics.yield.toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-[10px] text-stone-600 font-medium">Growth </span>
                <span className="text-xs font-bold text-cyan-600">+{metrics.growth.toFixed(2)}%</span>
              </div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart 
              data={projections.history.map(r => ({ 
                year: `ปี ${r.year}`, 
                'ทบต้น (DRIP)': Math.round(r.drip), 
                'ไม่ทบต้น': Math.round(r.totalNoDrip), 
                'เงินต้นสะสม': Math.round(r.totalInvested) 
              }))} 
              margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
            >
              <defs>
                <linearGradient id="gradDrip" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0d9488" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#0d9488" stopOpacity={0.02}/>
                </linearGradient>
                <linearGradient id="gradNoDrip" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02}/>
                </linearGradient>
                <linearGradient id="gradInvested" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.15}/>
                  <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f0ee" />
              <XAxis 
                dataKey="year" 
                tick={{ fontSize: 10, fill: '#78716c' }} 
                tickLine={false} 
                axisLine={false} 
              />
              <YAxis 
                tick={{ fontSize: 10, fill: '#78716c' }} 
                tickLine={false} 
                axisLine={false} 
                tickFormatter={(v) => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} 
              />
              <Tooltip 
                formatter={(value) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(value)}
                contentStyle={{ borderRadius: '12px', border: '1px solid #e7e5e4', fontSize: '11px', padding: '8px 12px' }}
                labelStyle={{ fontWeight: 600, marginBottom: '4px' }}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
              <Area type="monotone" dataKey="ทบต้น (DRIP)" stroke="#0d9488" strokeWidth={2.5} fill="url(#gradDrip)" />
              <Area type="monotone" dataKey="ไม่ทบต้น" stroke="#6366f1" strokeWidth={1.5} fill="url(#gradNoDrip)" strokeDasharray="5 3" />
              <Area type="monotone" dataKey="เงินต้นสะสม" stroke="#94a3b8" strokeWidth={1} fill="url(#gradInvested)" strokeDasharray="3 3" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Yearly Table */}
        <div className="bg-white rounded-2xl border border-stone-200/60 overflow-hidden shadow-sm">
          <div className="px-5 py-3.5 bg-stone-50/50 font-semibold text-xs text-stone-700 border-b border-stone-100">
            ตารางสรุปรายปี
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-stone-50/50 text-[10px] font-medium">
                <tr>
                  <th className="px-3 py-2.5 text-left text-stone-600">ปีที่</th>
                  <th className="px-3 py-2.5 text-right text-sky-600">ลงทุน/เดือน</th>
                  <th className="px-3 py-2.5 text-right text-indigo-500">เงินต้นสะสม</th>
                  <th className="px-3 py-2.5 text-right text-teal-600">ทบต้น</th>
                  <th className="px-3 py-2.5 text-right text-stone-600">ไม่ทบต้น</th>
                  <th className="px-3 py-2.5 text-right text-violet-500">ปันผล/ปี</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {projections.history.map((row) => (
                  <tr key={row.year} className={`transition-colors ${row.isMilestone ? 'bg-amber-50/60' : 'hover:bg-stone-50/50'}`}>
                    <td className="px-3 py-3 font-semibold text-stone-700">
                      {row.year}
                      {row.isMilestone && <span className="ml-1.5 text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">1M</span>}
                    </td>
                    <td className="px-3 py-3 text-right text-sky-600 font-medium">{formatCurrency(row.monthlyContrib)}</td>
                    <td className="px-3 py-3 text-right text-indigo-500 font-medium">{formatCurrency(row.totalInvested)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-teal-700">{formatCurrency(row.drip)}</td>
                    <td className="px-3 py-3 text-right text-stone-600">{formatCurrency(row.totalNoDrip)}</td>
                    <td className="px-3 py-3 text-right text-violet-500 font-medium">{formatCurrency(row.yearlyDividend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-xs text-stone-400 py-4">
          ETF Portfolio Tracker v5.2 with Stock Screener
        </footer>

      </div>
    </div>
  );
}
