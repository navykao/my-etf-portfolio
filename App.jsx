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
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl border border-gray-100">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-semibold text-base flex items-center gap-2 text-gray-800"><Settings size={18} className="text-violet-500" /> ตั้งค่า Cache</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={22} /></button>
        </div>
        <div className="space-y-5">
          <div>
            <label className="text-sm font-medium text-gray-600 block mb-2">อายุ Local Cache (วัน)</label>
            <input type="number" min="1" max="30" value={cacheDays} onChange={(e) => setCacheDays(Number(e.target.value))} className="w-full border border-gray-200 rounded-xl px-4 py-3 font-semibold text-base focus:border-violet-400 focus:ring-2 focus:ring-violet-100 outline-none transition-all" />
            <p className="text-xs text-gray-400 mt-1.5">ข้อมูลจะถูกเก็บในเครื่องกี่วัน</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-600 block mb-2">รีเฟรช GitHub ทุก (ชั่วโมง)</label>
            <input type="number" min="0.5" max="24" step="0.5" value={githubCacheHours} onChange={(e) => setGithubCacheHours(Number(e.target.value))} className="w-full border border-gray-200 rounded-xl px-4 py-3 font-semibold text-base focus:border-violet-400 focus:ring-2 focus:ring-violet-100 outline-none transition-all" />
            <p className="text-xs text-gray-400 mt-1.5">ดึงข้อมูลจาก GitHub ใหม่ทุกกี่ชั่วโมง</p>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-500 py-2.5 rounded-xl font-medium hover:bg-gray-50 transition-colors">ยกเลิก</button>
          <button onClick={() => { onSave({ cacheDays, githubCacheHours }); onClose(); }} className="flex-1 bg-violet-500 text-white py-2.5 rounded-xl font-medium hover:bg-violet-600 transition-colors">บันทึก</button>
        </div>
      </div>
    </div>
  );
}

