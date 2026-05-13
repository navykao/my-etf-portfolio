// ============================================================
// src/App.jsx  — ETF & Stock Portfolio Tracker
// 
// ✅ ระหว่างวัน: อ่านจาก combined-all-assets.json (ไม่เสีย quota)
// ✅ Live Mode:  ดึงราคาจริงทุก 2 ชม. เฉพาะ Portfolio + Watchlist
//               ทำงาน 7 วัน (จันทร์-อาทิตย์)
// ✅ Fallback:   Finnhub → Yahoo → EODHD → Twelve Data
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  DATA_URL: "/data/combined-all-assets.json",
  LIVE_INTERVAL_MS: 2 * 60 * 60 * 1000, // 2 ชั่วโมง
  FINNHUB_API_KEY: import.meta.env.VITE_FINNHUB_API_KEY || "",
  EODHD_API_KEY: import.meta.env.VITE_EODHD_API_KEY || "",
  TWELVE_API_KEY: import.meta.env.VITE_TWELVE_DATA_API_KEY || "",
  CACHE_TTL_MS: 90 * 60 * 1000, // cache 90 นาที
};

const STORAGE_KEYS = {
  PORTFOLIO: "etf_portfolio_v3",
  WATCHLIST: "etf_watchlist_v3",
  LIVE_MODE: "etf_live_mode_v3",
  PRICE_CACHE: "etf_price_cache_v3",
};

// ============================================================
// CACHE MANAGER
// ============================================================
const CacheManager = {
  getAll() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.PRICE_CACHE) || "{}");
    } catch { return {}; }
  },
  get(symbol) {
    const cache = this.getAll();
    const entry = cache[symbol];
    if (!entry) return null;
    if (Date.now() - entry.ts > CONFIG.CACHE_TTL_MS) return null;
    return entry.data;
  },
  set(symbol, data) {
    try {
      const cache = this.getAll();
      cache[symbol] = { data, ts: Date.now() };
      // เก็บแค่ 200 ตัวล่าสุด
      const keys = Object.keys(cache);
      if (keys.length > 200) {
        const oldest = keys.sort((a, b) => cache[a].ts - cache[b].ts).slice(0, keys.length - 200);
        oldest.forEach(k => delete cache[k]);
      }
      localStorage.setItem(STORAGE_KEYS.PRICE_CACHE, JSON.stringify(cache));
    } catch { /* quota full */ }
  },
  clear() {
    localStorage.removeItem(STORAGE_KEYS.PRICE_CACHE);
  }
};

// ============================================================
// API FETCHER — Finnhub → Yahoo → EODHD → Twelve
// ============================================================
const API = {
  async fetchWithTimeout(url, timeout = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  },

  async fromFinnhub(symbol) {
    if (!CONFIG.FINNHUB_API_KEY) return null;
    try {
      const data = await this.fetchWithTimeout(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${CONFIG.FINNHUB_API_KEY}`
      );
      if (data && data.c > 0) {
        return {
          price: data.c,
          change: data.d || 0,
          changePercent: data.dp || 0,
          high: data.h,
          low: data.l,
          open: data.o,
          prevClose: data.pc,
          source: "Finnhub",
        };
      }
    } catch (e) {
      console.warn(`[Finnhub] ${symbol}:`, e.message);
    }
    return null;
  },

  async fromYahoo(symbol) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
      const data = await this.fetchWithTimeout(url);
      const meta = data?.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice > 0) {
        const price = meta.regularMarketPrice;
        const prev = meta.chartPreviousClose || meta.previousClose || price;
        const change = price - prev;
        return {
          price,
          change,
          changePercent: prev > 0 ? (change / prev) * 100 : 0,
          high: meta.regularMarketDayHigh,
          low: meta.regularMarketDayLow,
          prevClose: prev,
          source: "Yahoo",
        };
      }
    } catch (e) {
      console.warn(`[Yahoo] ${symbol}:`, e.message);
    }
    return null;
  },

  async fromEODHD(symbol) {
    if (!CONFIG.EODHD_API_KEY) return null;
    try {
      const data = await this.fetchWithTimeout(
        `https://eodhd.com/api/real-time/${symbol}.US?api_token=${CONFIG.EODHD_API_KEY}&fmt=json`
      );
      if (data?.close > 0) {
        return {
          price: parseFloat(data.close),
          change: parseFloat(data.change) || 0,
          changePercent: parseFloat(data.change_p) || 0,
          source: "EODHD",
        };
      }
    } catch (e) {
      console.warn(`[EODHD] ${symbol}:`, e.message);
    }
    return null;
  },

  async fromTwelve(symbol) {
    if (!CONFIG.TWELVE_API_KEY) return null;
    try {
      const data = await this.fetchWithTimeout(
        `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${CONFIG.TWELVE_API_KEY}`
      );
      if (data?.price) {
        return { price: parseFloat(data.price), change: 0, changePercent: 0, source: "TwelveData" };
      }
    } catch (e) {
      console.warn(`[Twelve] ${symbol}:`, e.message);
    }
    return null;
  },

  async fetchLivePrice(symbol) {
    const cached = CacheManager.get(symbol);
    if (cached) return { ...cached, fromCache: true };

    const chains = [
      () => this.fromFinnhub(symbol),
      () => this.fromYahoo(symbol),
      () => this.fromEODHD(symbol),
      () => this.fromTwelve(symbol),
    ];

    for (const fn of chains) {
      const result = await fn();
      if (result && result.price > 0) {
        CacheManager.set(symbol, result);
        return result;
      }
    }
    return null;
  },
};

