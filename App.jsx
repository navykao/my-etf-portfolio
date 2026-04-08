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
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- API KEYS ---
const EODHD_API_KEY = '69cec4d00ed1f6.56559517';
const FINNHUB_API_KEY = 'd77k3npr01qp6afltiggd77k3npr01qp6afltih0';

// ==========================================
// Cache Configuration
// ==========================================
const DEFAULT_CACHE_CONFIG = {
  LOCAL_CACHE_KEY: 'etf_local_cache_v4',
  LOCAL_CACHE_DAYS: 7,
  // ⬇️ เปลี่ยนจาก CSV เป็น JSON database (อัพเดทอัตโนมัติโดย GitHub Actions ทุกวัน)
  GITHUB_JSON_URL: 'https://raw.githubusercontent.com/navykao/my-etf-portfolio/main/data/etf-database.json',
  GITHUB_CSV_URL: 'https://raw.githubusercontent.com/navykao/my-etf-portfolio/main/combined-database.csv',
  GITHUB_CACHE_KEY: 'etf_github_cache_v2',
  GITHUB_CACHE_HOURS: 6, // cache GitHub JSON นาน 6 ชม. (เพราะอัพเดทวันละครั้ง)
  API_CALL_LOG_KEY: 'etf_api_calls_v4',
  DAILY_API_LIMIT: 20,
  SETTINGS_KEY: 'etf_cache_settings',
  STATS_KEY: 'etf_cache_stats_v2',
};

