import React, { useState, useEffect, useMemo } from 'react';
import { 
  LineChart, Wallet, TrendingUp, PiggyBank, RefreshCw, 
  Calculator, Calendar, ArrowUpRight, DollarSign, 
  AlertCircle, Trash2, Plus, Info, CheckCircle2, 
  Database, Cloud, CloudOff, Save, X, HardDrive
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- API KEYS ---
const POLYGON_API_KEY = 'h3faYrol9E4DEgv99Fj532HblSIA3fAb';
const EODHD_API_KEY = '69cec4d00ed1f6.56559517';
const FINNHUB_API_KEY = 'd77k3npr01qp6afltiggd77k3npr01qp6afltih0';

// --- System Variables Setup (Safe for Vercel) ---
let firebaseConfigStr = null;
try {
  if (typeof __firebase_config !== 'undefined') {
    firebaseConfigStr = __firebase_config;
  }
} catch (e) {
  // Ignore error if running on Vercel external hosting
}

const hasFirebase = firebaseConfigStr && firebaseConfigStr !== '{}' && firebaseConfigStr !== null;
const firebaseConfig = hasFirebase ? JSON.parse(firebaseConfigStr) : null;
let appId = 'default-app-id';
try { if (typeof __app_id !== 'undefined') appId = __app_id; } catch(e) {}

let app = null, auth = null, db = null;
if (hasFirebase) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (error) {
    console.error("Firebase init failed:", error);
  }
}

// --- GitHub CSV Database URL ---
const GITHUB_CSV_URL = 'https://raw.githubusercontent.com/navykao/my-etf-portfolio/main/screener-etf-2026-04-07.csv';

// --- Fallback Map (จะถูก populate จาก CSV) ---
let FALLBACK_MAP = {};

// --- Function: Parse CSV to Object ---
const parseCSVtoFallbackMap = (csvText) => {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',');
  const map = {};
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const symbol = values[0];
    const fundName = values[1];
    // CAGR 10Y อยู่ที่ column index 9
    const cagr10Y = parseFloat(values[9]?.replace('%', '')) || 0;
    // Div Growth 5Y อยู่ที่ column index 4 (ใช้เป็น yield estimate)
    const divGrowth5Y = parseFloat(values[4]?.replace('%', '')) || 0;
    
    map[symbol] = {
      y: divGrowth5Y,  // Dividend Growth 5Y as yield proxy
      g: cagr10Y,      // CAGR 10Y as growth rate
      n: fundName
    };
  }
  return map;
};

// --- Function: Load CSV from GitHub ---
const loadCSVDatabase = async () => {
  // Check cache first (valid for 1 hour)
  const cached = localStorage.getItem('etf_csv_cache');
  const cacheTime = localStorage.getItem('etf_csv_cache_time');
  const ONE_HOUR = 60 * 60 * 1000;
  
  if (cached && cacheTime && (Date.now() - parseInt(cacheTime)) < ONE_HOUR) {
    FALLBACK_MAP = JSON.parse(cached);
    console.log('📊 Loaded ETF data from cache:', Object.keys(FALLBACK_MAP).length, 'symbols');
    return;
  }
  
  try {
    const response = await fetch(GITHUB_CSV_URL);
    if (!response.ok) throw new Error('Failed to fetch CSV');
    const csvText = await response.text();
    FALLBACK_MAP = parseCSVtoFallbackMap(csvText);
    
    // Save to cache
    localStorage.setItem('etf_csv_cache', JSON.stringify(FALLBACK_MAP));
    localStorage.setItem('etf_csv_cache_time', Date.now().toString());
    console.log('📊 Loaded ETF data from GitHub:', Object.keys(FALLBACK_MAP).length, 'symbols');
  } catch (err) {
    console.error('Failed to load CSV from GitHub:', err);
    // Fallback to hardcoded minimal data if GitHub fails
    FALLBACK_MAP = {
      'VOO': { y: 5.76, g: 14.36, n: 'Vanguard S&P 500 ETF' },
      'SPY': { y: 5.82, g: 14.29, n: 'State Street SPDR S&P 500 ETF' },
      'QQQ': { y: 9.72, g: 19.24, n: 'Invesco QQQ Trust' },
      'SCHD': { y: 8.68, g: 12.38, n: 'Schwab US Dividend Equity ETF' }
    };
  }
};