// ============================================================
// STORAGE HELPERS
// ============================================================
const Storage = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
  },
};

// ============================================================
// UTILS
// ============================================================
const fmt = {
  price: (n) => n == null ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  pct: (n) => n == null ? "—" : `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}%`,
  num: (n) => n == null ? "—" : Number(n).toLocaleString("en-US"),
  date: (iso) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" });
  },
  time: (ms) => {
    if (!ms) return null;
    const diff = Date.now() - ms;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "เมื่อกี้";
    if (m < 60) return `${m} นาทีที่แล้ว`;
    const h = Math.floor(m / 60);
    return `${h} ชม.ที่แล้ว`;
  },
};

function colorClass(n) {
  if (n == null) return "text-gray-400";
  return n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-gray-400";
}

// ============================================================
// HOOKS
// ============================================================
function useLocalStorage(key, fallback) {
  const [val, setVal] = useState(() => Storage.get(key, fallback));
  const update = useCallback((v) => {
    setVal(v);
    Storage.set(key, v);
  }, [key]);
  return [val, update];
}

// ============================================================
// MINI COMPONENTS
// ============================================================
function Badge({ children, color = "gray" }) {
  const colors = {
    gray: "bg-gray-700 text-gray-300",
    blue: "bg-blue-900/50 text-blue-300",
    green: "bg-emerald-900/50 text-emerald-300",
    red: "bg-red-900/50 text-red-300",
    yellow: "bg-yellow-900/50 text-yellow-300",
    purple: "bg-purple-900/50 text-purple-300",
    teal: "bg-teal-900/50 text-teal-300",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[color] || colors.gray}`}>
      {children}
    </span>
  );
}

function Spinner({ size = "sm" }) {
  const s = size === "sm" ? "w-4 h-4" : "w-8 h-8";
  return (
    <svg className={`${s} animate-spin text-blue-400`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function PriceChange({ change, pct, showIcon = true }) {
  const up = change >= 0;
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${up ? "text-emerald-400" : "text-red-400"}`}>
      {showIcon && <span>{up ? "▲" : "▼"}</span>}
      {fmt.pct(pct)}
    </span>
  );
}

function LiveDot({ active }) {
  if (!active) return null;
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
    </span>
  );
}