// ==========================================
// Cache Manager with Hit/Miss Stats
// ==========================================
const CacheManager = {
  config: { ...DEFAULT_CACHE_CONFIG },
  stats: { hits: 0, misses: 0, apiCalls: 0 },

  loadSettings: () => {
    try {
      const saved = localStorage.getItem(DEFAULT_CACHE_CONFIG.SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        CacheManager.config.LOCAL_CACHE_DAYS = parsed.cacheDays || 7;
        CacheManager.config.GITHUB_CACHE_HOURS = parsed.githubCacheHours || 1;
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
    CacheManager.stats.date = new Date().toDateString();
    localStorage.setItem(DEFAULT_CACHE_CONFIG.STATS_KEY, JSON.stringify(CacheManager.stats));
  },

  recordHit: () => { CacheManager.stats.hits++; CacheManager.saveStats(); },
  recordMiss: () => { CacheManager.stats.misses++; CacheManager.saveStats(); },
  recordApiCall: () => { CacheManager.stats.apiCalls++; CacheManager.saveStats(); },
  getStats: () => ({ ...CacheManager.stats }),

  getLocalCache: () => {
    try {
      const data = localStorage.getItem(CacheManager.config.LOCAL_CACHE_KEY);
      return data ? JSON.parse(data) : {};
    } catch { return {}; }
  },

  setLocalCache: (data) => {
    localStorage.setItem(CacheManager.config.LOCAL_CACHE_KEY, JSON.stringify(data));
  },

  getStockFromLocal: (symbol) => {
    const cache = CacheManager.getLocalCache();
    const stock = cache[symbol.toUpperCase()];
    if (!stock) return null;
    
    const cachedDate = new Date(stock.cachedAt);
    const ageInDays = (Date.now() - cachedDate.getTime()) / (1000 * 60 * 60 * 24);
    if (ageInDays > CacheManager.config.LOCAL_CACHE_DAYS) return null;
    
    const formattedDate = cachedDate.toLocaleDateString('th-TH', { 
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' 
    });
    
    return { 
      ...stock, 
      source: 'local',
      sourceLabel: `📦 Cached (${formattedDate})`,
      ageInDays,
      cachedAt: stock.cachedAt
    };
  },

  saveStockToLocal: (symbol, data, source = 'api') => {
    const cache = CacheManager.getLocalCache();
    cache[symbol.toUpperCase()] = { 
      ...data, 
      cachedAt: new Date().toISOString(),
      originalSource: source
    };
    CacheManager.setLocalCache(cache);
  },

  githubData: null,
  githubLastFetch: null,

  // ⬇️ เปลี่ยนชื่อเป็น loadGitHubData — โหลด JSON database (หลัก) หรือ CSV (สำรอง)
  loadGitHubData: async (forceRefresh = false) => {
    const cached = localStorage.getItem(CacheManager.config.GITHUB_CACHE_KEY);
    const cacheTime = localStorage.getItem(CacheManager.config.GITHUB_CACHE_KEY + '_time');
    const hoursSinceLast = cacheTime ? (Date.now() - parseInt(cacheTime)) / (1000 * 60 * 60) : 999;
    
    if (!forceRefresh && cached && hoursSinceLast < CacheManager.config.GITHUB_CACHE_HOURS) {
      CacheManager.githubData = JSON.parse(cached);
      CacheManager.githubLastFetch = new Date(parseInt(cacheTime));
      return CacheManager.githubData;
    }
    
    // --- Strategy 1: โหลด JSON database (มี Yield + Growth ครบ) ---
    try {
      const response = await fetch(CacheManager.config.GITHUB_JSON_URL + '?t=' + Date.now());
      if (response.ok) {
        const jsonData = await response.json();
        if (jsonData?.data && Object.keys(jsonData.data).length > 0) {
          const data = jsonData.data;
          localStorage.setItem(CacheManager.config.GITHUB_CACHE_KEY, JSON.stringify(data));
          localStorage.setItem(CacheManager.config.GITHUB_CACHE_KEY + '_time', Date.now().toString());
          CacheManager.githubData = data;
          CacheManager.githubLastFetch = jsonData._meta?.lastUpdated ? new Date(jsonData._meta.lastUpdated) : new Date();
          console.log(`✅ Loaded GitHub JSON: ${Object.keys(data).length} ETFs (updated: ${jsonData._meta?.lastUpdated})`);
          return data;
        }
      }
    } catch (error) {
      console.log('⚠️ GitHub JSON failed, falling back to CSV...', error.message);
    }
    
    // --- Strategy 2: Fallback to CSV (สำรอง) ---
    try {
      const response = await fetch(CacheManager.config.GITHUB_CSV_URL + '?t=' + Date.now());
      if (!response.ok) throw new Error('Failed');
      
      const csvText = await response.text();
      const data = CacheManager.parseCSV(csvText);
      
      localStorage.setItem(CacheManager.config.GITHUB_CACHE_KEY, JSON.stringify(data));
      localStorage.setItem(CacheManager.config.GITHUB_CACHE_KEY + '_time', Date.now().toString());
      CacheManager.githubData = data;
      CacheManager.githubLastFetch = new Date();
      return data;
    } catch (error) {
      return CacheManager.githubData || {};
    }
  },

  parseCSV: (csvText) => {
    const lines = csvText.trim().split('\n');
    const map = {};
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
      const cleanValues = values.map(v => v.replace(/^"|"$/g, '').trim());
      const symbol = cleanValues[0];
      if (symbol) {
        map[symbol] = {
          name: cleanValues[1] || symbol,
          type: cleanValues[2] || 'ETF',
          divGrowth5Y: parseFloat(cleanValues[4]?.replace('%', '')) || 0,
          cagr10Y: parseFloat(cleanValues[9]?.replace('%', '')) || 0,
        };
      }
    }
    return map;
  },

  getStockFromGitHub: (symbol) => {
    if (!CacheManager.githubData) return null;
    const stock = CacheManager.githubData[symbol.toUpperCase()];
    if (!stock) return null;
    
    const fetchDate = CacheManager.githubLastFetch || new Date();
    const formattedDate = fetchDate.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
    
    return { 
      price: stock.price || 0, 
      divYield: stock.divYield || 0,
      growthRate: stock.growthRate || 0,
      divGrowth5Y: stock.divGrowth5Y || 0,
      name: stock.name || symbol,
      expenseRatio: stock.expenseRatio || 0,
      source: 'github',
      sourceLabel: `📊 GitHub DB (${formattedDate})`,
      updatedAt: stock.updatedAt || fetchDate.toISOString(),
    };
  },

  logApiCall: () => {
    const today = new Date().toDateString();
    const log = JSON.parse(localStorage.getItem(CacheManager.config.API_CALL_LOG_KEY) || '{}');
    if (log.date !== today) { log.date = today; log.count = 0; }
    log.count++;
    localStorage.setItem(CacheManager.config.API_CALL_LOG_KEY, JSON.stringify(log));
    CacheManager.recordApiCall();
    return log.count;
  },

  getApiCallsToday: () => {
    const today = new Date().toDateString();
    const log = JSON.parse(localStorage.getItem(CacheManager.config.API_CALL_LOG_KEY) || '{}');
    return log.date === today ? (log.count || 0) : 0;
  },

  canMakeApiCall: () => CacheManager.getApiCallsToday() < CacheManager.config.DAILY_API_LIMIT,
  getApiRemaining: () => CacheManager.config.DAILY_API_LIMIT - CacheManager.getApiCallsToday(),

  getCacheStats: () => ({
    localCount: Object.keys(CacheManager.getLocalCache()).length,
    githubCount: Object.keys(CacheManager.githubData || {}).length,
    apiCallsToday: CacheManager.getApiCallsToday(),
    apiRemaining: CacheManager.getApiRemaining(),
    ...CacheManager.getStats()
  }),

  clearLocalCache: () => { localStorage.removeItem(CacheManager.config.LOCAL_CACHE_KEY); },
  clearGitHubCache: () => {
    localStorage.removeItem(CacheManager.config.GITHUB_CACHE_KEY);
    localStorage.removeItem(CacheManager.config.GITHUB_CACHE_KEY + '_time');
    CacheManager.githubData = null;
  },
  clearAll: () => {
    CacheManager.clearLocalCache();
    CacheManager.clearGitHubCache();
    CacheManager.stats = { hits: 0, misses: 0, apiCalls: 0 };
    CacheManager.saveStats();
  }
};

CacheManager.loadSettings();
CacheManager.loadStats();

// --- Firebase Setup ---
let firebaseConfigStr = null;
try { if (typeof __firebase_config !== 'undefined') firebaseConfigStr = __firebase_config; } catch (e) {}
const hasFirebase = firebaseConfigStr && firebaseConfigStr !== '{}' && firebaseConfigStr !== null;
const firebaseConfig = hasFirebase ? JSON.parse(firebaseConfigStr) : null;
let appId = 'default-app-id';
try { if (typeof __app_id !== 'undefined') appId = __app_id; } catch(e) {}

let app = null, auth = null, db = null;
if (hasFirebase) {
  try { app = initializeApp(firebaseConfig); auth = getAuth(app); db = getFirestore(app); } catch (error) {}
}

const INITIAL_PORTFOLIO = [{ symbol: 'VOO', allocation: 100 }];

// Settings Panel Component
function SettingsPanel({ isOpen, onClose, onSave, currentSettings }) {
  const [cacheDays, setCacheDays] = useState(currentSettings.cacheDays);
  const [githubCacheHours, setGithubCacheHours] = useState(currentSettings.githubCacheHours);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-bold text-lg flex items-center gap-2"><Settings size={20} className="text-blue-600" /> ตั้งค่า Cache</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
        </div>
        <div className="space-y-5">
          <div>
            <label className="text-sm font-bold text-slate-600 block mb-2">อายุ Local Cache (วัน)</label>
            <input type="number" min="1" max="30" value={cacheDays} onChange={(e) => setCacheDays(Number(e.target.value))} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 font-bold text-lg focus:border-blue-500 outline-none" />
            <p className="text-xs text-slate-400 mt-1">ข้อมูลจะถูกเก็บในเครื่องกี่วัน</p>
          </div>
          <div>
            <label className="text-sm font-bold text-slate-600 block mb-2">รีเฟรช GitHub CSV ทุก (ชั่วโมง)</label>
            <input type="number" min="0.5" max="24" step="0.5" value={githubCacheHours} onChange={(e) => setGithubCacheHours(Number(e.target.value))} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 font-bold text-lg focus:border-blue-500 outline-none" />
            <p className="text-xs text-slate-400 mt-1">ดึง CSV จาก GitHub ใหม่ทุกกี่ชั่วโมง</p>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 border-2 border-slate-200 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-50">ยกเลิก</button>
          <button onClick={() => { onSave({ cacheDays, githubCacheHours }); onClose(); }} className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700">บันทึก</button>
        </div>
      </div>
    </div>
  );
}