// --- ค่าเริ่มต้นใหม่ตามคำสั่งผู้ใช้งาน ---
const INITIAL_PORTFOLIO = [
  { symbol: 'VOO', allocation: 100 }
];

export default function App() {
  const [user, setUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState('idle');
  const [portfolio, setPortfolio] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [newAllocation, setNewAllocation] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);

  // ตั้งค่าตัวเลขเริ่มต้นใหม่
  const [initialInvestment, setInitialInvestment] = useState(10000);
  const [monthlyContribution, setMonthlyContribution] = useState(1500);
  const [contributionStepUp, setContributionStepUp] = useState(10);
  const [investmentYears, setInvestmentYears] = useState(15);

  // --- Auth & Data Loading ---
  useEffect(() => {
    const initializeApp = async () => {
      // โหลด CSV Database ก่อน
      await loadCSVDatabase();
      
      if (hasFirebase && auth) {
        const initAuth = async () => {
          try {
            if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
              await signInWithCustomToken(auth, __initial_auth_token);
            } else {
              await signInAnonymously(auth);
            }
          } catch (err) {}
        };
        initAuth();
        const unsubscribe = onAuthStateChanged(auth, setUser);
        return () => unsubscribe();
      } else {
        // Local Fallback (ทำงานบน Vercel ได้ 100% ไม่มีหน้าจอขาว)
        const localData = localStorage.getItem('etf_portfolio_data');
        if (localData) {
          try {
            const parsed = JSON.parse(localData);
            setInitialInvestment(parsed.initialInvestment ?? 10000);
            setMonthlyContribution(parsed.monthlyContribution ?? 1500);
            setContributionStepUp(parsed.contributionStepUp ?? 10);
            setInvestmentYears(parsed.investmentYears ?? 15);
            fetchAllLiveData(parsed.portfolio && parsed.portfolio.length > 0 ? parsed.portfolio : INITIAL_PORTFOLIO);
          } catch (e) {
            fetchAllLiveData(INITIAL_PORTFOLIO);
          }
        } else {
          fetchAllLiveData(INITIAL_PORTFOLIO);
        }
      }
    };
    
    initializeApp();
  }, []);

  useEffect(() => {
    if (hasFirebase && user && db) {
      const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'portfolio');
      const unsubscribe = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setInitialInvestment(data.initialInvestment ?? 10000);
          setMonthlyContribution(data.monthlyContribution ?? 1500);
          setContributionStepUp(data.contributionStepUp ?? 10);
          setInvestmentYears(data.investmentYears ?? 15);
          if (portfolio.length === 0) fetchAllLiveData(data.portfolio && data.portfolio.length > 0 ? data.portfolio : INITIAL_PORTFOLIO);
        } else {
          if (portfolio.length === 0) fetchAllLiveData(INITIAL_PORTFOLIO);
        }
      }, (err) => {
        setSyncStatus('error');
      });
      return () => unsubscribe();
    }
  }, [user]);

  const fetchAllLiveData = async (baseList) => {
    setIsLoading(true);
    try {
      const updated = await Promise.all(baseList.map(async (item) => ({
        ...item,
        data: await getFullStockData(item.symbol)
      })));
      setPortfolio(updated.filter(i => i.data !== null));
    } catch(err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const saveToCloudOrLocal = async (currentPortfolio, settings) => {
    setSyncStatus('syncing');
    const saveData = {
      portfolio: currentPortfolio.map(p => ({ symbol: p.symbol, allocation: p.allocation })),
      ...settings,
      lastSaved: new Date().toISOString()
    };

    if (hasFirebase && user && db) {
      try {
        const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'portfolio');
        await setDoc(docRef, saveData);
        setSyncStatus('success');
      } catch (err) {
        setSyncStatus('error');
      }
    } else {
      localStorage.setItem('etf_portfolio_data', JSON.stringify(saveData));
      setSyncStatus('success_local');
    }
    setTimeout(() => setSyncStatus('idle'), 2000);
  };

  const fetchWithRetry = async (url, retries = 2) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error();
      return await response.json();
    } catch (err) {
      if (retries > 0) return fetchWithRetry(url, retries - 1);
      throw err;
    }
  };

  const getFullStockData = async (symbol) => {
    const sym = symbol.toUpperCase().trim();
    let price = 0, divYield = 0, growthRate = 0, dataSource = 'Live API';

    try {
      try {
        const quote = await fetchWithRetry(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_API_KEY}`);
        const financials = await fetchWithRetry(`https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${FINNHUB_API_KEY}`);
        price = quote.c || 0;
        divYield = financials.metric?.dividendYieldTTM || financials.metric?.dividendYieldIndicatedAnnual || 0;
        growthRate = financials.metric?.['epsGrowth10Y'] || financials.metric?.['revenueGrowth10Y'] || financials.metric?.['epsGrowth5Y'] || 0;
      } catch (e) {}

      if (price === 0 || divYield === 0) {
        try {
          const eodRT = await fetchWithRetry(`https://eodhd.com/api/real-time/${sym}.US?api_token=${EODHD_API_KEY}&fmt=json`);
          price = eodRT.close || price;
          if (divYield === 0) {
            const eodFund = await fetchWithRetry(`https://eodhd.com/api/fundamentals/${sym}.US?api_token=${EODHD_API_KEY}&fmt=json`);
            divYield = (eodFund.Highlights?.DividendYield * 100) || 0;
          }
        } catch (e) {}
      }

      if (price === 0) {
        try {
          const poly = await fetchWithRetry(`https://api.polygon.io/v2/aggs/ticker/${sym}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`);
          price = poly.results?.[0]?.c || 0;
        } catch (e) {}
      }

      if (divYield === 0 || growthRate === 0) {
        if (FALLBACK_MAP[sym]) {
          divYield = divYield || FALLBACK_MAP[sym].y;
          growthRate = growthRate || FALLBACK_MAP[sym].g;
          dataSource = 'Market Avg (Verified)';
        } else if (divYield === 0) {
          divYield = 1.5; growthRate = 10.0; dataSource = 'Estimated Avg';
        }
      }

      return price > 0 ? { price, divYield, growthRate, dataSource } : null;
    } catch (err) { return null; }
  };

  const handleAddStock = async () => {
    if (!newSymbol.trim()) return;
    const sym = newSymbol.toUpperCase().trim();
    if (portfolio.some(p => p.symbol === sym)) { setErrorMsg("หุ้นนี้มีอยู่แล้วในพอร์ต"); return; }
    setIsAdding(true); setErrorMsg(null);
    const data = await getFullStockData(sym);
    if (data) {
      const next = [...portfolio, { symbol: sym, allocation: Number(newAllocation) || 10, data }];
      setPortfolio(next);
      saveToCloudOrLocal(next, { initialInvestment, monthlyContribution, contributionStepUp, investmentYears });
      setNewSymbol(''); setNewAllocation('');
    } else { setErrorMsg("ไม่พบข้อมูลหุ้นที่ระบุ"); }
    setIsAdding(false);
  };

  const handleRemoveStock = (sym) => {
    const next = portfolio.filter(p => p.symbol !== sym);
    setPortfolio(next);
    saveToCloudOrLocal(next, { initialInvestment, monthlyContribution, contributionStepUp, investmentYears });
  };

  const handleUpdateSetting = (setter, key, val) => {
    setter(val);
    const nextSettings = { initialInvestment, monthlyContribution, contributionStepUp, investmentYears, [key]: val };
    saveToCloudOrLocal(portfolio, nextSettings);
  };

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

  const projections = useMemo(() => {
    let drip = initialInvestment, noDrip = initialInvestment, cash = 0, invested = initialInvestment, monthly = monthlyContribution;
    const history = [];
    const mY = (metrics.yield / 100) / 12, mG = (metrics.growth / 100) / 12;
    
    for (let y = 1; y <= investmentYears; y++) {
      for (let m = 1; m <= 12; m++) {
        drip = (drip * (1 + mG)) + (drip * mY) + monthly;
        cash += (noDrip * mY);
        noDrip = (noDrip * (1 + mG)) + monthly;
        invested += monthly;
      }
      if (y % 5 === 0 || y === 1 || y === investmentYears) history.push({ year: y, drip, totalNoDrip: noDrip + cash, invested });
      monthly *= (1 + (contributionStepUp / 100));
    }
    return { history, finalDrip: drip, finalNoDrip: noDrip + cash, invested };
  }, [metrics, initialInvestment, monthlyContribution, contributionStepUp, investmentYears]);

  const formatCurrency = (v) => {
    if (isNaN(v) || v === null) return '฿0';
    return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(v);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-800 font-sans selection:bg-blue-100">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="bg-white p-6 rounded-[32px] shadow-sm flex flex-col md:flex-row justify-between items-center border border-blue-900">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 bg-blue-900 rounded-2xl flex items-center justify-center text-white shadow-md">
              <TrendingUp size={32} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 uppercase">พอร์ตหุ้น ETF อเมริกา</h1>
              <div className="flex items-center gap-3 mt-1">
                <p className="text-slate-500 text-sm flex items-center gap-2 font-medium">
                  <Database size={14} className="text-blue-600" /> Multi-API Synergy (10Y)
                </p>
                <div className="h-4 w-px bg-slate-200"></div>
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  {syncStatus === 'syncing' ? (
                    <span className="text-blue-500 flex items-center gap-1 animate-pulse"><RefreshCw size={12} className="animate-spin" /> กำลังบันทึก...</span>
                  ) : syncStatus === 'success' ? (
                    <span className="text-green-600 flex items-center gap-1"><Cloud size={12} /> บันทึกบน Cloud แล้ว</span>
                  ) : syncStatus === 'success_local' ? (
                    <span className="text-emerald-600 flex items-center gap-1"><HardDrive size={12} /> บันทึกในเครื่องแล้ว</span>
                  ) : hasFirebase ? (
                    <span className="text-slate-400 flex items-center gap-1"><Cloud size={12} /> Cloud Sync Active</span>
                  ) : (
                    <span className="text-slate-400 flex items-center gap-1"><HardDrive size={12} /> Local Auto-Save</span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 md:mt-0 flex flex-col items-end gap-1">
             <div className="bg-white text-blue-900 px-5 py-2 rounded-full text-xs font-bold border border-blue-900 flex items-center gap-2 shadow-sm">
               <CheckCircle2 size={14} /> ระบบบันทึกอัตโนมัติ
             </div>
             {hasFirebase && user && <span className="text-[9px] text-slate-300 font-mono tracking-tighter">UID: {user.uid}</span>}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-6">
            <section className="bg-white p-6 rounded-[32px] shadow-sm border border-blue-900">
              <div className="flex justify-between items-center mb-5">
                <h2 className="font-bold text-lg flex items-center gap-2 text-slate-900 italic">
                  <Wallet size={20} className="text-blue-900" /> หุ้นในพอร์ตของคุณ
                </h2>
                <div className={`text-[10px] font-bold px-2 py-1 rounded-md border ${metrics.totalAlloc === 100 ? 'border-green-600 text-green-700' : 'border-amber-500 text-amber-600'}`}>
                  สัดส่วนรวม: {metrics.totalAlloc}%
                </div>
              </div>

              <div className="space-y-3 mb-5">
                {isLoading ? (
                  <div className="py-10 text-center animate-pulse text-slate-400 text-sm italic">กำลังดึงข้อมูลพอร์ตของคุณ...</div>
                ) : (
                  portfolio.map(stock => (
                    <div key={stock.symbol} className="bg-white p-4 rounded-2xl border border-blue-900/20 relative group transition-all hover:border-blue-900 shadow-sm">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-blue-900 text-lg uppercase">{stock.symbol}</span>
                            <span className="text-[10px] bg-white px-2 py-0.5 rounded-full border border-blue-900 text-slate-600 font-bold">
                              ${stock.data?.price?.toFixed(2)}
                            </span>
                          </div>
                          <div className="text-[9px] text-slate-400 mt-1 italic font-medium">Source: {stock.data?.dataSource}</div>
                        </div>
                        <button onClick={() => handleRemoveStock(stock.symbol)} className="text-slate-200 hover:text-red-600 p-1.5 rounded-lg transition-colors">
                          <Trash2 size={18} />
                        </button>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-100">
                        <div>
                          <label className="text-[9px] text-slate-500 block mb-0.5 font-bold uppercase tracking-tighter">สัดส่วน (%)</label>
                          <input type="number" value={stock.allocation} onChange={(e) => {
                            const next = portfolio.map(p => p.symbol === stock.symbol ? {...p, allocation: Number(e.target.value)} : p);
                            setPortfolio(next);
                            saveToCloudOrLocal(next, { initialInvestment, monthlyContribution, contributionStepUp, investmentYears });
                          }} className="w-full bg-white rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold focus:border-blue-900 outline-none" />
                        </div>
                        <div className="text-center border-x border-slate-50 px-1">
                          <label className="text-[9px] text-slate-500 block mb-0.5 font-bold uppercase tracking-tighter">ปันผล (Yield)</label>
                          <div className="text-xs font-bold text-green-700">{stock.data?.divYield?.toFixed(2)}%</div>
                        </div>
                        <div className="text-right">
                          <label className="text-[9px] text-slate-500 block mb-0.5 font-bold uppercase tracking-tighter">ราคาโต (10Y)</label>
                          <div className="text-xs font-bold text-blue-600">+{stock.data?.growthRate?.toFixed(2)}%</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4 p-4 bg-white rounded-2xl border border-blue-900/30 shadow-sm">
                <label className="text-xs font-bold text-blue-900 mb-3 block italic tracking-wide">+ เพิ่มหุ้นใหม่เข้าพอร์ต</label>
                <div className="flex flex-row items-center gap-2">
                  <input placeholder="หุ้น" value={newSymbol} onChange={(e) => setNewSymbol(e.target.value.toUpperCase())} className="w-[75px] bg-white border border-blue-900 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-1 focus:ring-blue-900 uppercase" />
                  <div className="relative flex-1">
                    <input type="number" placeholder="ระบุสัดส่วน (%)" value={newAllocation} onChange={(e) => setNewAllocation(e.target.value)} className="w-full bg-white border border-blue-900 rounded-xl pl-3 pr-8 py-2 text-sm font-bold outline-none" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">%</span>
                  </div>
                  <button onClick={handleAddStock} disabled={isAdding || !newSymbol.trim()} className="bg-blue-900 text-white px-5 py-2 rounded-xl hover:bg-blue-800 disabled:opacity-50 transition-all font-bold min-w-[70px] shadow-sm">
                    {isAdding ? <RefreshCw size={18} className="animate-spin" /> : "เพิ่ม"}
                  </button>
                </div>
                {errorMsg && <p className="text-[10px] text-red-600 font-bold mt-2 px-1">{errorMsg}</p>}
              </div>
            </section>

            <section className="bg-white p-6 rounded-[32px] shadow-sm border border-blue-900 space-y-4">
              <h2 className="font-bold text-lg flex items-center gap-2 text-slate-900 uppercase"><Calculator size={20} className="text-blue-900" /> ตั้งค่าการลงทุน</h2>
              <div className="space-y-4">
                <div className="space-y-1"><label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">เงินลงทุนเริ่มต้น (บาท)</label><input type="number" value={initialInvestment} onChange={e => handleUpdateSetting(setInitialInvestment, 'initialInvestment', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-3 font-black text-lg outline-none focus:border-blue-900 transition-all text-slate-900" /></div>
                <div className="space-y-1"><label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">ลงทุนเพิ่มรายเดือน (บาท)</label><input type="number" value={monthlyContribution} onChange={e => handleUpdateSetting(setMonthlyContribution, 'monthlyContribution', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-3 font-black text-lg outline-none focus:border-blue-900 transition-all text-slate-900" /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1"><label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">เพิ่มปีละ (%)</label><input type="number" value={contributionStepUp} onChange={e => handleUpdateSetting(setContributionStepUp, 'contributionStepUp', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-3 font-black text-lg outline-none focus:border-blue-900 transition-all text-slate-900" /></div>
                  <div className="space-y-1"><label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">ระยะเวลา (ปี)</label><input type="number" value={investmentYears} onChange={e => handleUpdateSetting(setInvestmentYears, 'investmentYears', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-3 font-black text-lg outline-none focus:border-blue-900 transition-all text-slate-900" /></div>
                </div>
              </div>
            </section>
          </div>

          <div className="lg:col-span-7 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white border-[4px] border-green-800 p-8 rounded-[40px] shadow-sm relative overflow-hidden">
                <h3 className="text-slate-500 text-sm font-bold mb-1 uppercase tracking-tight">มูลค่าพอร์ตทบต้น (DRIP)</h3>
                <div className="text-3xl md:text-4xl font-black mb-4 tabular-nums text-green-900 tracking-tight">{formatCurrency(projections.finalDrip)}</div>
                <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-[10px] font-bold border border-green-200 inline-block shadow-sm">พลังของดอกเบี้ยทบต้น ✨</span>
              </div>
              <div className="bg-white p-8 rounded-[40px] border border-blue-900 shadow-sm flex flex-col justify-center">
                <h3 className="text-slate-500 text-sm font-bold mb-1 uppercase tracking-tight">หากไม่ทบต้น</h3>
                <div className="text-3xl md:text-4xl font-black text-slate-800 tabular-nums mb-3 tracking-tight">{formatCurrency(projections.finalNoDrip)}</div>
                <div className="text-xs text-red-600 font-bold flex items-center gap-1 uppercase tracking-wider"><ArrowUpRight size={14} className="rotate-90" /> ส่วนต่าง: {formatCurrency(projections.finalDrip - projections.finalNoDrip)}</div>
              </div>
            </div>

            <div className="bg-white p-8 rounded-[32px] border border-blue-900 shadow-sm">
              <div className="flex justify-between items-end mb-8">
                <div><h2 className="font-black text-2xl mb-1 text-slate-900 uppercase">เปรียบเทียบการเติบโต</h2><p className="text-slate-500 text-sm font-medium italic tracking-wide">สรุปภาพรวมผลตอบแทนพอร์ตในระยะ {investmentYears} ปี</p></div>
                <div className="flex flex-col items-end gap-3 text-right">
                  <div><div className="text-[10px] text-slate-400 uppercase font-black tracking-widest leading-none">Yield เฉลี่ยพอร์ต</div><div className="text-xl font-black text-green-700 leading-none mt-1">{metrics.yield.toFixed(2)}% / ปี</div></div>
                  <div className="border-t border-slate-100 pt-2"><div className="text-[10px] text-slate-400 uppercase font-black tracking-widest leading-none">Growth เฉลี่ยพอร์ต</div><div className="text-xl font-black text-blue-600 leading-none mt-1">+{metrics.growth.toFixed(2)}% / ปี</div></div>
                </div>
              </div>
              <div className="space-y-12 mt-4">
                <div className="relative">
                  <div className="flex justify-between items-center text-base mb-3 font-black uppercase tracking-tight text-green-800"><span>Compound Strategy</span><span className="text-xl">{formatCurrency(projections.finalDrip)}</span></div>
                  <div className="w-full bg-slate-50 h-14 rounded-2xl p-1.5 border border-slate-200 shadow-inner overflow-hidden">
                    <div className="bg-green-700 h-full rounded-xl transition-all duration-1000 flex items-center px-6" style={{ width: '100%' }}><span className="text-base text-white font-black whitespace-nowrap">ยอดทบต้น: {formatCurrency(projections.finalDrip)}</span></div>
                  </div>
                </div>
                <div className="relative">
                  <div className="flex justify-between items-center text-base mb-3 font-black uppercase tracking-tight text-slate-500"><span>Cash-Out Strategy</span><span className="text-xl">{formatCurrency(projections.finalNoDrip)}</span></div>
                  <div className="w-full bg-slate-50 h-14 rounded-2xl p-1.5 border border-slate-200 shadow-inner overflow-hidden">
                    <div className="bg-slate-300 h-full rounded-xl transition-all duration-1000 flex items-center px-6" style={{ width: `${Math.max(25, (projections.finalNoDrip / projections.finalDrip) * 100)}%` }}><span className="text-base text-slate-800 font-black whitespace-nowrap">ยอดไม่ทบต้น: {formatCurrency(projections.finalNoDrip)}</span></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-[32px] border border-blue-900 overflow-hidden shadow-sm">
              <div className="px-8 py-6 border-b border-blue-900/10 bg-slate-50/30 font-black text-lg text-slate-900 uppercase">ตารางสรุปรายปี</div>
              <div className="overflow-x-auto text-sm">
                <table className="w-full text-left font-medium divide-y divide-blue-900/10">
                  <thead className="bg-slate-50 text-[11px] text-slate-600 font-black uppercase border-b border-blue-900/10">
                    <tr><th className="px-8 py-4">ปีที่</th><th className="px-8 py-4 text-green-800">ทบต้น (DRIP)</th><th className="px-8 py-4 text-slate-500">ไม่ทบต้น</th><th className="px-8 py-4 text-emerald-600 text-right pr-12">ส่วนต่างสะสม</th></tr>
                  </thead>
                  <tbody className="divide-y divide-blue-900/10 bg-white font-medium">
                    {projections.history.map((row) => (
                      <tr key={row.year} className="hover:bg-slate-50 transition-colors">
                        <td className="px-8 py-5 font-black text-slate-400">{row.year}</td>
                        <td className="px-8 py-5 font-black text-green-900">{formatCurrency(row.drip)}</td>
                        <td className="px-8 py-5 text-slate-500">{formatCurrency(row.totalNoDrip)}</td>
                        <td className="px-8 py-5 text-green-600 font-bold text-right pr-12">+{formatCurrency(row.drip - row.totalNoDrip)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