// ============================================================
// LIVE MODE PANEL
// ============================================================
function LiveModePanel({ liveMode, setLiveMode, lastUpdate, nextUpdate, updateCount, loading }) {
  const timeLeft = nextUpdate ? Math.max(0, Math.ceil((nextUpdate - Date.now()) / 60000)) : null;

  return (
    <div className={`rounded-xl border p-4 transition-all ${liveMode
      ? "bg-emerald-950/30 border-emerald-700/50"
      : "bg-gray-800/30 border-gray-700/50"
      }`}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <LiveDot active={liveMode} />
          <div>
            <p className="text-sm font-semibold text-white">
              Live Mode
              {liveMode && <span className="ml-2 text-xs text-emerald-400 font-normal">ทำงานอยู่</span>}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              อัปเดต Portfolio + Watchlist ทุก 2 ชั่วโมง
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {loading && <Spinner />}
          <button
            onClick={() => setLiveMode(!liveMode)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${liveMode
              ? "bg-emerald-600 hover:bg-emerald-700 text-white"
              : "bg-gray-700 hover:bg-gray-600 text-gray-300"
              }`}
          >
            {liveMode ? "ปิด Live" : "เปิด Live"}
          </button>
        </div>
      </div>

      {liveMode && (
        <div className="mt-3 pt-3 border-t border-emerald-800/40 flex flex-wrap gap-4 text-xs text-gray-400">
          {lastUpdate && (
            <span>
              อัปเดตล่าสุด: <span className="text-emerald-300">{fmt.time(lastUpdate)}</span>
            </span>
          )}
          {timeLeft !== null && (
            <span>
              อัปเดตครั้งถัดไป: <span className="text-emerald-300">ใน {timeLeft} นาที</span>
            </span>
          )}
          {updateCount > 0 && (
            <span>
              อัปเดตแล้ว: <span className="text-emerald-300">{updateCount} ครั้ง</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// SEARCH BAR
// ============================================================
function SearchBar({ value, onChange, placeholder }) {
  return (
    <div className="relative">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || "ค้นหา Symbol หรือชื่อ..."}
        className="w-full bg-gray-800/60 border border-gray-700/60 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/30 transition-all"
      />
    </div>
  );
}

// ============================================================
// ASSET CARD (ใน Search/Browse)
// ============================================================
function AssetCard({ asset, onAdd, onWatchlist, inPortfolio, inWatchlist }) {
  const typeColor = { STOCK: "blue", ETF: "teal", REIT: "purple", BOND: "yellow" };
  return (
    <div className="bg-gray-800/50 border border-gray-700/40 rounded-xl p-4 hover:border-gray-600/60 transition-all group">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-bold text-base">{asset.symbol}</span>
            <Badge color={typeColor[asset.type] || "gray"}>{asset.type}</Badge>
            {asset.sector && <Badge>{asset.sector}</Badge>}
          </div>
          <p className="text-gray-400 text-xs mt-1 truncate">{asset.name}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-white font-semibold">{fmt.price(asset.price)}</p>
          {asset.changePercent != null && (
            <PriceChange change={asset.change || 0} pct={asset.changePercent} />
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {asset.dividendYield != null && (
          <span className="text-xs text-gray-400">
            Yield: <span className="text-emerald-400">{asset.dividendYield?.toFixed(2)}%</span>
          </span>
        )}
        {asset.exDividendDate && (
          <span className="text-xs text-gray-400">
            Ex-Div: <span className="text-yellow-300">{fmt.date(asset.exDividendDate)}</span>
          </span>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onAdd(asset)}
          className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${inPortfolio
            ? "bg-blue-900/40 border border-blue-700/50 text-blue-300 hover:bg-blue-900/60"
            : "bg-blue-600/80 hover:bg-blue-600 text-white"
            }`}
        >
          {inPortfolio ? "✓ ในพอร์ต" : "+ พอร์ต"}
        </button>
        <button
          onClick={() => onWatchlist(asset)}
          className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${inWatchlist
            ? "bg-yellow-900/40 border border-yellow-700/50 text-yellow-300 hover:bg-yellow-900/60"
            : "bg-gray-700 hover:bg-gray-600 text-gray-300"
            }`}
        >
          {inWatchlist ? "★ ติดตาม" : "☆ Watchlist"}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// PORTFOLIO ROW
// ============================================================
function PortfolioRow({ item, livePrice, onRemove, onEdit }) {
  const price = livePrice?.price ?? item.currentPrice ?? item.price ?? 0;
  const cost = item.avgCost ?? 0;
  const qty = item.quantity ?? 0;
  const value = price * qty;
  const invested = cost * qty;
  const gainLoss = value - invested;
  const gainLossPct = invested > 0 ? (gainLoss / invested) * 100 : 0;

  return (
    <div className="bg-gray-800/40 border border-gray-700/30 rounded-xl p-4 hover:border-gray-600/50 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-white font-bold">{item.symbol}</span>
            {livePrice && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-800/40">
                Live
              </span>
            )}
          </div>
          <p className="text-gray-400 text-xs truncate mt-0.5">{item.name}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-white font-semibold">{fmt.price(price)}</p>
          {livePrice?.changePercent != null && (
            <PriceChange change={livePrice.change} pct={livePrice.changePercent} />
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div>
          <p className="text-gray-500">จำนวน</p>
          <p className="text-white font-medium">{fmt.num(qty)} หุ้น</p>
        </div>
        <div>
          <p className="text-gray-500">ต้นทุน/หุ้น</p>
          <p className="text-white font-medium">{fmt.price(cost)}</p>
        </div>
        <div>
          <p className="text-gray-500">มูลค่ารวม</p>
          <p className="text-white font-medium">{fmt.price(value)}</p>
        </div>
        <div>
          <p className="text-gray-500">กำไร/ขาดทุน</p>
          <p className={`font-medium ${colorClass(gainLoss)}`}>
            {gainLoss >= 0 ? "+" : ""}{fmt.price(gainLoss)}
            <span className="ml-1 text-xs">({fmt.pct(gainLossPct)})</span>
          </p>
        </div>
      </div>

      <div className="mt-3 flex gap-2 justify-end">
        <button onClick={() => onEdit(item)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-all">แก้ไข</button>
        <button onClick={() => onRemove(item.symbol)} className="text-xs px-3 py-1.5 rounded-lg bg-red-900/40 hover:bg-red-900/60 text-red-400 border border-red-800/30 transition-all">ลบ</button>
      </div>
    </div>
  );
}

// ============================================================
// ADD TO PORTFOLIO MODAL
// ============================================================
function AddPortfolioModal({ asset, existing, onSave, onClose }) {
  const [qty, setQty] = useState(existing?.quantity ?? "");
  const [cost, setCost] = useState(existing?.avgCost ?? asset.price ?? "");

  const handleSave = () => {
    const q = parseFloat(qty);
    const c = parseFloat(cost);
    if (!q || q <= 0 || !c || c <= 0) return;
    onSave({ ...asset, quantity: q, avgCost: c });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700/60 rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-white font-bold text-lg mb-1">{existing ? "แก้ไข" : "เพิ่ม"} — {asset.symbol}</h3>
        <p className="text-gray-400 text-sm mb-5 truncate">{asset.name}</p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">จำนวนหุ้น</label>
            <input
              type="number" min="0" step="1"
              value={qty} onChange={e => setQty(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500/70 transition-all"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">ต้นทุนเฉลี่ยต่อหุ้น ($)</label>
            <input
              type="number" min="0" step="0.01"
              value={cost} onChange={e => setCost(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500/70 transition-all"
              placeholder="0.00"
            />
          </div>
        </div>

        {qty && cost && (
          <div className="mt-4 p-3 bg-blue-900/20 border border-blue-800/30 rounded-xl">
            <p className="text-xs text-gray-400">มูลค่าลงทุนรวม</p>
            <p className="text-white font-bold">{fmt.price(parseFloat(qty) * parseFloat(cost))}</p>
          </div>
        )}

        <div className="mt-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-all">ยกเลิก</button>
          <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-all">บันทึก</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PORTFOLIO SUMMARY
// ============================================================
function PortfolioSummary({ items, livePrices }) {
  let totalValue = 0, totalInvested = 0;
  items.forEach(item => {
    const price = livePrices[item.symbol]?.price ?? item.currentPrice ?? item.price ?? 0;
    totalValue += price * (item.quantity ?? 0);
    totalInvested += (item.avgCost ?? 0) * (item.quantity ?? 0);
  });
  const gain = totalValue - totalInvested;
  const gainPct = totalInvested > 0 ? (gain / totalInvested) * 100 : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      {[
        { label: "มูลค่าพอร์ต", value: fmt.price(totalValue), color: "text-white" },
        { label: "ลงทุนทั้งหมด", value: fmt.price(totalInvested), color: "text-white" },
        { label: "กำไร/ขาดทุน", value: `${gain >= 0 ? "+" : ""}${fmt.price(gain)}`, color: colorClass(gain) },
        { label: "ผลตอบแทน", value: fmt.pct(gainPct), color: colorClass(gainPct) },
      ].map(s => (
        <div key={s.label} className="bg-gray-800/40 border border-gray-700/30 rounded-xl p-3 text-center">
          <p className="text-gray-400 text-xs mb-1">{s.label}</p>
          <p className={`font-bold text-base ${s.color}`}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// TABS
// ============================================================
function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 p-1 bg-gray-800/60 rounded-xl border border-gray-700/40">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-medium transition-all ${active === t.id
            ? "bg-blue-600 text-white shadow-md shadow-blue-900/30"
            : "text-gray-400 hover:text-gray-200 hover:bg-gray-700/50"
            }`}
        >
          <span>{t.icon}</span>
          <span className="hidden sm:inline">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  // ——— Data
  const [allAssets, setAllAssets] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState(null);
  const [dataTimestamp, setDataTimestamp] = useState(null);

  // ——— UI
  const [tab, setTab] = useState("portfolio");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("ALL");

  // ——— Portfolio & Watchlist
  const [portfolio, setPortfolio] = useLocalStorage(STORAGE_KEYS.PORTFOLIO, []);
  const [watchlist, setWatchlist] = useLocalStorage(STORAGE_KEYS.WATCHLIST, []);

  // ——— Live Mode
  const [liveMode, setLiveModeStorage] = useLocalStorage(STORAGE_KEYS.LIVE_MODE, false);
  const [livePrices, setLivePrices] = useState({});
  const [liveLoading, setLiveLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [nextUpdate, setNextUpdate] = useState(null);
  const [updateCount, setUpdateCount] = useState(0);
  const liveTimerRef = useRef(null);

  // ——— Modal
  const [addModal, setAddModal] = useState(null); // { asset, existing? }

  // ============================================================
  // โหลด JSON ตอนเริ่ม
  // ============================================================
  useEffect(() => {
    setDataLoading(true);
    fetch(CONFIG.DATA_URL + `?v=${Date.now()}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setDataTimestamp(r.headers.get("last-modified"));
        return r.json();
      })
      .then(data => {
        setAllAssets(Array.isArray(data) ? data : []);
        setDataLoading(false);
      })
      .catch(err => {
        setDataError(err.message);
        setDataLoading(false);
      });
  }, []);

  // ============================================================
  // Live Mode — ดึงราคาเฉพาะ Portfolio + Watchlist
  // ============================================================
  const doLiveUpdate = useCallback(async () => {
    const symbols = [
      ...new Set([
        ...portfolio.map(p => p.symbol),
        ...watchlist.map(w => w.symbol),
      ]),
    ];
    if (symbols.length === 0) return;

    setLiveLoading(true);
    const results = {};

    for (const sym of symbols) {
      const data = await API.fetchLivePrice(sym);
      if (data) results[sym] = data;
      // หน่วงเล็กน้อยระหว่างตัว ไม่ให้ Finnhub rate-limit
      await new Promise(r => setTimeout(r, 100));
    }

    setLivePrices(prev => ({ ...prev, ...results }));
    setLastUpdate(Date.now());
    setUpdateCount(c => c + 1);
    setLiveLoading(false);

    // ตั้ง next update
    setNextUpdate(Date.now() + CONFIG.LIVE_INTERVAL_MS);
  }, [portfolio, watchlist]);

  // ตั้ง/ยกเลิก Live timer
  useEffect(() => {
    if (liveTimerRef.current) {
      clearInterval(liveTimerRef.current);
      liveTimerRef.current = null;
    }

    if (liveMode) {
      doLiveUpdate(); // รันทันที
      liveTimerRef.current = setInterval(doLiveUpdate, CONFIG.LIVE_INTERVAL_MS);
      setNextUpdate(Date.now() + CONFIG.LIVE_INTERVAL_MS);
    } else {
      setNextUpdate(null);
    }

    return () => {
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    };
  }, [liveMode, doLiveUpdate]);

  // ============================================================
  // PORTFOLIO ACTIONS
  // ============================================================
  const handleAddPortfolio = useCallback((asset) => {
    const existing = portfolio.find(p => p.symbol === asset.symbol);
    setAddModal({ asset, existing });
  }, [portfolio]);

  const handleSavePortfolio = useCallback((item) => {
    setPortfolio(prev => {
      const filtered = prev.filter(p => p.symbol !== item.symbol);
      return [...filtered, item];
    });
    setAddModal(null);
  }, [setPortfolio]);

  const handleRemovePortfolio = useCallback((symbol) => {
    setPortfolio(prev => prev.filter(p => p.symbol !== symbol));
  }, [setPortfolio]);

  // ============================================================
  // WATCHLIST ACTIONS
  // ============================================================
  const handleToggleWatchlist = useCallback((asset) => {
    setWatchlist(prev => {
      const exists = prev.find(w => w.symbol === asset.symbol);
      return exists ? prev.filter(w => w.symbol !== asset.symbol) : [...prev, asset];
    });
  }, [setWatchlist]);

  // ============================================================
  // SEARCH / FILTER
  // ============================================================
  const filteredAssets = (() => {
    if (!searchQuery && filterType === "ALL") return [];
    const q = searchQuery.toLowerCase();
    return allAssets.filter(a => {
      const matchType = filterType === "ALL" || a.type === filterType;
      const matchQ = !q || a.symbol.toLowerCase().includes(q) || (a.name || "").toLowerCase().includes(q);
      return matchType && matchQ;
    }).slice(0, 50);
  })();

  const assetMap = Object.fromEntries(allAssets.map(a => [a.symbol, a]));
  const portfolioSymbols = new Set(portfolio.map(p => p.symbol));
  const watchlistSymbols = new Set(watchlist.map(w => w.symbol));

  // ============================================================
  // TABS CONFIG
  // ============================================================
  const TABS = [
    { id: "portfolio", label: "พอร์ต", icon: "💼" },
    { id: "watchlist", label: "Watchlist", icon: "⭐" },
    { id: "search", label: "ค้นหา", icon: "🔍" },
  ];

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="min-h-screen bg-gray-950 text-white" style={{ fontFamily: "'DM Sans', 'Noto Sans Thai', sans-serif" }}>
      {/* ═══ HEADER ═══ */}
      <header className="sticky top-0 z-40 bg-gray-950/90 backdrop-blur border-b border-gray-800/60">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-sm font-bold shadow-md shadow-blue-900/40">
              P
            </div>
            <div>
              <h1 className="text-sm font-bold text-white leading-none">Portfolio Tracker</h1>
              {dataTimestamp && (
                <p className="text-xs text-gray-500 mt-0.5">
                  ข้อมูล: {new Date(dataTimestamp).toLocaleDateString("th-TH")}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {liveLoading && <Spinner size="sm" />}
            {liveMode && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-900/30 border border-emerald-800/40 px-2.5 py-1 rounded-full">
                <LiveDot active />
                Live
              </span>
            )}
            <span className="text-xs text-gray-500 bg-gray-800/60 px-2.5 py-1 rounded-full border border-gray-700/40">
              {allAssets.length} ตัว
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        {/* ═══ LOADING / ERROR ═══ */}
        {dataLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="text-center space-y-3">
              <Spinner size="lg" />
              <p className="text-gray-400 text-sm">กำลังโหลดข้อมูล...</p>
            </div>
          </div>
        )}

        {dataError && (
          <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-4 text-center">
            <p className="text-red-400 text-sm font-medium">โหลดข้อมูลไม่ได้</p>
            <p className="text-red-500/70 text-xs mt-1">{dataError}</p>
            <button onClick={() => window.location.reload()} className="mt-3 px-4 py-2 bg-red-900/40 hover:bg-red-900/60 border border-red-800/40 text-red-300 rounded-lg text-xs transition-all">ลองใหม่</button>
          </div>
        )}

        {!dataLoading && !dataError && (
          <>
            {/* ═══ LIVE MODE ═══ */}
            <LiveModePanel
              liveMode={liveMode}
              setLiveMode={setLiveModeStorage}
              lastUpdate={lastUpdate}
              nextUpdate={nextUpdate}
              updateCount={updateCount}
              loading={liveLoading}
            />

            {/* ═══ TABS ═══ */}
            <Tabs tabs={TABS} active={tab} onChange={setTab} />

            {/* ═══════════════════════════════ */}
            {/* TAB: PORTFOLIO */}
            {/* ═══════════════════════════════ */}
            {tab === "portfolio" && (
              <div className="space-y-3">
                {portfolio.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="text-5xl mb-3">💼</div>
                    <p className="text-gray-400 text-sm">ยังไม่มีหุ้นในพอร์ต</p>
                    <p className="text-gray-600 text-xs mt-1">ไปที่ "ค้นหา" เพื่อเพิ่มหุ้น</p>
                    <button onClick={() => setTab("search")} className="mt-4 px-5 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-medium transition-all">ค้นหาหุ้น</button>
                  </div>
                ) : (
                  <>
                    <PortfolioSummary items={portfolio} livePrices={livePrices} />
                    {portfolio.map(item => (
                      <PortfolioRow
                        key={item.symbol}
                        item={item}
                        livePrice={livePrices[item.symbol] || null}
                        onRemove={handleRemovePortfolio}
                        onEdit={(item) => setAddModal({ asset: assetMap[item.symbol] || item, existing: item })}
                      />
                    ))}
                  </>
                )}
              </div>
            )}

            {/* ═══════════════════════════════ */}
            {/* TAB: WATCHLIST */}
            {/* ═══════════════════════════════ */}
            {tab === "watchlist" && (
              <div className="space-y-3">
                {watchlist.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="text-5xl mb-3">⭐</div>
                    <p className="text-gray-400 text-sm">ยังไม่มีหุ้นใน Watchlist</p>
                    <button onClick={() => setTab("search")} className="mt-4 px-5 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-medium transition-all">ค้นหาหุ้น</button>
                  </div>
                ) : (
                  watchlist.map(item => {
                    const live = livePrices[item.symbol];
                    const base = assetMap[item.symbol] || item;
                    const price = live?.price ?? base.price ?? 0;
                    return (
                      <div key={item.symbol} className="bg-gray-800/40 border border-gray-700/30 rounded-xl p-4 hover:border-gray-600/50 transition-all">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-white font-bold">{item.symbol}</span>
                              {live && <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-800/40">Live</span>}
                              <Badge color={{ STOCK: "blue", ETF: "teal" }[base.type] || "gray"}>{base.type}</Badge>
                            </div>
                            <p className="text-gray-400 text-xs mt-0.5 truncate">{base.name}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-white font-semibold">{fmt.price(price)}</p>
                            {(live?.changePercent ?? base.changePercent) != null && (
                              <PriceChange
                                change={live?.change ?? base.change ?? 0}
                                pct={live?.changePercent ?? base.changePercent}
                              />
                            )}
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2 justify-end">
                          <button onClick={() => handleAddPortfolio(base)} className="text-xs px-3 py-1.5 rounded-lg bg-blue-900/40 border border-blue-800/30 text-blue-300 hover:bg-blue-900/60 transition-all">
                            {portfolioSymbols.has(item.symbol) ? "✓ ในพอร์ต" : "+ พอร์ต"}
                          </button>
                          <button onClick={() => handleToggleWatchlist(item)} className="text-xs px-3 py-1.5 rounded-lg bg-red-900/30 border border-red-800/30 text-red-400 hover:bg-red-900/50 transition-all">ลบ</button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ═══════════════════════════════ */}
            {/* TAB: SEARCH */}
            {/* ═══════════════════════════════ */}
            {tab === "search" && (
              <div className="space-y-4">
                <SearchBar
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="ค้นหา Symbol หรือชื่อบริษัท..."
                />

                {/* Filter Type */}
                <div className="flex gap-2 flex-wrap">
                  {["ALL", "STOCK", "ETF", "REIT", "BOND"].map(t => (
                    <button
                      key={t}
                      onClick={() => setFilterType(t)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filterType === t
                        ? "bg-blue-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 border border-gray-700/50"
                        }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* Results */}
                {!searchQuery && filterType === "ALL" ? (
                  <div className="text-center py-12">
                    <div className="text-4xl mb-3">🔍</div>
                    <p className="text-gray-400 text-sm">พิมพ์เพื่อค้นหาหุ้น</p>
                    <p className="text-gray-600 text-xs mt-1">มีหุ้นทั้งหมด {allAssets.length} ตัว</p>
                  </div>
                ) : filteredAssets.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-400 text-sm">ไม่พบ "{searchQuery}"</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500">พบ {filteredAssets.length} รายการ{filteredAssets.length === 50 ? " (แสดง 50 รายการแรก)" : ""}</p>
                    {filteredAssets.map(asset => (
                      <AssetCard
                        key={asset.symbol}
                        asset={asset}
                        onAdd={handleAddPortfolio}
                        onWatchlist={handleToggleWatchlist}
                        inPortfolio={portfolioSymbols.has(asset.symbol)}
                        inWatchlist={watchlistSymbols.has(asset.symbol)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* ═══ ADD MODAL ═══ */}
      {addModal && (
        <AddPortfolioModal
          asset={addModal.asset}
          existing={addModal.existing}
          onSave={handleSavePortfolio}
          onClose={() => setAddModal(null)}
        />
      )}

      {/* ═══ GOOGLE FONTS ═══ */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
      `}</style>
    </div>
  );
}