// Cache Stats Panel Component
function CacheStatsPanel({ stats, onRefreshGitHub, onClearAll, onClearLocal, onClose, onOpenSettings }) {
  const hitRate = stats.hits + stats.misses > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(1) : 0;

  return (
    <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-[24px] text-white shadow-lg">
      <div className="flex justify-between items-start mb-5">
        <div>
          <h3 className="font-bold text-lg flex items-center gap-2"><Server size={20} className="text-blue-400" /> ระบบ Cache 3 ชั้น</h3>
          <p className="text-slate-400 text-sm mt-1">ประหยัด API quota ได้ 99%!</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onOpenSettings} className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10"><Settings size={18} /></button>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
        </div>
      </div>
      
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-teal-500/20 rounded-xl p-3 text-center border border-teal-500/30">
          <Smartphone size={18} className="mx-auto text-teal-400 mb-1" />
          <div className="text-xl font-black text-teal-400">{stats.localCount}</div>
          <div className="text-[10px] text-teal-300 font-medium">Local Cache</div>
          <div className="text-[9px] text-slate-400 mt-0.5">{CacheManager.config.LOCAL_CACHE_DAYS} วัน</div>
        </div>
        <div className="bg-blue-500/20 rounded-xl p-3 text-center border border-blue-500/30">
          <Github size={18} className="mx-auto text-blue-400 mb-1" />
          <div className="text-xl font-black text-blue-400">{stats.githubCount}</div>
          <div className="text-[10px] text-blue-300 font-medium">GitHub CSV</div>
          <div className="text-[9px] text-slate-400 mt-0.5">ฟรีไม่จำกัด</div>
        </div>
        <div className={`rounded-xl p-3 text-center border ${stats.apiRemaining > 5 ? 'bg-green-500/20 border-green-500/30' : stats.apiRemaining > 0 ? 'bg-amber-500/20 border-amber-500/30' : 'bg-red-500/20 border-red-500/30'}`}>
          <Zap size={18} className={`mx-auto mb-1 ${stats.apiRemaining > 5 ? 'text-green-400' : stats.apiRemaining > 0 ? 'text-amber-400' : 'text-red-400'}`} />
          <div className={`text-xl font-black ${stats.apiRemaining > 5 ? 'text-green-400' : stats.apiRemaining > 0 ? 'text-amber-400' : 'text-red-400'}`}>{stats.apiRemaining}</div>
          <div className={`text-[10px] font-medium ${stats.apiRemaining > 5 ? 'text-green-300' : stats.apiRemaining > 0 ? 'text-amber-300' : 'text-red-300'}`}>API เหลือ</div>
          <div className="text-[9px] text-slate-400 mt-0.5">รีเซ็ตพรุ่งนี้</div>
        </div>
      </div>

      <div className="bg-white/5 rounded-xl p-4 mb-4 border border-white/10">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-bold text-slate-300 flex items-center gap-2"><BarChart3 size={16} className="text-purple-400" /> สถิติ Cache วันนี้</span>
          <span className="text-xs text-slate-400">Hit Rate: {hitRate}%</span>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div><div className="text-lg font-black text-green-400">{stats.hits}</div><div className="text-[10px] text-slate-400">Cache Hits</div></div>
          <div><div className="text-lg font-black text-amber-400">{stats.misses}</div><div className="text-[10px] text-slate-400">Cache Misses</div></div>
          <div><div className="text-lg font-black text-blue-400">{stats.apiCalls}</div><div className="text-[10px] text-slate-400">API Calls</div></div>
        </div>
        <div className="mt-3 h-2 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-500" style={{ width: `${hitRate}%` }} />
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onRefreshGitHub} className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2"><Github size={14} /> รีเฟรช GitHub</button>
        <button onClick={onClearLocal} className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 px-3 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2"><Package size={14} /> ล้าง Local</button>
        <button onClick={onClearAll} className="col-span-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 px-3 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2"><Trash2 size={14} /> ล้าง Cache ทั้งหมด</button>
      </div>
    </div>
  );
}

