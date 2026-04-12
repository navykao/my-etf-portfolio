/**
 * =====================================================
 * App.jsx v5.0 — Firebase Cloud Sync + DivGrowth Fix
 * =====================================================
 * 
 * ✅ v5.0 อัพเดต (Apr 12, 2026):
 *   1. [FIX] แก้บั๊ก loadGitHubData: JSON มี { _meta, data } ต้องดึง .data
 *   2. [FIX] แก้บั๊ก divGrowth5Y: แยก null (ไม่มีข้อมูล) vs 0 (ค่าจริง)
 *   3. [FIX] แก้บั๊ก getStockFromGitHub: เพิ่ม fields ที่ขาด
 *   4. [NEW] Firebase Firestore: เก็บ portfolio บน Cloud (ฟรี Spark Plan)
 *   5. [NEW] ไม่ต้องพึ่ง __firebase_config — hardcode config ตรง
 *   6. [FIX] saveToCloudOrLocal: รักษา null ของ divGrowth5Y
 *   7. [FIX] UI แสดง Div Growth: แยก null vs 0 ถูกต้อง
 * 
 * วิธีติดตั้ง Firebase:
 *   1. ไป https://console.firebase.google.com
 *   2. สร้าง project ใหม่ → เปิด Firestore + Auth (Anonymous)
 *   3. คัดลอก config มาใส่ FIREBASE_CONFIG ด้านล่าง
 *   4. ตั้ง Firestore Rules ตามที่ให้ไว้ใน SETUP-GUIDE.md
 * 
 * เวอร์ชันก่อนหน้า: v4.2 (ไม่มี Firebase, divGrowth ไม่ขึ้น)
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

// =====================================================
// 🔥 FIREBASE CONFIG — ใส่ config ของคุณตรงนี้
// =====================================================
// วิธีได้มา:
// 1. ไป https://console.firebase.google.com
// 2. สร้าง project → Project Settings → General → Your apps → Web app
// 3. คัดลอก firebaseConfig object มาใส่ตรงนี้
// =====================================================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDzl3so9I793U1GGs6aQUs3d0GK-4uyy8k",
  authDomain: "my-etf-portfolio.firebaseapp.com",
  projectId: "my-etf-portfolio",
  storageBucket: "my-etf-portfolio.firebasestorage.app",
  messagingSenderId: "999667791801",
  appId: "1:999667791801:web:6e413d5e34f37982002868"
};

// ตรวจสอบว่า Firebase config ถูกใส่หรือยัง
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

  // =====================================================
  // [FIX v5.0] getStockFromLocal: รักษา null ของ divGrowth5Y
  // =====================================================
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
      price: stock.price || 0, 
      divYield: stock.divYield || 0,
      growthRate: stock.growthRate || 0,
      divGrowth5Y: stock.divGrowth5Y != null ? stock.divGrowth5Y : null, // [FIX] รักษา null
      name: stock.name || symbol,
      expenseRatio: stock.expenseRatio || 0,
      source: 'local',
      sourceLabel: `💾 Local (${formattedDate})`,
      updatedAt: stock.updatedAt || cachedDate.toISOString(),
    };
  },

  saveStockToLocal: (symbol, data) => {
    const cache = CacheManager.getLocalCache();
    cache[symbol.toUpperCase()] = { 
      ...data, 
      cachedAt: new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString()
    };
    CacheManager.setLocalCache(cache);
  },

  githubData: null,
  githubLastFetch: null,

  // =====================================================
  // [FIX v5.0] loadGitHubData: ดึง json.data แทน json ทั้งก้อน
  // เพราะ JSON มีโครงสร้าง { _meta: {...}, data: { VOO: {...}, ... } }
  // =====================================================
  loadGitHubData: async (forceRefresh = false) => {
    const cacheKey = CacheManager.config.GITHUB_CACHE_KEY;
    const cacheTimeKey = cacheKey + '_time';
    
    if (!forceRefresh && CacheManager.githubData) {
      return CacheManager.githubData;
    }

    try {
      const cachedTime = localStorage.getItem(cacheTimeKey);
      const cachedData = localStorage.getItem(cacheKey);
      
      if (!forceRefresh && cachedTime && cachedData) {
        const ageInHours = (Date.now() - parseInt(cachedTime)) / (1000 * 60 * 60);
        if (ageInHours < CacheManager.config.GITHUB_CACHE_HOURS) {
          CacheManager.githubData = JSON.parse(cachedData);
          CacheManager.githubLastFetch = new Date(parseInt(cachedTime));
          return CacheManager.githubData;
        }
      }

      const response = await fetch(CacheManager.config.GITHUB_JSON_URL);
      const json = await response.json();
      
      // ✅ [FIX v5.0] JSON มีโครงสร้าง { _meta: {...}, data: {...} }
      // ต้องใช้ json.data เท่านั้น ไม่ใช่ json ทั้งก้อน
      CacheManager.githubData = json.data || json;
      CacheManager.githubLastFetch = new Date();
      
      // บันทึกเฉพาะ .data ลง localStorage (ไม่รวม _meta)
      localStorage.setItem(cacheKey, JSON.stringify(CacheManager.githubData));
      localStorage.setItem(cacheTimeKey, Date.now().toString());
      
      return CacheManager.githubData;
    } catch (error) {
      console.error('Failed to load GitHub data:', error);
      if (CacheManager.githubData) return CacheManager.githubData;
      return {};
    }
  },

  // =====================================================
  // [FIX v5.0] getStockFromGitHub: รักษา null + เพิ่ม fields ที่ขาด
  // =====================================================
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
      divGrowth5Y: stock.divGrowth5Y != null ? stock.divGrowth5Y : null, // [FIX] รักษา null
      name: stock.name || symbol,
      expenseRatio: stock.expenseRatio || 0,
      trailingDividendRate: stock.trailingDividendRate || 0, // [FIX] เพิ่ม field ที่ขาด
      totalAssets: stock.totalAssets || 0,                   // [FIX] เพิ่ม field ที่ขาด
      fiftyTwoWeekHigh: stock.fiftyTwoWeekHigh || 0,         // [FIX] เพิ่ม field ที่ขาด
      fiftyTwoWeekLow: stock.fiftyTwoWeekLow || 0,           // [FIX] เพิ่ม field ที่ขาด
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

// =====================================================
// 🔥 [NEW v5.0] Firebase Setup — Hardcode Config
// ไม่ต้องพึ่ง __firebase_config จากภายนอกอีกต่อไป
// =====================================================
let firebaseApp = null, firebaseAuth = null, firestoreDb = null;
const FIRESTORE_COLLECTION = 'etf-portfolios'; // collection หลักบน Firestore

if (hasFirebaseConfig) {
  try {
    firebaseApp = initializeApp(FIREBASE_CONFIG);
    firebaseAuth = getAuth(firebaseApp);
    firestoreDb = getFirestore(firebaseApp);
    console.log('🔥 Firebase initialized (v5.0)');
  } catch (error) {
    console.error('❌ Firebase init error:', error);
  }
}

const INITIAL_PORTFOLIO = [{ symbol: 'VOO', allocation: 50, divFrequency: 'quarterly' }];

// =====================================================
// Settings Panel Component
// =====================================================
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

// =====================================================
// Cache Stats Panel Component
// =====================================================
function CacheStatsPanel({ stats, onRefreshGitHub, onClearAll, onClearLocal, onClose, onOpenSettings, isFirebaseConnected }) {
  const hitRate = stats.hits + stats.misses > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(1) : 0;

  return (
    <div className="bg-gray-900 p-6 rounded-2xl text-white shadow-lg border border-gray-800">
      <div className="flex justify-between items-start mb-5">
        <div>
          <h3 className="font-semibold text-base flex items-center gap-2"><Server size={18} className="text-violet-400" /> ระบบ Cache 3 ชั้น</h3>
          <p className="text-gray-500 text-xs mt-1">
            {isFirebaseConnected 
              ? '🔥 Firebase Cloud Sync เปิดอยู่' 
              : '⚠️ Firebase ยังไม่ได้ตั้งค่า — เก็บแค่ในเครื่อง'}
          </p>
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

// =====================================================
// Main App
// =====================================================
export default function App() {
  const [user, setUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState('idle');
  const [portfolio, setPortfolio] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [newAllocation, setNewAllocation] = useState('');
  const [newDivFrequency, setNewDivFrequency] = useState('quarterly');
  const [errorMsg, setErrorMsg] = useState(null);
  const [cacheStats, setCacheStats] = useState({ localCount: 0, githubCount: 0, apiCallsToday: 0, apiRemaining: 30, hits: 0, misses: 0, apiCalls: 0 });
  const [showCachePanel, setShowCachePanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [refreshingSymbol, setRefreshingSymbol] = useState(null);
  const [initialInvestment, setInitialInvestment] = useState(10000);
  const [monthlyContribution, setMonthlyContribution] = useState(1000);
  const [contributionStepUp, setContributionStepUp] = useState(10);
  const [investmentYears, setInvestmentYears] = useState(15);

  // =====================================================
  // 🔥 [NEW v5.0] Firestore document path สำหรับ user
  // =====================================================
  const getFirestoreDocRef = (uid) => {
    return doc(firestoreDb, FIRESTORE_COLLECTION, uid);
  };

  // =====================================================
  // 🔥 [NEW v5.0] บันทึกข้อมูลลง Firestore
  // =====================================================
  const saveToCloud = async (currentPortfolio, settings) => {
    if (!firestoreDb || !user) return false;
    
    try {
      setSyncStatus('syncing');
      const saveData = {
        portfolio: currentPortfolio.map(p => ({
          symbol: p.symbol,
          allocation: p.allocation,
          divFrequency: p.divFrequency || 'quarterly',
        })),
        initialInvestment: settings.initialInvestment || initialInvestment,
        monthlyContribution: settings.monthlyContribution || monthlyContribution,
        contributionStepUp: settings.contributionStepUp || contributionStepUp,
        investmentYears: settings.investmentYears || investmentYears,
        lastSaved: new Date().toISOString(),
        version: '5.0',
      };
      
      await setDoc(getFirestoreDocRef(user.uid), saveData);
      setSyncStatus('success');
      setTimeout(() => setSyncStatus('idle'), 2000);
      return true;
    } catch (err) {
      console.error('❌ Firestore save error:', err);
      setSyncStatus('error');
      setTimeout(() => setSyncStatus('idle'), 3000);
      return false;
    }
  };

  // =====================================================
  // 💾 บันทึกข้อมูล — Cloud first, Local fallback
  // =====================================================
  const saveToCloudOrLocal = async (currentPortfolio, settings) => {
    // พยายามบันทึกลง Cloud ก่อน
    if (hasFirebaseConfig && firestoreDb && user) {
      await saveToCloud(currentPortfolio, settings);
    } else {
      // Fallback: บันทึกลง localStorage
      setSyncStatus('syncing');
      const saveData = {
        portfolio: currentPortfolio.map(p => ({
          symbol: p.symbol,
          allocation: p.allocation,
          divFrequency: p.divFrequency || 'quarterly',
        })),
        ...settings,
        lastSaved: new Date().toISOString(),
      };
      localStorage.setItem('etf_portfolio_data_v5', JSON.stringify(saveData));
      setSyncStatus('success_local');
      setTimeout(() => setSyncStatus('idle'), 2000);
    }
  };

  // =====================================================
  // [FIX v5.0] getStockData: รักษา divGrowth5Y อย่างถูกต้อง
  // =====================================================
  const getStockData = async (symbol, forceRefresh = false) => {
    const sym = symbol.toUpperCase();
    
    // ✅ GITHUB FIRST — โหลดจาก GitHub ก่อนเสมอ
    const githubStock = CacheManager.getStockFromGitHub(sym);
    
    if (githubStock) {
      return { 
        source: 'github', 
        data: {
          price: githubStock.price || 0,
          divYield: githubStock.divYield || 0,
          growthRate: githubStock.growthRate || 0,
          divGrowth5Y: githubStock.divGrowth5Y, // [FIX] ส่งต่อค่าตรงๆ (null = ไม่มีข้อมูล)
          trailingDividendRate: githubStock.trailingDividendRate || 0,
          totalAssets: githubStock.totalAssets || 0,
          fiftyTwoWeekHigh: githubStock.fiftyTwoWeekHigh || 0,
          fiftyTwoWeekLow: githubStock.fiftyTwoWeekLow || 0,
          name: githubStock.name || sym,
          source: 'github',
          sourceLabel: githubStock.sourceLabel || '📊 GitHub Database',
          updatedAt: githubStock.updatedAt || new Date().toISOString(),
        }
      };
    }

    // FALLBACK — ถ้า GitHub ไม่มีข้อมูลหุ้นนี้
    if (!forceRefresh) {
      CacheManager.recordHit();
      const localStock = CacheManager.getStockFromLocal(sym);
      if (localStock) return { source: 'local', data: localStock };
    }

    if (!CacheManager.canMakeApiCall()) {
      return { source: 'none', data: null };
    }

    CacheManager.recordMiss();
    CacheManager.logApiCall();

    // API CALL — Last resort
    let divYield = 0, growthRate = 0;

    const ETF_FALLBACK = {
      'VOO': { divYield: 1.25, growthRate: 10.5 },
      'SPY': { divYield: 1.20, growthRate: 10.5 },
      'SCHD': { divYield: 3.50, growthRate: 8.2 },
      'VTI': { divYield: 1.30, growthRate: 10.0 },
      'QQQ': { divYield: 0.55, growthRate: 15.8 },
      'JEPI': { divYield: 7.20, growthRate: 3.0 },
      'JEPQ': { divYield: 9.50, growthRate: 5.0 },
      'VIG': { divYield: 1.75, growthRate: 9.0 },
      'DGRO': { divYield: 2.30, growthRate: 8.5 },
      'VGT': { divYield: 0.60, growthRate: 17.0 },
      'BND': { divYield: 3.50, growthRate: 0.5 },
    };
    
    if (ETF_FALLBACK[sym]) {
      divYield = ETF_FALLBACK[sym].divYield;
      growthRate = ETF_FALLBACK[sym].growthRate;
    }

    const now = new Date();
    const formattedDate = now.toLocaleDateString('th-TH', { 
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' 
    });
    
    const stockData = { 
      price: 0, 
      divYield, 
      growthRate, 
      divGrowth5Y: null, // [FIX] ไม่มีข้อมูลจริงๆ ให้เป็น null
      name: sym,
      source: 'api', 
      sourceLabel: `🌐 Fallback (${formattedDate})` 
    };

    try {
      CacheManager.saveStockToLocal(sym, {
        ...stockData,
        updatedAt: now.toISOString(),
      });
      return { source: 'api', data: stockData };
    } catch (error) {
      return { source: 'error', data: stockData };
    }
  };

  const fetchAllData = async (baseList) => {
    setIsLoading(true);
    const updated = await Promise.all(baseList.map(async (item) => {
      const result = await getStockData(item.symbol);
      return { ...item, data: result.data };
    }));
    setPortfolio(updated.filter(i => i.data !== null));
    setCacheStats(CacheManager.getCacheStats());
    setIsLoading(false);
  };

  // =====================================================
  // 🔥 [NEW v5.0] Initialize: Firebase Auth + Firestore Listener
  // =====================================================
  useEffect(() => {
    const init = async () => {
      // โหลดข้อมูลหุ้นจาก GitHub ก่อน
      await CacheManager.loadGitHubData();
      setCacheStats(CacheManager.getCacheStats());

      if (hasFirebaseConfig && firebaseAuth) {
        // 🔥 Firebase Mode: Anonymous login → listen Firestore
        try {
          await signInAnonymously(firebaseAuth);
          console.log('🔥 Firebase: Anonymous sign-in successful');
        } catch (err) {
          console.error('❌ Firebase auth error:', err);
          // Fallback to local
          await loadFromLocal();
        }

        onAuthStateChanged(firebaseAuth, (firebaseUser) => {
          setUser(firebaseUser);
          if (!firebaseUser) {
            loadFromLocal();
          }
        });
      } else {
        // ⚠️ No Firebase — ใช้ localStorage
        console.log('⚠️ Firebase not configured — using localStorage');
        await loadFromLocal();
      }
    };

    const loadFromLocal = async () => {
      const localData = localStorage.getItem('etf_portfolio_data_v5') 
                     || localStorage.getItem('etf_portfolio_data'); // backward compat
      if (localData) {
        try {
          const parsed = JSON.parse(localData);
          const portfolioList = parsed.portfolio || [];
          setInitialInvestment(parsed.initialInvestment || 10000);
          setMonthlyContribution(parsed.monthlyContribution || 1000);
          setContributionStepUp(parsed.contributionStepUp || 10);
          setInvestmentYears(parsed.investmentYears || 15);
          await fetchAllData(portfolioList);
        } catch { await fetchAllData(INITIAL_PORTFOLIO); }
      } else {
        await fetchAllData(INITIAL_PORTFOLIO);
      }
      setIsLoading(false);
    };

    init();
  }, []);

  // =====================================================
  // 🔥 [NEW v5.0] Firestore Realtime Listener
  // เมื่อ user login แล้ว → subscribe ข้อมูลจาก Firestore
  // เปิดจากเครื่องไหนก็เห็นข้อมูลเดิม + sync realtime
  // =====================================================
  useEffect(() => {
    if (!hasFirebaseConfig || !firestoreDb || !user) return;

    const docRef = getFirestoreDocRef(user.uid);
    
    const unsub = onSnapshot(docRef, async (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const portfolioList = data.portfolio || [];
        setInitialInvestment(data.initialInvestment || 10000);
        setMonthlyContribution(data.monthlyContribution || 1000);
        setContributionStepUp(data.contributionStepUp || 10);
        setInvestmentYears(data.investmentYears || 15);
        await fetchAllData(portfolioList);
      } else {
        // ผู้ใช้ใหม่ → สร้าง default portfolio
        await fetchAllData(INITIAL_PORTFOLIO);
        // บันทึก default ลง Firestore
        await saveToCloud(INITIAL_PORTFOLIO.map(p => ({ ...p, data: null })), {
          initialInvestment: 10000,
          monthlyContribution: 1000,
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
    if (portfolio.some(p => p.symbol === sym)) { setErrorMsg("หุ้นนี้มีอยู่แล้ว"); return; }
    setIsAdding(true); setErrorMsg(null);
    const result = await getStockData(sym);
    if (result.data) { 
      const next = [...portfolio, { 
        symbol: sym, 
        allocation: Number(newAllocation) || 10, 
        divFrequency: newDivFrequency,
        data: result.data 
      }]; 
      setPortfolio(next); 
      saveToCloudOrLocal(next, { initialInvestment, monthlyContribution, contributionStepUp, investmentYears }); 
      setNewSymbol(''); 
      setNewAllocation(''); 
      setNewDivFrequency('quarterly');
    } 
    else setErrorMsg("ไม่พบข้อมูลหุ้นนี้");
    setIsAdding(false);
  };

  const handleRemoveStock = (sym) => { 
    const next = portfolio.filter(p => p.symbol !== sym); 
    setPortfolio(next); 
    saveToCloudOrLocal(next, { initialInvestment, monthlyContribution, contributionStepUp, investmentYears }); 
  };

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

  const handleRefreshGitHub = async () => { 
    setIsLoading(true); 
    await CacheManager.loadGitHubData(true); 
    await fetchAllData(portfolio.map(p => ({ symbol: p.symbol, allocation: p.allocation, divFrequency: p.divFrequency }))); 
    setCacheStats(CacheManager.getCacheStats()); 
    setIsLoading(false); 
  };

  const handleClearAll = () => { 
    if (confirm('ล้าง Cache ทั้งหมด?')) { 
      CacheManager.clearAll(); 
      setCacheStats(CacheManager.getCacheStats()); 
      fetchAllData(portfolio.map(p => ({ symbol: p.symbol, allocation: p.allocation, divFrequency: p.divFrequency }))); 
    } 
  };

  const handleClearLocal = () => { CacheManager.clearLocalCache(); setCacheStats(CacheManager.getCacheStats()); };
  const handleSaveSettings = (settings) => { CacheManager.saveSettings(settings); setCacheStats(CacheManager.getCacheStats()); };
  
  const handleUpdateSetting = (setter, key, val) => { 
    setter(val); 
    saveToCloudOrLocal(portfolio, { initialInvestment, monthlyContribution, contributionStepUp, investmentYears, [key]: val }); 
  };
  
  const handleUpdateDivFrequency = (symbol, newFreq) => {
    const next = portfolio.map(p => p.symbol === symbol ? { ...p, divFrequency: newFreq } : p);
    setPortfolio(next);
    saveToCloudOrLocal(next, { initialInvestment, monthlyContribution, contributionStepUp, investmentYears });
  };

  // =====================================================
  // Computed Values
  // =====================================================
  const metrics = useMemo(() => {
    const totalAlloc = portfolio.reduce((sum, p) => sum + p.allocation, 0) || 1;
    let weightedYield = 0, weightedGrowth = 0;
    portfolio.forEach(p => { const w = p.allocation / totalAlloc; weightedYield += (p.data?.divYield || 0) * w; weightedGrowth += (p.data?.growthRate || 0) * w; });
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
          year: y, drip, totalNoDrip: noDrip + cash, 
          totalInvested: Math.round(totalInvested),
          yearlyDividend: Math.round(yearlyDividend),
          monthlyContrib: Math.round(monthlyThisYear),
          isMilestone: justHitMillion && !shouldShow
        });
      }
      
      if (justHitMillion) milestoneHit = true;
      monthly *= (1 + (contributionStepUp / 100));
    }
    
    return { history, finalDrip: drip, finalNoDrip: noDrip + cash, totalInvested: Math.round(totalInvested) };
  }, [portfolio, metrics, initialInvestment, monthlyContribution, contributionStepUp, investmentYears]);

  const formatCurrency = (v) => isNaN(v) || v === null ? '฿0' : new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(v);
  
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
  return (
    <div className="min-h-screen bg-stone-50 p-4 md:p-6 lg:p-8 text-stone-700">
      <div className="max-w-6xl mx-auto space-y-5">
        <header className="bg-white p-5 rounded-2xl shadow-sm flex flex-col md:flex-row justify-between items-center border border-stone-200/60">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 bg-teal-600 rounded-xl flex items-center justify-center text-white"><TrendingUp size={22} /></div>
            <div>
              <h1 className="text-lg font-bold text-stone-800 tracking-tight">พอร์ตหุ้น ETF อเมริกา</h1>
              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                <p className="text-stone-600 text-xs flex items-center gap-1.5">
                  <Database size={12} className="text-teal-500" /> v5.0 Cloud Sync + DRIP
                </p>
                {/* 🔥 [NEW v5.0] แสดงสถานะ sync */}
                {syncStatus === 'syncing' && <span className="text-teal-500 text-xs flex items-center gap-1 animate-pulse"><RefreshCw size={11} className="animate-spin" /> กำลังบันทึก...</span>}
                {syncStatus === 'success' && <span className="text-emerald-500 text-xs flex items-center gap-1"><Cloud size={11} /> 🔥 Cloud Synced</span>}
                {syncStatus === 'success_local' && <span className="text-amber-500 text-xs flex items-center gap-1"><HardDrive size={11} /> Local Saved</span>}
                {syncStatus === 'error' && <span className="text-red-500 text-xs flex items-center gap-1"><CloudOff size={11} /> Sync Error</span>}
              </div>
            </div>
          </div>
          <div className="mt-3 md:mt-0 flex items-center gap-2">
            {/* 🔥 [NEW v5.0] แสดงสถานะ Firebase */}
            {isFirebaseConnected && (
              <span className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-orange-50 text-orange-600 border border-orange-200">
                🔥 Firebase
              </span>
            )}
            <button onClick={handleForceRefreshAll} disabled={!CacheManager.canMakeApiCall() || isLoading} className="px-3.5 py-2 rounded-lg text-xs font-medium border border-stone-200 bg-white text-stone-500 hover:bg-stone-50 hover:border-stone-300 disabled:opacity-40 flex items-center gap-1.5 transition-all"><Zap size={13} /> Update All</button>
            <button onClick={() => setShowCachePanel(!showCachePanel)} className={`px-3.5 py-2 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-all ${cacheStats.apiRemaining > 10 ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' : cacheStats.apiRemaining > 5 ? 'bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100' : 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'}`}>
              <Shield size={13} /> API: {cacheStats.apiRemaining}/{CacheManager.config.DAILY_API_LIMIT} <Activity size={11} className={cacheStats.apiRemaining > 10 ? 'text-emerald-500' : cacheStats.apiRemaining > 5 ? 'text-amber-500' : 'text-red-500'} />
            </button>
          </div>
        </header>

        {showCachePanel && <CacheStatsPanel stats={cacheStats} onRefreshGitHub={handleRefreshGitHub} onClearAll={handleClearAll} onClearLocal={handleClearLocal} onClose={() => setShowCachePanel(false)} onOpenSettings={() => setShowSettings(true)} isFirebaseConnected={isFirebaseConnected} />}
        <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} onSave={handleSaveSettings} currentSettings={{ cacheDays: CacheManager.config.LOCAL_CACHE_DAYS, githubCacheHours: CacheManager.config.GITHUB_CACHE_HOURS }} />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 space-y-5">
            <section className="bg-white p-5 rounded-2xl shadow-sm border border-stone-200/60">
              <h2 className="font-semibold text-sm flex items-center gap-2 text-stone-700 mb-4"><Wallet size={16} className="text-teal-500" /> พอร์ตของคุณ</h2>
              <div className="space-y-3">
                {portfolio.map((stock) => (
                  <div key={stock.symbol} className="bg-stone-50/50 rounded-xl p-3 border border-stone-100 hover:border-teal-200 transition-all">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-bold text-sm text-stone-800">{stock.symbol}</h3>
                          {stock.data?.source && <div className="flex items-center gap-0.5">{getSourceIcon(stock.data.source)}<span className="text-[9px] text-stone-500">{stock.data.sourceLabel}</span></div>}
                        </div>
                        <p className="text-[10px] text-stone-500 leading-tight">{stock.data?.name || 'Loading...'}</p>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => handleForceRefreshSingle(stock.symbol)} disabled={refreshingSymbol === stock.symbol || !CacheManager.canMakeApiCall()} className="text-stone-500 hover:text-teal-500 p-1.5 rounded-lg disabled:opacity-40 transition-colors" title="รีเฟรช"><RefreshCw size={14} className={refreshingSymbol === stock.symbol ? 'animate-spin text-teal-500' : ''} /></button>
                        <button onClick={() => handleRemoveStock(stock.symbol)} className="text-stone-200 hover:text-red-400 p-1.5 rounded-lg transition-colors"><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-5 gap-2 mt-3 pt-3 border-t border-stone-50">
                      <div><label className="text-[9px] text-stone-600 block mb-0.5 font-medium">สัดส่วน</label><input type="number" value={stock.allocation} onChange={(e) => { const next = portfolio.map(p => p.symbol === stock.symbol ? {...p, allocation: Number(e.target.value)} : p); setPortfolio(next); saveToCloudOrLocal(next, { initialInvestment, monthlyContribution, contributionStepUp, investmentYears }); }} className="w-full bg-stone-50 rounded-lg border border-stone-100 px-2 py-1 text-xs font-semibold outline-none focus:border-teal-300 focus:bg-white transition-all" /></div>
                      <div className="text-center"><label className="text-[9px] text-stone-600 block mb-0.5 font-medium">Yield</label><div className={`text-xs font-semibold ${(stock.data?.divYield || 0) > 0 ? 'text-emerald-600' : 'text-stone-500'}`}>{(stock.data?.divYield || 0) > 0 ? `${stock.data.divYield.toFixed(2)}%` : 'N/A'}</div></div>
                      <div className="text-center"><label className="text-[9px] text-stone-600 block mb-0.5 font-medium">Growth</label><div className={`text-xs font-semibold ${(stock.data?.growthRate || 0) > 0 ? 'text-cyan-600' : (stock.data?.growthRate || 0) < 0 ? 'text-red-400' : 'text-stone-500'}`}>{(stock.data?.growthRate || 0) !== 0 ? `${stock.data.growthRate > 0 ? '+' : ''}${stock.data.growthRate.toFixed(2)}%` : 'N/A'}</div></div>
                      {/* [FIX v5.0] Div Growth: แยก null (N/A) vs 0 (0.00%) */}
                      <div className="text-right"><label className="text-[9px] text-stone-600 block mb-0.5 font-medium">Div Growth</label><div className={`text-xs font-semibold ${stock.data?.divGrowth5Y != null ? (stock.data.divGrowth5Y > 0 ? 'text-violet-500' : stock.data.divGrowth5Y < 0 ? 'text-red-400' : 'text-stone-500') : 'text-stone-500'}`}>{stock.data?.divGrowth5Y != null ? `${stock.data.divGrowth5Y > 0 ? '+' : ''}${stock.data.divGrowth5Y.toFixed(2)}%` : 'N/A'}</div></div>
                      <div className="col-span-5 mt-1">
                        <label className="text-[9px] text-stone-600 block mb-0.5 font-medium">ความถี่ปันผล</label>
                        <select 
                          value={stock.divFrequency || 'quarterly'} 
                          onChange={(e) => handleUpdateDivFrequency(stock.symbol, e.target.value)}
                          className="w-full bg-white rounded-lg border border-stone-200 px-2 py-1.5 text-xs font-medium outline-none focus:border-teal-300 transition-all"
                        >
                          {Object.entries(DIVIDEND_FREQUENCIES).map(([key, freq]) => (
                            <option key={key} value={key}>{freq.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-3 bg-teal-50/50 rounded-xl border border-teal-100">
                <div className="flex items-center gap-2 mb-2"><Plus size={14} className="text-teal-600" /><span className="text-xs font-medium text-teal-700">เพิ่มหุ้นใหม่</span></div>
                <div className="flex gap-2">
                  <input type="text" placeholder="หุ้น" value={newSymbol} onChange={e => setNewSymbol(e.target.value)} className="flex-1 border border-teal-200 rounded-lg px-3 py-2 text-xs bg-white font-medium outline-none focus:border-teal-400 transition-all" />
                  <input type="text" placeholder="%" value={newAllocation} onChange={e => setNewAllocation(e.target.value)} className="w-16 border border-teal-200 rounded-lg px-3 py-2 text-xs bg-white font-medium text-center outline-none focus:border-teal-400 transition-all" />
                  <select value={newDivFrequency} onChange={e => setNewDivFrequency(e.target.value)} className="border border-teal-200 rounded-lg px-2 py-2 text-xs bg-white outline-none focus:border-teal-400 transition-all">
                    {Object.entries(DIVIDEND_FREQUENCIES).map(([key, freq]) => (
                      <option key={key} value={key}>{freq.label}</option>
                    ))}
                  </select>
                  <button onClick={handleAddStock} disabled={isAdding} className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 transition-all">
                    {isAdding ? '...' : 'เพิ่ม'}
                  </button>
                </div>
                {errorMsg && <p className="text-red-500 text-xs mt-2 flex items-center gap-1"><AlertCircle size={12} /> {errorMsg}</p>}
              </div>
            </section>

            <section className="bg-white p-5 rounded-2xl shadow-sm border border-stone-200/60">
              <h2 className="font-semibold text-sm flex items-center gap-2 text-stone-700 mb-3"><Calculator size={16} className="text-teal-500" /> ตั้งค่าการลงทุน</h2>
              <div className="space-y-3">
                <div><label className="text-[11px] font-medium text-stone-600">เงินลงทุนเริ่มต้น (บาท)</label><input type="number" value={initialInvestment} onChange={e => handleUpdateSetting(setInitialInvestment, 'initialInvestment', Number(e.target.value))} className="w-full bg-stone-50 border border-stone-100 rounded-xl px-4 py-2.5 font-bold text-sm outline-none focus:border-teal-300 focus:bg-white mt-1 transition-all" /></div>
                <div><label className="text-[11px] font-medium text-stone-600">ลงทุนเพิ่มรายเดือน (บาท)</label><input type="number" value={monthlyContribution} onChange={e => handleUpdateSetting(setMonthlyContribution, 'monthlyContribution', Number(e.target.value))} className="w-full bg-stone-50 border border-stone-100 rounded-xl px-4 py-2.5 font-bold text-sm outline-none focus:border-teal-300 focus:bg-white mt-1 transition-all" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[11px] font-medium text-stone-600">เพิ่มปีละ (%)</label><input type="number" value={contributionStepUp} onChange={e => handleUpdateSetting(setContributionStepUp, 'contributionStepUp', Number(e.target.value))} className="w-full bg-stone-50 border border-stone-100 rounded-xl px-4 py-2.5 font-bold text-sm outline-none focus:border-teal-300 focus:bg-white mt-1 transition-all" /></div>
                  <div><label className="text-[11px] font-medium text-stone-600">ระยะเวลา (ปี)</label><input type="number" value={investmentYears} onChange={e => handleUpdateSetting(setInvestmentYears, 'investmentYears', Number(e.target.value))} className="w-full bg-stone-50 border border-stone-100 rounded-xl px-4 py-2.5 font-bold text-sm outline-none focus:border-teal-300 focus:bg-white mt-1 transition-all" /></div>
                </div>
              </div>
            </section>
          </div>

          <div className="lg:col-span-7 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white p-5 rounded-2xl border-2 border-teal-200 shadow-sm">
                <h3 className="text-stone-600 text-xs font-medium mb-1">มูลค่าพอร์ตทบต้น (DRIP) ✨ Accurate</h3>
                <div className="text-2xl font-bold mb-2 text-teal-700 tracking-tight">{formatCurrency(projections.finalDrip)}</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="bg-teal-50 text-teal-600 px-2.5 py-0.5 rounded-full text-[10px] font-medium">ทบต้นตามจริง ✨</span>
                  <span className="text-[10px] text-stone-600">ลงทุนจริง {formatCurrency(projections.totalInvested)}</span>
                </div>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-stone-200/60 shadow-sm flex flex-col justify-center">
                <h3 className="text-stone-600 text-xs font-medium mb-1">หากไม่ทบต้น</h3>
                <div className="text-2xl font-bold text-stone-600 mb-2 tracking-tight">{formatCurrency(projections.finalNoDrip)}</div>
                <div className="text-xs text-rose-500 font-medium flex items-center gap-1"><ArrowUpRight size={12} className="rotate-90" /> ส่วนต่าง: {formatCurrency(projections.finalDrip - projections.finalNoDrip)}</div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-stone-200/60 shadow-sm">
              <div className="flex justify-between items-end mb-5">
                <div><h2 className="font-bold text-sm mb-0.5 text-stone-700 tracking-tight">เปรียบเทียบการเติบโต</h2><p className="text-stone-600 text-xs">ผลตอบแทน {investmentYears} ปี (คำนวณแบบแม่นยำ)</p></div>
                <div className="text-right space-y-0.5">
                  <div><span className="text-[10px] text-stone-600 font-medium">Yield </span><span className="text-xs font-bold text-emerald-600">{metrics.yield.toFixed(2)}%</span></div>
                  <div><span className="text-[10px] text-stone-600 font-medium">Growth </span><span className="text-xs font-bold text-cyan-600">+{metrics.growth.toFixed(2)}%</span></div>
                </div>
              </div>
              <div className="space-y-4">
                <div><div className="flex justify-between text-xs mb-1.5 font-semibold"><span className="text-indigo-600">Compound (ทบต้นตามความถี่จริง)</span><span className="text-stone-700">{formatCurrency(projections.finalDrip)}</span></div><div className="w-full bg-stone-100 h-7 rounded-lg overflow-hidden"><div className="bg-blue-50 border-2 border-blue-600 h-full rounded-lg flex items-center px-3 text-blue font-medium text-[10px]" style={{ width: '100%' }}>Accurate DRIP ✨</div></div></div>
                <div><div className="flex justify-between text-xs mb-1.5 font-semibold"><span className="text-indigo-400">Cash-Out (ไม่ทบต้น)</span><span className="text-stone-600">{formatCurrency(projections.finalNoDrip)}</span></div><div className="w-full bg-stone-100 h-7 rounded-lg overflow-hidden"><div className="bg-indigo-200 h-full rounded-lg flex items-center px-3 text-indigo-700 font-medium text-[10px]" style={{ width: `${Math.max(25, (projections.finalNoDrip / projections.finalDrip) * 100)}%` }}>No DRIP</div></div></div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-stone-200/60 overflow-hidden shadow-sm">
              <div className="px-5 py-3.5 bg-stone-50/50 font-semibold text-xs text-stone-700 border-b border-stone-100">ตารางสรุปรายปี (การทบต้นแบบแม่นยำ)</div>
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
                  <tbody className="divide-y divide-stone-50">{projections.history.map((row) => (
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
                  ))}</tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