// Cache Stats Panel Component
function CacheStatsPanel({ stats, onRefreshGitHub, onClearAll, onClearLocal, onClose, onOpenSettings }) {
  const hitRate = stats.hits + stats.misses > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(1) : 0;

  return (
    <div className="bg-gray-900 p-6 rounded-2xl text-white shadow-lg border border-gray-800">
      <div className="flex justify-between items-start mb-5">
        <div>
          <h3 className="font-semibold text-base flex items-center gap-2"><Server size={18} className="text-violet-400" /> ระบบ Cache 3 ชั้น</h3>
          <p className="text-gray-500 text-xs mt-1">ประหยัด API quota ได้ 99%</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onOpenSettings} className="text-gray-500 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"><Settings size={16} /></button>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><X size={18} /></button>
        </div>
      </div>
      
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-violet-500/10 rounded-xl p-3 text-center border border-violet-500/20">
          <Smartphone size={16} className="mx-auto text-violet-400 mb-1" />
          <div className="text-lg font-bold text-violet-400">{stats.localCount}</div>
          <div className="text-[10px] text-violet-300/80">Local Cache</div>
          <div className="text-[9px] text-gray-500 mt-0.5">{CacheManager.config.LOCAL_CACHE_DAYS} วัน</div>
        </div>
        <div className="bg-cyan-500/10 rounded-xl p-3 text-center border border-cyan-500/20">
          <Github size={16} className="mx-auto text-cyan-400 mb-1" />
          <div className="text-lg font-bold text-cyan-400">{stats.githubCount}</div>
          <div className="text-[10px] text-cyan-300/80">GitHub DB</div>
          <div className="text-[9px] text-gray-500 mt-0.5">ฟรีไม่จำกัด</div>
        </div>
        <div className={`rounded-xl p-3 text-center border ${stats.apiRemaining > 5 ? 'bg-emerald-500/10 border-emerald-500/20' : stats.apiRemaining > 0 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
          <Zap size={16} className={`mx-auto mb-1 ${stats.apiRemaining > 5 ? 'text-emerald-400' : stats.apiRemaining > 0 ? 'text-amber-400' : 'text-red-400'}`} />
          <div className={`text-lg font-bold ${stats.apiRemaining > 5 ? 'text-emerald-400' : stats.apiRemaining > 0 ? 'text-amber-400' : 'text-red-400'}`}>{stats.apiRemaining}</div>
          <div className={`text-[10px] ${stats.apiRemaining > 5 ? 'text-emerald-300/80' : stats.apiRemaining > 0 ? 'text-amber-300/80' : 'text-red-300/80'}`}>API เหลือ</div>
          <div className="text-[9px] text-gray-500 mt-0.5">รีเซ็ตพรุ่งนี้</div>
        </div>
      </div>

      <div className="bg-white/5 rounded-xl p-4 mb-4 border border-white/5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-gray-400 flex items-center gap-2"><BarChart3 size={14} className="text-violet-400" /> สถิติ Cache วันนี้</span>
          <span className="text-[11px] text-gray-500">Hit Rate: {hitRate}%</span>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div><div className="text-base font-bold text-emerald-400">{stats.hits}</div><div className="text-[10px] text-gray-500">Cache Hits</div></div>
          <div><div className="text-base font-bold text-amber-400">{stats.misses}</div><div className="text-[10px] text-gray-500">Cache Misses</div></div>
          <div><div className="text-base font-bold text-cyan-400">{stats.apiCalls}</div><div className="text-[10px] text-gray-500">API Calls</div></div>
        </div>
        <div className="mt-3 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all duration-500 rounded-full" style={{ width: `${hitRate}%` }} />
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onRefreshGitHub} className="bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 px-3 py-2.5 rounded-xl font-medium text-xs flex items-center justify-center gap-2 transition-colors"><Github size={14} /> รีเฟรช GitHub</button>
        <button onClick={onClearLocal} className="bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 px-3 py-2.5 rounded-xl font-medium text-xs flex items-center justify-center gap-2 transition-colors"><Package size={14} /> ล้าง Local</button>
        <button onClick={onClearAll} className="col-span-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 px-3 py-2.5 rounded-xl font-medium text-xs flex items-center justify-center gap-2 transition-colors"><Trash2 size={14} /> ล้าง Cache ทั้งหมด</button>
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
      // ดึงจาก GitHub JSON เป็นหลักเลย (ฟรี ไม่เสีย API + ข้อมูลใหม่ตลอด)
      const githubData = CacheManager.getStockFromGitHub(sym);
      if (githubData) { CacheManager.recordHit(); setCacheStats(CacheManager.getCacheStats()); return { data: githubData, source: 'github' }; }
      CacheManager.recordMiss();
    }
    if (forceApi || CacheManager.canMakeApiCall()) {
      try {
        CacheManager.logApiCall();
        const data = await fetchFromAPI(sym);
        if (data) { setCacheStats(CacheManager.getCacheStats()); return { data, source: 'api' }; }
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

    // --- Yield/Growth/DivGrowth: ใช้จาก GitHub JSON database (อัพเดทอัตโนมัติทุกวันโดย GitHub Actions) ---
    let divYield = 0, growthRate = 0, divGrowth5Y = 0;
    const githubStock = CacheManager.githubData?.[sym];
    if (githubStock) {
      divYield = githubStock.divYield || 0;
      growthRate = githubStock.growthRate || 0;
      divGrowth5Y = githubStock.divGrowth5Y || 0;
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
    
    const stockData = { price, divYield, growthRate, divGrowth5Y, source: 'api', sourceLabel: `🌐 Live API (${formattedDate})` };
    
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
    // ดึงจาก GitHub JSON ตรงเลยทุกครั้ง — ไม่ใช้ cachedData
    const updated = await Promise.all(baseList.map(async (item) => {
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
          divGrowth5Y: p.data.divGrowth5Y || 0,
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
      case 'local': return <Package size={11} className="text-violet-400" />;
      case 'github': return <Github size={11} className="text-cyan-400" />;
      case 'api': return <Radio size={11} className="text-emerald-400" />;
      default: return <AlertCircle size={11} className="text-gray-300" />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 lg:p-8 text-gray-800">
      <div className="max-w-6xl mx-auto space-y-5">
        <header className="bg-white p-5 md:p-6 rounded-2xl shadow-sm flex flex-col md:flex-row justify-between items-center border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-violet-200"><TrendingUp size={24} /></div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">พอร์ตหุ้น ETF อเมริกา</h1>
              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                <p className="text-gray-400 text-xs flex items-center gap-1.5"><Database size={12} className="text-violet-400" /> 3-Tier Cache</p>
                {syncStatus === 'syncing' && <span className="text-violet-500 text-xs flex items-center gap-1 animate-pulse"><RefreshCw size={11} className="animate-spin" /> กำลังบันทึก...</span>}
                {syncStatus === 'success' && <span className="text-emerald-500 text-xs flex items-center gap-1"><Cloud size={11} /> Cloud Sync</span>}
                {syncStatus === 'success_local' && <span className="text-emerald-500 text-xs flex items-center gap-1"><HardDrive size={11} /> Local Saved</span>}
              </div>
            </div>
          </div>
          <div className="mt-3 md:mt-0 flex items-center gap-2">
            <button onClick={handleForceRefreshAll} disabled={!CacheManager.canMakeApiCall() || isLoading} className="px-3.5 py-2 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-40 flex items-center gap-1.5 transition-all"><Zap size={13} /> Update All</button>
            <button onClick={() => setShowCachePanel(!showCachePanel)} className={`px-3.5 py-2 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-all ${cacheStats.apiRemaining > 10 ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : cacheStats.apiRemaining > 5 ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'}`}>
              <Shield size={13} /> API: {cacheStats.apiRemaining}/{CacheManager.config.DAILY_API_LIMIT} <Activity size={11} className={cacheStats.apiRemaining > 10 ? 'text-emerald-500' : cacheStats.apiRemaining > 5 ? 'text-amber-500' : 'text-red-500'} />
            </button>
          </div>
        </header>

        {showCachePanel && <CacheStatsPanel stats={cacheStats} onRefreshGitHub={handleRefreshGitHub} onClearAll={handleClearAll} onClearLocal={handleClearLocal} onClose={() => setShowCachePanel(false)} onOpenSettings={() => setShowSettings(true)} />}
        <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} onSave={handleSaveSettings} currentSettings={{ cacheDays: CacheManager.config.LOCAL_CACHE_DAYS, githubCacheHours: CacheManager.config.GITHUB_CACHE_HOURS }} />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 space-y-5">
            <section className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-semibold text-sm flex items-center gap-2 text-gray-800"><Wallet size={16} className="text-violet-500" /> หุ้นในพอร์ต</h2>
                <div className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${metrics.totalAlloc === 100 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{metrics.totalAlloc}%</div>
              </div>
              <div className="space-y-3 mb-4">
                {isLoading && portfolio.length === 0 ? <div className="py-10 text-center animate-pulse text-gray-300 text-sm">กำลังดึงข้อมูล...</div> : portfolio.map(stock => (
                  <div key={stock.symbol} className="p-4 rounded-xl border border-gray-100 hover:border-violet-200 hover:shadow-sm transition-all bg-white">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-gray-900 text-base tracking-tight">{stock.symbol}</span>
                          {stock.data?.price > 0 && <span className="text-[10px] bg-gray-50 px-2 py-0.5 rounded-md text-gray-500 font-medium">${stock.data.price.toFixed(2)}</span>}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          {getSourceIcon(stock.data?.source)}
                          <span className={`text-[10px] font-normal ${stock.data?.source === 'local' ? 'text-violet-500' : stock.data?.source === 'github' ? 'text-cyan-500' : stock.data?.source === 'api' ? 'text-emerald-500' : 'text-gray-400'}`}>{stock.data?.sourceLabel || 'Unknown'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => handleForceRefreshSingle(stock.symbol)} disabled={refreshingSymbol === stock.symbol || !CacheManager.canMakeApiCall()} className="text-gray-300 hover:text-violet-500 p-1.5 rounded-lg disabled:opacity-40 transition-colors" title="รีเฟรช"><RefreshCw size={14} className={refreshingSymbol === stock.symbol ? 'animate-spin text-violet-500' : ''} /></button>
                        <button onClick={() => handleRemoveStock(stock.symbol)} className="text-gray-200 hover:text-red-400 p-1.5 rounded-lg transition-colors"><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-gray-50">
                      <div><label className="text-[9px] text-gray-400 block mb-0.5 font-medium">สัดส่วน</label><input type="number" value={stock.allocation} onChange={(e) => { const next = portfolio.map(p => p.symbol === stock.symbol ? {...p, allocation: Number(e.target.value)} : p); setPortfolio(next); saveToCloudOrLocal(next, { initialInvestment, monthlyContribution, contributionStepUp, investmentYears }); }} className="w-full bg-gray-50 rounded-lg border border-gray-100 px-2 py-1 text-xs font-semibold outline-none focus:border-violet-300 focus:bg-white transition-all" /></div>
                      <div className="text-center"><label className="text-[9px] text-gray-400 block mb-0.5 font-medium">Yield</label><div className={`text-xs font-semibold ${(stock.data?.divYield || 0) > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>{(stock.data?.divYield || 0) > 0 ? `${stock.data.divYield.toFixed(2)}%` : 'N/A'}</div></div>
                      <div className="text-center"><label className="text-[9px] text-gray-400 block mb-0.5 font-medium">Growth</label><div className={`text-xs font-semibold ${(stock.data?.growthRate || 0) > 0 ? 'text-cyan-600' : 'text-gray-300'}`}>{(stock.data?.growthRate || 0) > 0 ? `+${stock.data.growthRate.toFixed(2)}%` : 'N/A'}</div></div>
                      <div className="text-right"><label className="text-[9px] text-gray-400 block mb-0.5 font-medium">Div Growth</label><div className={`text-xs font-semibold ${(stock.data?.divGrowth5Y || 0) > 0 ? 'text-violet-600' : (stock.data?.divGrowth5Y || 0) < 0 ? 'text-red-400' : 'text-gray-300'}`}>{(stock.data?.divGrowth5Y || 0) !== 0 ? `${stock.data.divGrowth5Y > 0 ? '+' : ''}${stock.data.divGrowth5Y.toFixed(2)}%` : 'N/A'}</div></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-4 bg-gray-50 rounded-xl">
                <label className="text-xs font-medium text-gray-500 mb-3 block">+ เพิ่มหุ้นใหม่</label>
                <div className="flex items-center gap-2">
                  <input placeholder="หุ้น" value={newSymbol} onChange={(e) => setNewSymbol(e.target.value.toUpperCase())} className="w-[72px] bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold outline-none uppercase focus:border-violet-300 transition-all" />
                  <input type="number" placeholder="%" value={newAllocation} onChange={(e) => setNewAllocation(e.target.value)} className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold outline-none focus:border-violet-300 transition-all" />
                  <button onClick={handleAddStock} disabled={isAdding || !newSymbol.trim()} className="bg-violet-500 text-white px-4 py-2 rounded-lg hover:bg-violet-600 disabled:opacity-40 font-medium text-sm transition-colors">{isAdding ? <RefreshCw size={16} className="animate-spin" /> : "เพิ่ม"}</button>
                </div>
                {errorMsg && <p className="text-[10px] text-red-500 font-medium mt-2">{errorMsg}</p>}
              </div>
            </section>

            <section className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
              <h2 className="font-semibold text-sm flex items-center gap-2 text-gray-800"><Calculator size={16} className="text-violet-500" /> ตั้งค่าการลงทุน</h2>
              <div className="space-y-3">
                <div><label className="text-[11px] font-medium text-gray-400">เงินลงทุนเริ่มต้น (บาท)</label><input type="number" value={initialInvestment} onChange={e => handleUpdateSetting(setInitialInvestment, 'initialInvestment', Number(e.target.value))} className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 font-bold text-base outline-none focus:border-violet-300 focus:bg-white mt-1 transition-all" /></div>
                <div><label className="text-[11px] font-medium text-gray-400">ลงทุนเพิ่มรายเดือน (บาท)</label><input type="number" value={monthlyContribution} onChange={e => handleUpdateSetting(setMonthlyContribution, 'monthlyContribution', Number(e.target.value))} className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 font-bold text-base outline-none focus:border-violet-300 focus:bg-white mt-1 transition-all" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[11px] font-medium text-gray-400">เพิ่มปีละ (%)</label><input type="number" value={contributionStepUp} onChange={e => handleUpdateSetting(setContributionStepUp, 'contributionStepUp', Number(e.target.value))} className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 font-bold text-base outline-none focus:border-violet-300 focus:bg-white mt-1 transition-all" /></div>
                  <div><label className="text-[11px] font-medium text-gray-400">ระยะเวลา (ปี)</label><input type="number" value={investmentYears} onChange={e => handleUpdateSetting(setInvestmentYears, 'investmentYears', Number(e.target.value))} className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 font-bold text-base outline-none focus:border-violet-300 focus:bg-white mt-1 transition-all" /></div>
                </div>
              </div>
            </section>
          </div>

          <div className="lg:col-span-7 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gradient-to-br from-violet-500 to-indigo-600 p-6 rounded-2xl shadow-md shadow-violet-200 text-white">
                <h3 className="text-violet-200 text-xs font-medium mb-1">มูลค่าพอร์ตทบต้น (DRIP)</h3>
                <div className="text-3xl md:text-4xl font-bold mb-3 tracking-tight">{formatCurrency(projections.finalDrip)}</div>
                <span className="bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full text-[10px] font-medium">พลังของดอกเบี้ยทบต้น ✨</span>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
                <h3 className="text-gray-400 text-xs font-medium mb-1">หากไม่ทบต้น</h3>
                <div className="text-3xl md:text-4xl font-bold text-gray-800 mb-2 tracking-tight">{formatCurrency(projections.finalNoDrip)}</div>
                <div className="text-xs text-rose-500 font-medium flex items-center gap-1"><ArrowUpRight size={13} className="rotate-90" /> ส่วนต่าง: {formatCurrency(projections.finalDrip - projections.finalNoDrip)}</div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
              <div className="flex justify-between items-end mb-6">
                <div><h2 className="font-bold text-lg mb-0.5 text-gray-900 tracking-tight">เปรียบเทียบการเติบโต</h2><p className="text-gray-400 text-xs">ผลตอบแทน {investmentYears} ปี</p></div>
                <div className="text-right space-y-1">
                  <div><span className="text-[10px] text-gray-400 font-medium">Yield </span><span className="text-sm font-bold text-emerald-600">{metrics.yield.toFixed(2)}%</span></div>
                  <div><span className="text-[10px] text-gray-400 font-medium">Growth </span><span className="text-sm font-bold text-cyan-600">+{metrics.growth.toFixed(2)}%</span></div>
                </div>
              </div>
              <div className="space-y-5">
                <div><div className="flex justify-between text-sm mb-2 font-semibold"><span className="text-violet-600">Compound (ทบต้น)</span><span className="text-gray-800">{formatCurrency(projections.finalDrip)}</span></div><div className="w-full bg-gray-100 h-9 rounded-lg overflow-hidden"><div className="bg-gradient-to-r from-violet-500 to-indigo-500 h-full rounded-lg flex items-center px-3 text-white font-medium text-xs" style={{ width: '100%' }}>DRIP</div></div></div>
                <div><div className="flex justify-between text-sm mb-2 font-semibold"><span className="text-gray-400">Cash-Out (ไม่ทบต้น)</span><span className="text-gray-500">{formatCurrency(projections.finalNoDrip)}</span></div><div className="w-full bg-gray-100 h-9 rounded-lg overflow-hidden"><div className="bg-gray-300 h-full rounded-lg flex items-center px-3 text-gray-600 font-medium text-xs" style={{ width: `${Math.max(25, (projections.finalNoDrip / projections.finalDrip) * 100)}%` }}>No DRIP</div></div></div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
              <div className="px-6 py-4 bg-gray-50/50 font-semibold text-sm text-gray-700 border-b border-gray-100">ตารางสรุปรายปี</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50/50 text-[11px] text-gray-400 font-medium"><tr><th className="px-6 py-3 text-left">ปีที่</th><th className="px-6 py-3 text-left text-violet-500">ทบต้น</th><th className="px-6 py-3 text-left text-gray-400">ไม่ทบต้น</th><th className="px-6 py-3 text-right text-emerald-500">ส่วนต่าง</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">{projections.history.map((row) => (<tr key={row.year} className="hover:bg-gray-50/50 transition-colors"><td className="px-6 py-3.5 font-semibold text-gray-300">{row.year}</td><td className="px-6 py-3.5 font-semibold text-gray-800">{formatCurrency(row.drip)}</td><td className="px-6 py-3.5 text-gray-400">{formatCurrency(row.totalNoDrip)}</td><td className="px-6 py-3.5 text-emerald-500 font-medium text-right">+{formatCurrency(row.drip - row.totalNoDrip)}</td></tr>))}</tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