// Main App
export default function App() {
  const [user, setUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState('idle');
  const [portfolio, setPortfolio] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [newAllocation, setNewAllocation] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const [cacheStats, setCacheStats] = useState({ localCount: 0, githubCount: 0, apiCallsToday: 0, apiRemaining: 20, hits: 0, misses: 0, apiCalls: 0 });
  const [showCachePanel, setShowCachePanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [refreshingSymbol, setRefreshingSymbol] = useState(null);
  const [initialInvestment, setInitialInvestment] = useState(10000);
  const [monthlyContribution, setMonthlyContribution] = useState(1500);
  const [contributionStepUp, setContributionStepUp] = useState(10);
  const [investmentYears, setInvestmentYears] = useState(15);

  useEffect(() => {
    const init = async () => {
      await CacheManager.loadGitHubData();
      setCacheStats(CacheManager.getCacheStats());
      if (hasFirebase && auth) {
        try { if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) await signInWithCustomToken(auth, __initial_auth_token); else await signInAnonymously(auth); } catch (err) {}
        onAuthStateChanged(auth, setUser);
      } else {
        const localData = localStorage.getItem('etf_portfolio_data');
        if (localData) {
          try { const parsed = JSON.parse(localData); setInitialInvestment(parsed.initialInvestment ?? 10000); setMonthlyContribution(parsed.monthlyContribution ?? 1500); setContributionStepUp(parsed.contributionStepUp ?? 10); setInvestmentYears(parsed.investmentYears ?? 15); await fetchAllData(parsed.portfolio?.length > 0 ? parsed.portfolio : INITIAL_PORTFOLIO); } 
          catch { await fetchAllData(INITIAL_PORTFOLIO); }
        } else await fetchAllData(INITIAL_PORTFOLIO);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (hasFirebase && user && db) {
      const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'portfolio');
      const unsubscribe = onSnapshot(docRef, async (docSnap) => {
        if (docSnap.exists()) { const data = docSnap.data(); setInitialInvestment(data.initialInvestment ?? 10000); setMonthlyContribution(data.monthlyContribution ?? 1500); setContributionStepUp(data.contributionStepUp ?? 10); setInvestmentYears(data.investmentYears ?? 15); if (portfolio.length === 0) await fetchAllData(data.portfolio?.length > 0 ? data.portfolio : INITIAL_PORTFOLIO); } 
        else if (portfolio.length === 0) await fetchAllData(INITIAL_PORTFOLIO);
      });
      return () => unsubscribe();
    }
  }, [user]);

  const getStockData = async (symbol, forceApi = false) => {
    const sym = symbol.toUpperCase().trim();
    if (!forceApi) {
      const localData = CacheManager.getStockFromLocal(sym);
      if (localData) { CacheManager.recordHit(); setCacheStats(CacheManager.getCacheStats()); return { data: localData, source: 'local' }; }
      const githubData = CacheManager.getStockFromGitHub(sym);
      if (githubData) { CacheManager.recordHit(); CacheManager.saveStockToLocal(sym, githubData, 'github'); setCacheStats(CacheManager.getCacheStats()); return { data: githubData, source: 'github' }; }
      CacheManager.recordMiss();
    }
    if (forceApi || CacheManager.canMakeApiCall()) {
      try {
        CacheManager.logApiCall();
        const data = await fetchFromAPI(sym);
        if (data) { CacheManager.saveStockToLocal(sym, data, 'api'); setCacheStats(CacheManager.getCacheStats()); return { data, source: 'api' }; }
      } catch (error) {}
    }
    setCacheStats(CacheManager.getCacheStats());
    return { data: null, source: 'none' };
  };

  const fetchFromAPI = async (symbol) => {
    let price = 0;
    const sym = symbol.toUpperCase();

    // --- ดึงราคา real-time จาก Finnhub (เรียกจาก browser ได้ ไม่ถูก CORS) ---
    try {
      const quoteRes = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_API_KEY}`);
      const quote = await quoteRes.json();
      price = quote.c || 0;
    } catch (e) { console.log('Finnhub failed:', e.message); }

    // --- Fallback: EODHD ---
    if (price === 0) {
      try {
        const eodRes = await fetch(`https://eodhd.com/api/real-time/${sym}.US?api_token=${EODHD_API_KEY}&fmt=json`);
        const eodData = await eodRes.json();
        price = eodData.close || 0;
      } catch (e) {}
    }

    if (price === 0) return null;

    // --- Yield/Growth: ใช้จาก GitHub JSON database (อัพเดทอัตโนมัติทุกวันโดย GitHub Actions) ---
    let divYield = 0, growthRate = 0;
    const githubStock = CacheManager.githubData?.[sym];
    if (githubStock) {
      divYield = githubStock.divYield || 0;
      growthRate = githubStock.growthRate || 0;
    }

    // --- Fallback สำหรับ ETF ยอดนิยม (ถ้า GitHub JSON ยังไม่มีข้อมูล) ---
    const ETF_FALLBACK = {
      'VOO': { divYield: 1.25, growthRate: 10.5 }, 'SPY': { divYield: 1.20, growthRate: 10.5 },
      'SCHD': { divYield: 3.50, growthRate: 8.2 }, 'VTI': { divYield: 1.30, growthRate: 10.0 },
      'QQQ': { divYield: 0.55, growthRate: 15.8 }, 'VYM': { divYield: 2.80, growthRate: 6.5 },
      'JEPI': { divYield: 7.20, growthRate: 3.0 }, 'JEPQ': { divYield: 9.50, growthRate: 5.0 },
      'VIG': { divYield: 1.75, growthRate: 9.0 }, 'DGRO': { divYield: 2.30, growthRate: 8.5 },
      'VGT': { divYield: 0.60, growthRate: 17.0 }, 'BND': { divYield: 3.50, growthRate: 0.5 },
    };
    if (divYield === 0 && ETF_FALLBACK[sym]) divYield = ETF_FALLBACK[sym].divYield;
    if (growthRate === 0 && ETF_FALLBACK[sym]) growthRate = ETF_FALLBACK[sym].growthRate;

    const now = new Date();
    const formattedDate = now.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    
    const stockData = { price, divYield, growthRate, source: 'api', sourceLabel: `🌐 Live API (${formattedDate})` };
    
    // --- Save ลง Firebase ด้วย ---
    if (hasFirebase && user && db) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'stockData', sym), {
          price, divYield, growthRate, updatedAt: now.toISOString(), source: 'api'
        }, { merge: true });
      } catch (e) {}
    }
    
    return stockData;
  };

  const fetchAllData = async (baseList) => {
    setIsLoading(true);
    const updated = await Promise.all(baseList.map(async (item) => {
      // ถ้ามี cachedData จาก Firebase/localStorage ที่ยังใหม่ (< 24 ชม.) ใช้เลย ไม่ต้องเรียก API
      if (item.cachedData && item.cachedData.price > 0) {
        const savedAge = item.cachedData.savedAt ? (Date.now() - new Date(item.cachedData.savedAt).getTime()) / (1000 * 60 * 60) : 999;
        if (savedAge < 24) {
          const cachedDate = new Date(item.cachedData.savedAt);
          const formattedDate = cachedDate.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
          CacheManager.recordHit();
          return { 
            ...item, 
            data: { 
              price: item.cachedData.price, 
              divYield: item.cachedData.divYield, 
              growthRate: item.cachedData.growthRate, 
              source: 'local', 
              sourceLabel: `💾 DB Cache (${formattedDate})` 
            } 
          };
        }
      }
      const result = await getStockData(item.symbol);
      return { ...item, data: result.data };
    }));
    setPortfolio(updated.filter(i => i.data !== null));
    setCacheStats(CacheManager.getCacheStats());
    setIsLoading(false);
  };

  const saveToCloudOrLocal = async (currentPortfolio, settings) => {
    setSyncStatus('syncing');
    const saveData = { 
      portfolio: currentPortfolio.map(p => ({ 
        symbol: p.symbol, 
        allocation: p.allocation,
        // Save stock data ลง DB ด้วยเพื่อลดการเรียก API
        cachedData: p.data ? {
          price: p.data.price || 0,
          divYield: p.data.divYield || 0,
          growthRate: p.data.growthRate || 0,
          savedAt: new Date().toISOString()
        } : null
      })), 
      ...settings, 
      lastSaved: new Date().toISOString() 
    };
    if (hasFirebase && user && db) { try { await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'portfolio'), saveData); setSyncStatus('success'); } catch (err) { setSyncStatus('error'); } } 
    else { localStorage.setItem('etf_portfolio_data', JSON.stringify(saveData)); setSyncStatus('success_local'); }
    setTimeout(() => setSyncStatus('idle'), 2000);
  };

  const handleAddStock = async () => {
    if (!newSymbol.trim()) return;
    const sym = newSymbol.toUpperCase().trim();
    if (portfolio.some(p => p.symbol === sym)) { setErrorMsg("หุ้นนี้มีอยู่แล้ว"); return; }
    setIsAdding(true); setErrorMsg(null);
    const result = await getStockData(sym);
    if (result.data) { const next = [...portfolio, { symbol: sym, allocation: Number(newAllocation) || 10, data: result.data }]; setPortfolio(next); saveToCloudOrLocal(next, { initialInvestment, monthlyContribution, contributionStepUp, investmentYears }); setNewSymbol(''); setNewAllocation(''); } 
    else setErrorMsg("ไม่พบข้อมูลหุ้นนี้");
    setIsAdding(false);
  };

  const handleRemoveStock = (sym) => { const next = portfolio.filter(p => p.symbol !== sym); setPortfolio(next); saveToCloudOrLocal(next, { initialInvestment, monthlyContribution, contributionStepUp, investmentYears }); };

  const handleForceRefreshAll = async () => {
    if (!CacheManager.canMakeApiCall()) { alert(`⚠️ API quota หมดแล้ววันนี้`); return; }
    setIsLoading(true);
    for (const stock of portfolio) {
      if (!CacheManager.canMakeApiCall()) break;
      const result = await getStockData(stock.symbol, true);
      if (result.data) setPortfolio(prev => prev.map(p => p.symbol === stock.symbol ? { ...p, data: result.data } : p));
      await new Promise(r => setTimeout(r, 500));
    }
    setCacheStats(CacheManager.getCacheStats()); setIsLoading(false);
  };

  const handleForceRefreshSingle = async (symbol) => {
    if (!CacheManager.canMakeApiCall()) { alert(`⚠️ API quota หมดแล้ววันนี้`); return; }
    setRefreshingSymbol(symbol);
    const result = await getStockData(symbol, true);
    if (result.data) setPortfolio(prev => prev.map(p => p.symbol === symbol ? { ...p, data: result.data } : p));
    setCacheStats(CacheManager.getCacheStats()); setRefreshingSymbol(null);
  };

  const handleRefreshGitHub = async () => { setIsLoading(true); await CacheManager.loadGitHubData(true); await fetchAllData(portfolio.map(p => ({ symbol: p.symbol, allocation: p.allocation }))); setCacheStats(CacheManager.getCacheStats()); setIsLoading(false); };
  const handleClearAll = () => { if (confirm('ล้าง Cache ทั้งหมด?')) { CacheManager.clearAll(); setCacheStats(CacheManager.getCacheStats()); fetchAllData(portfolio.map(p => ({ symbol: p.symbol, allocation: p.allocation }))); } };
  const handleClearLocal = () => { CacheManager.clearLocalCache(); setCacheStats(CacheManager.getCacheStats()); };
  const handleSaveSettings = (settings) => { CacheManager.saveSettings(settings); setCacheStats(CacheManager.getCacheStats()); };
  const handleUpdateSetting = (setter, key, val) => { setter(val); saveToCloudOrLocal(portfolio, { initialInvestment, monthlyContribution, contributionStepUp, investmentYears, [key]: val }); };

  const metrics = useMemo(() => {
    const totalAlloc = portfolio.reduce((sum, p) => sum + p.allocation, 0) || 1;
    let weightedYield = 0, weightedGrowth = 0;
    portfolio.forEach(p => { const w = p.allocation / totalAlloc; weightedYield += (p.data?.divYield || 0) * w; weightedGrowth += (p.data?.growthRate || 0) * w; });
    return { yield: weightedYield, growth: weightedGrowth, totalAlloc };
  }, [portfolio]);

  const projections = useMemo(() => {
    let drip = initialInvestment, noDrip = initialInvestment, cash = 0, monthly = monthlyContribution;
    const history = []; const mY = (metrics.yield / 100) / 12, mG = (metrics.growth / 100) / 12;
    for (let y = 1; y <= investmentYears; y++) {
      for (let m = 1; m <= 12; m++) { drip = (drip * (1 + mG)) + (drip * mY) + monthly; cash += (noDrip * mY); noDrip = (noDrip * (1 + mG)) + monthly; }
      if (y % 5 === 0 || y === 1 || y === investmentYears) history.push({ year: y, drip, totalNoDrip: noDrip + cash });
      monthly *= (1 + (contributionStepUp / 100));
    }
    return { history, finalDrip: drip, finalNoDrip: noDrip + cash };
  }, [metrics, initialInvestment, monthlyContribution, contributionStepUp, investmentYears]);

  const formatCurrency = (v) => isNaN(v) || v === null ? '฿0' : new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(v);
  const getSourceIcon = (source) => {
    switch(source) {
      case 'local': return <Package size={12} className="text-teal-500" />;
      case 'github': return <Github size={12} className="text-blue-500" />;
      case 'api': return <Radio size={12} className="text-green-500" />;
      default: return <AlertCircle size={12} className="text-slate-400" />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-800 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="bg-white p-6 rounded-[32px] shadow-sm flex flex-col md:flex-row justify-between items-center border border-blue-900">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 bg-blue-900 rounded-2xl flex items-center justify-center text-white shadow-md"><TrendingUp size={32} /></div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 uppercase">พอร์ตหุ้น ETF อเมริกา</h1>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <p className="text-slate-500 text-sm flex items-center gap-2"><Database size={14} className="text-blue-600" /> 3-Tier Cache System</p>
                {syncStatus === 'syncing' && <span className="text-blue-500 text-xs flex items-center gap-1 animate-pulse"><RefreshCw size={12} className="animate-spin" /> กำลังบันทึก...</span>}
                {syncStatus === 'success' && <span className="text-green-600 text-xs flex items-center gap-1"><Cloud size={12} /> Cloud Sync</span>}
                {syncStatus === 'success_local' && <span className="text-emerald-600 text-xs flex items-center gap-1"><HardDrive size={12} /> Local Saved</span>}
              </div>
            </div>
          </div>
          <div className="mt-4 md:mt-0 flex items-center gap-3">
            <button onClick={handleForceRefreshAll} disabled={!CacheManager.canMakeApiCall() || isLoading} className="px-4 py-2 rounded-full text-xs font-bold border bg-white text-blue-700 border-blue-200 hover:bg-blue-50 disabled:opacity-50 flex items-center gap-2"><Zap size={14} /> Force Update All</button>
            <button onClick={() => setShowCachePanel(!showCachePanel)} className={`px-4 py-2.5 rounded-full text-xs font-bold border flex items-center gap-2 shadow-sm ${cacheStats.apiRemaining > 10 ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : cacheStats.apiRemaining > 5 ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'}`}>
              <Shield size={14} /><span>API: {cacheStats.apiRemaining}/{CacheManager.config.DAILY_API_LIMIT}</span><Activity size={12} className={cacheStats.apiRemaining > 10 ? 'text-green-500' : cacheStats.apiRemaining > 5 ? 'text-amber-500' : 'text-red-500'} />
            </button>
          </div>
        </header>

        {showCachePanel && <CacheStatsPanel stats={cacheStats} onRefreshGitHub={handleRefreshGitHub} onClearAll={handleClearAll} onClearLocal={handleClearLocal} onClose={() => setShowCachePanel(false)} onOpenSettings={() => setShowSettings(true)} />}
        <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} onSave={handleSaveSettings} currentSettings={{ cacheDays: CacheManager.config.LOCAL_CACHE_DAYS, githubCacheHours: CacheManager.config.GITHUB_CACHE_HOURS }} />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-6">
            <section className="bg-white p-6 rounded-[32px] shadow-sm border border-blue-900">
              <div className="flex justify-between items-center mb-5">
                <h2 className="font-bold text-lg flex items-center gap-2 text-slate-900"><Wallet size={20} className="text-blue-900" /> หุ้นในพอร์ต</h2>
                <div className={`text-[10px] font-bold px-2 py-1 rounded-md border ${metrics.totalAlloc === 100 ? 'border-green-600 text-green-700' : 'border-amber-500 text-amber-600'}`}>{metrics.totalAlloc}%</div>
              </div>
              <div className="space-y-3 mb-5">
                {isLoading && portfolio.length === 0 ? <div className="py-10 text-center animate-pulse text-slate-400 text-sm">กำลังดึงข้อมูล...</div> : portfolio.map(stock => (
                  <div key={stock.symbol} className="bg-white p-4 rounded-2xl border border-blue-900/20 hover:border-blue-900 shadow-sm transition-all">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-black text-blue-900 text-lg">{stock.symbol}</span>
                          {stock.data?.price > 0 && <span className="text-[10px] bg-white px-2 py-0.5 rounded-full border border-blue-900 text-slate-600 font-bold">${stock.data.price.toFixed(2)}</span>}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          {getSourceIcon(stock.data?.source)}
                          <span className={`text-[10px] font-medium ${stock.data?.source === 'local' ? 'text-teal-600' : stock.data?.source === 'github' ? 'text-blue-600' : stock.data?.source === 'api' ? 'text-green-600' : 'text-slate-400'}`}>{stock.data?.sourceLabel || 'Unknown source'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleForceRefreshSingle(stock.symbol)} disabled={refreshingSymbol === stock.symbol || !CacheManager.canMakeApiCall()} className="text-slate-300 hover:text-blue-600 p-1.5 rounded-lg disabled:opacity-50" title="🔄 รีเฟรชหุ้นนี้"><RefreshCw size={16} className={refreshingSymbol === stock.symbol ? 'animate-spin text-blue-500' : ''} /></button>
                        <button onClick={() => handleRemoveStock(stock.symbol)} className="text-slate-200 hover:text-red-600 p-1.5 rounded-lg"><Trash2 size={18} /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-100">
                      <div><label className="text-[9px] text-slate-500 block mb-0.5 font-bold uppercase">สัดส่วน</label><input type="number" value={stock.allocation} onChange={(e) => { const next = portfolio.map(p => p.symbol === stock.symbol ? {...p, allocation: Number(e.target.value)} : p); setPortfolio(next); saveToCloudOrLocal(next, { initialInvestment, monthlyContribution, contributionStepUp, investmentYears }); }} className="w-full bg-white rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold outline-none focus:border-blue-500" /></div>
                      <div className="text-center"><label className="text-[9px] text-slate-500 block mb-0.5 font-bold uppercase">Yield</label><div className={`text-xs font-bold ${(stock.data?.divYield || 0) > 0 ? 'text-green-700' : 'text-slate-400'}`}>{(stock.data?.divYield || 0) > 0 ? `${stock.data.divYield.toFixed(2)}%` : 'N/A'}</div></div>
                      <div className="text-right"><label className="text-[9px] text-slate-500 block mb-0.5 font-bold uppercase">Growth</label><div className={`text-xs font-bold ${(stock.data?.growthRate || 0) > 0 ? 'text-blue-600' : 'text-slate-400'}`}>{(stock.data?.growthRate || 0) > 0 ? `+${stock.data.growthRate.toFixed(2)}%` : 'N/A'}</div></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-4 bg-white rounded-2xl border border-blue-900/30">
                <label className="text-xs font-bold text-blue-900 mb-3 block">+ เพิ่มหุ้นใหม่</label>
                <div className="flex items-center gap-2">
                  <input placeholder="หุ้น" value={newSymbol} onChange={(e) => setNewSymbol(e.target.value.toUpperCase())} className="w-[75px] bg-white border border-blue-900 rounded-xl px-3 py-2 text-sm font-bold outline-none uppercase" />
                  <input type="number" placeholder="%" value={newAllocation} onChange={(e) => setNewAllocation(e.target.value)} className="flex-1 bg-white border border-blue-900 rounded-xl px-3 py-2 text-sm font-bold outline-none" />
                  <button onClick={handleAddStock} disabled={isAdding || !newSymbol.trim()} className="bg-blue-900 text-white px-5 py-2 rounded-xl hover:bg-blue-800 disabled:opacity-50 font-bold">{isAdding ? <RefreshCw size={18} className="animate-spin" /> : "เพิ่ม"}</button>
                </div>
                {errorMsg && <p className="text-[10px] text-red-600 font-bold mt-2">{errorMsg}</p>}
              </div>
            </section>

            <section className="bg-white p-6 rounded-[32px] shadow-sm border border-blue-900 space-y-4">
              <h2 className="font-bold text-lg flex items-center gap-2 text-slate-900 uppercase"><Calculator size={20} className="text-blue-900" /> ตั้งค่าการลงทุน</h2>
              <div className="space-y-4">
                <div><label className="text-[11px] font-bold text-slate-500 uppercase">เงินลงทุนเริ่มต้น (บาท)</label><input type="number" value={initialInvestment} onChange={e => handleUpdateSetting(setInitialInvestment, 'initialInvestment', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-3 font-black text-lg outline-none focus:border-blue-900 mt-1" /></div>
                <div><label className="text-[11px] font-bold text-slate-500 uppercase">ลงทุนเพิ่มรายเดือน (บาท)</label><input type="number" value={monthlyContribution} onChange={e => handleUpdateSetting(setMonthlyContribution, 'monthlyContribution', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-3 font-black text-lg outline-none focus:border-blue-900 mt-1" /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-[11px] font-bold text-slate-500 uppercase">เพิ่มปีละ (%)</label><input type="number" value={contributionStepUp} onChange={e => handleUpdateSetting(setContributionStepUp, 'contributionStepUp', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-3 font-black text-lg outline-none focus:border-blue-900 mt-1" /></div>
                  <div><label className="text-[11px] font-bold text-slate-500 uppercase">ระยะเวลา (ปี)</label><input type="number" value={investmentYears} onChange={e => handleUpdateSetting(setInvestmentYears, 'investmentYears', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-3 font-black text-lg outline-none focus:border-blue-900 mt-1" /></div>
                </div>
              </div>
            </section>
          </div>

          <div className="lg:col-span-7 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white border-[4px] border-green-800 p-8 rounded-[40px] shadow-sm">
                <h3 className="text-slate-500 text-sm font-bold mb-1 uppercase">มูลค่าพอร์ตทบต้น (DRIP)</h3>
                <div className="text-3xl md:text-4xl font-black mb-4 text-green-900">{formatCurrency(projections.finalDrip)}</div>
                <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-[10px] font-bold border border-green-200">พลังของดอกเบี้ยทบต้น ✨</span>
              </div>
              <div className="bg-white p-8 rounded-[40px] border border-blue-900 shadow-sm flex flex-col justify-center">
                <h3 className="text-slate-500 text-sm font-bold mb-1 uppercase">หากไม่ทบต้น</h3>
                <div className="text-3xl md:text-4xl font-black text-slate-800 mb-3">{formatCurrency(projections.finalNoDrip)}</div>
                <div className="text-xs text-red-600 font-bold flex items-center gap-1 uppercase"><ArrowUpRight size={14} className="rotate-90" /> ส่วนต่าง: {formatCurrency(projections.finalDrip - projections.finalNoDrip)}</div>
              </div>
            </div>

            <div className="bg-white p-8 rounded-[32px] border border-blue-900 shadow-sm">
              <div className="flex justify-between items-end mb-8">
                <div><h2 className="font-black text-2xl mb-1 text-slate-900 uppercase">เปรียบเทียบการเติบโต</h2><p className="text-slate-500 text-sm">ผลตอบแทน {investmentYears} ปี</p></div>
                <div className="text-right"><div className="text-[10px] text-slate-400 uppercase font-black">Yield</div><div className="text-xl font-black text-green-700">{metrics.yield.toFixed(2)}%</div><div className="text-[10px] text-slate-400 uppercase font-black mt-2">Growth</div><div className="text-xl font-black text-blue-600">+{metrics.growth.toFixed(2)}%</div></div>
              </div>
              <div className="space-y-8">
                <div><div className="flex justify-between text-base mb-2 font-black uppercase text-green-800"><span>Compound</span><span>{formatCurrency(projections.finalDrip)}</span></div><div className="w-full bg-slate-50 h-12 rounded-xl p-1 border"><div className="bg-green-700 h-full rounded-lg flex items-center px-4 text-white font-bold text-sm" style={{ width: '100%' }}>ทบต้น</div></div></div>
                <div><div className="flex justify-between text-base mb-2 font-black uppercase text-slate-500"><span>Cash-Out</span><span>{formatCurrency(projections.finalNoDrip)}</span></div><div className="w-full bg-slate-50 h-12 rounded-xl p-1 border"><div className="bg-slate-300 h-full rounded-lg flex items-center px-4 text-slate-700 font-bold text-sm" style={{ width: `${Math.max(25, (projections.finalNoDrip / projections.finalDrip) * 100)}%` }}>ไม่ทบต้น</div></div></div>
              </div>
            </div>

            <div className="bg-white rounded-[32px] border border-blue-900 overflow-hidden shadow-sm">
              <div className="px-8 py-5 bg-slate-50 font-black text-slate-900 uppercase border-b">ตารางสรุปรายปี</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] text-slate-600 font-black uppercase"><tr><th className="px-8 py-3 text-left">ปีที่</th><th className="px-8 py-3 text-left text-green-800">ทบต้น</th><th className="px-8 py-3 text-left text-slate-500">ไม่ทบต้น</th><th className="px-8 py-3 text-right text-emerald-600">ส่วนต่าง</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">{projections.history.map((row) => (<tr key={row.year} className="hover:bg-slate-50"><td className="px-8 py-4 font-black text-slate-400">{row.year}</td><td className="px-8 py-4 font-black text-green-900">{formatCurrency(row.drip)}</td><td className="px-8 py-4 text-slate-500">{formatCurrency(row.totalNoDrip)}</td><td className="px-8 py-4 text-green-600 font-bold text-right">+{formatCurrency(row.drip - row.totalNoDrip)}</td></tr>))}</tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
