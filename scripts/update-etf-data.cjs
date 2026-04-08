/**
 * update-etf-data.cjs
 * 
 * โครงสร้างไฟล์:
 * ├── data/
 * │   ├── etf-database.json        ← ETF ทั้งหมด (VOO, SPY, ฯลฯ)
 * │   ├── stocks-database.json     ← หุ้นรายตัว (AAPL, MSFT, ฯลฯ)
 * │   └── stockanalysis-export.csv ← วาง CSV ที่ download จาก StockAnalysis
 * └── scripts/
 *     └── update-etf-data.cjs      ← ไฟล์นี้
 * 
 * วิธีใช้:
 *   node scripts/update-etf-data.cjs              → อัปเดตทุกอย่าง
 *   node scripts/update-etf-data.cjs --csv        → import จาก CSV เท่านั้น (ไม่ใช้ API)
 *   node scripts/update-etf-data.cjs --force      → บังคับดึง API ใหม่ทั้งหมด
 */

const fs = require('fs');
const path = require('path');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const EODHD_API_KEY   = process.env.EODHD_API_KEY;

const CACHE_TTL_HOURS = 23;   // ดึง API ใหม่ถ้าข้อมูลเกิน 23 ชั่วโมง
const API_DELAY_MS    = 1200; // หน่วงเวลาระหว่าง API call (ms)

// ─── PATH ─────────────────────────────────────────────────────────────────────
const DATA_DIR          = path.join(__dirname, '..', 'data');
const ETF_DB_PATH       = path.join(DATA_DIR, 'etf-database.json');
const STOCKS_DB_PATH    = path.join(DATA_DIR, 'stocks-database.json');
const SA_CSV_PATH       = path.join(DATA_DIR, 'stockanalysis-export.csv');

// ─── SYMBOLS ที่ต้องการดึง API (เฉพาะตัวสำคัญ) ───────────────────────────────
// ETF หลักที่ต้องการราคา real-time
const ETF_SYMBOLS = [
  'VOO','SPY','QQQ','VTI','SCHD','VYM','JEPI','JEPQ',
  'VIG','DGRO','HDV','DVY','NOBL','SDY','VTV','MGK',
  'IVV','ITOT','VUG','VTV','BND','VXUS','VEA','VWO'
];

// หุ้นรายตัวที่ต้องการดึง API
const STOCK_SYMBOLS = [
  'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA',
  'JPM','JNJ','PG','KO','PEP','MCD','WMT','HD',
  'V','MA','UNH','DIS','NFLX','AMD','INTC','CRM'
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDB(filePath) {
  if (fs.existsSync(filePath)) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } 
    catch { return {}; }
  }
  return {};
}

function saveDB(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function isCacheStale(updatedAt) {
  if (!updatedAt) return true;
  const diffHours = (Date.now() - new Date(updatedAt).getTime()) / 3600000;
  return diffHours >= CACHE_TTL_HOURS;
}

// ─── CSV PARSER ───────────────────────────────────────────────────────────────
/**
 * รองรับ CSV จาก StockAnalysis ที่มี header:
 * Symbol,Fund Name,Assets,Stock Price,% Change,Change 1W,Change 1M,...
 */
function importFromCSV(csvPath) {
  if (!fs.existsSync(csvPath)) {
    console.log(`⚠️  ไม่พบไฟล์ CSV: ${csvPath}`);
    console.log(`   → Download จาก stockanalysis.com แล้ววางไว้ที่ data/stockanalysis-export.csv`);
    return {};
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.trim().replace(/\r/g, '').split('\n');
  const headers = parseCSVLine(lines[0]);

  // Map header → field name
  const fieldMap = {
    'Symbol': 'symbol',
    'Fund Name': 'name',
    'Name': 'name',
    'Assets': 'assets',
    'Stock Price': 'price',
    'Price': 'price',
    '% Change': 'changePercent',
    'Change %': 'changePercent',
    'Change 1W': 'change1W',
    'Change 1M': 'change1M',
    'Change 6M': 'change6M',
    'Change YTD': 'changeYTD',
    'Change 1Y': 'change1Y',
    'Change 3Y': 'change3Y',
    'Change 5Y': 'change5Y',
    'Change 10Y': 'change10Y',
    'Dividend Yield': 'divYield',
    'Expense Ratio': 'expenseRatio',
    'P/E Ratio': 'peRatio',
    'Market Cap': 'marketCap',
  };

  const db = {};
  let imported = 0;

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (!values || values.length < 2) continue;

    const row = {};
    headers.forEach((h, idx) => {
      const field = fieldMap[h] || h.toLowerCase().replace(/[^a-z0-9]/g, '_');
      let val = (values[idx] || '').trim();
      
      // ลบ % และ parse เป็นตัวเลข
      if (val.endsWith('%')) val = val.slice(0, -1);
      row[field] = isNaN(val) || val === '' ? val : parseFloat(val);
    });

    if (!row.symbol) continue;

    const sym = row.symbol.toString().toUpperCase();
    db[sym] = {
      ...row,
      source: 'csv',
      updatedAt: new Date().toISOString(),
    };
    imported++;
  }

  console.log(`✅ Import จาก CSV สำเร็จ: ${imported} รายการ`);
  return db;
}

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQuote = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur.trim());
  return result;
}

// ─── API FETCHERS ─────────────────────────────────────────────────────────────
async function fetchFromFinnhub(symbol) {
  try {
    const [quoteRes, metricsRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`),
      fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${FINNHUB_API_KEY}`)
    ]);
    const quote = await quoteRes.json();
    const metrics = await metricsRes.json();

    if (quote.c > 0) {
      return {
        price: quote.c,
        priceOpen: quote.o,
        priceHigh: quote.h,
        priceLow: quote.l,
        prevClose: quote.pc,
        changePercent: quote.c && quote.pc ? ((quote.c - quote.pc) / quote.pc * 100) : 0,
        divYield: metrics.metric?.dividendYieldTTM || 0,
        growthRate: metrics.metric?.epsGrowth5Y || 0,
        peRatio: metrics.metric?.peBasicExclExtraTTM || 0,
        marketCap: metrics.metric?.marketCapitalization || 0,
        source: 'finnhub',
        updatedAt: new Date().toISOString(),
      };
    }
  } catch (e) {
    console.log(`   ⚠️  Finnhub error: ${e.message}`);
  }
  return null;
}

async function fetchFromEODHD(symbol) {
  try {
    const res = await fetch(`https://eodhd.com/api/real-time/${symbol}.US?api_token=${EODHD_API_KEY}&fmt=json`);
    const data = await res.json();
    if (data.close > 0) {
      return {
        price: data.close,
        priceOpen: data.open || 0,
        priceHigh: data.high || 0,
        priceLow: data.low || 0,
        prevClose: data.previousClose || 0,
        changePercent: data.change_p || 0,
        volume: data.volume || 0,
        source: 'eodhd',
        updatedAt: new Date().toISOString(),
      };
    }
  } catch (e) {
    console.log(`   ⚠️  EODHD error: ${e.message}`);
  }
  return null;
}

// ─── UPDATE SYMBOLS WITH API ──────────────────────────────────────────────────
async function updateSymbolsWithAPI(symbols, existingDB, forceUpdate, label) {
  console.log(`\n📊 อัปเดต ${label} จาก API...`);
  let updated = 0, skipped = 0;

  for (const symbol of symbols) {
    const cached = existingDB[symbol];

    if (!forceUpdate && cached?.updatedAt && !isCacheStale(cached.updatedAt)) {
      console.log(`   ⏩ ${symbol}: ใช้ cache ($${cached.price?.toFixed(2)})`);
      skipped++;
      continue;
    }

    console.log(`   🔄 ${symbol}: กำลังดึงข้อมูล...`);
    let data = await fetchFromFinnhub(symbol);
    if (!data) {
      console.log(`   ↳ Fallback → EODHD`);
      data = await fetchFromEODHD(symbol);
    }

    if (data) {
      existingDB[symbol] = { ...(existingDB[symbol] || {}), symbol, ...data };
      console.log(`   ✅ ${symbol}: $${data.price?.toFixed(2)}`);
      updated++;
    } else {
      console.log(`   ❌ ${symbol}: ดึงข้อมูลไม่ได้`);
    }
    await sleep(API_DELAY_MS);
  }

  return { updated, skipped, db: existingDB };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const csvOnly = args.includes('--csv');
  const forceUpdate = args.includes('--force');

  console.log('╔════════════════════════════════════════╗');
  console.log('║     📊 Portfolio Database Updater      ║');
  console.log('╚════════════════════════════════════════╝\n');

  ensureDataDir();

  // โหลด database ที่มีอยู่
  let etfDB = loadDB(ETF_DB_PATH);
  let stocksDB = loadDB(STOCKS_DB_PATH);

  // ── STEP 1: Import CSV ──────────────────────────────────────────────────────
  console.log('📥 Step 1: Import CSV จาก StockAnalysis...');
  const csvData = importFromCSV(SA_CSV_PATH);
  
  // แยก ETF และ Stock (ถ้ามี name มี "ETF" ถือว่าเป็น ETF)
  Object.entries(csvData).forEach(([sym, data]) => {
    if (data.name && (data.name.includes('ETF') || data.assets)) {
      etfDB[sym] = { ...etfDB[sym], ...data };
    } else {
      stocksDB[sym] = { ...stocksDB[sym], ...data };
    }
  });

  if (csvOnly) {
    saveDB(ETF_DB_PATH, etfDB);
    saveDB(STOCKS_DB_PATH, stocksDB);
    console.log(`\n✅ CSV Import เสร็จสิ้น (--csv mode)`);
    console.log(`   ETF: ${Object.keys(etfDB).length} รายการ`);
    console.log(`   Stocks: ${Object.keys(stocksDB).length} รายการ`);
    return;
  }

  // ── STEP 2: อัปเดต ETF ด้วย API ─────────────────────────────────────────────
  const etfResult = await updateSymbolsWithAPI(ETF_SYMBOLS, etfDB, forceUpdate, 'ETF');
  etfDB = etfResult.db;

  // ── STEP 3: อัปเดต Stocks ด้วย API ──────────────────────────────────────────
  const stockResult = await updateSymbolsWithAPI(STOCK_SYMBOLS, stocksDB, forceUpdate, 'Stocks');
  stocksDB = stockResult.db;

  // ── STEP 4: บันทึก ──────────────────────────────────────────────────────────
  console.log('\n💾 Step 4: บันทึกลง database...');
  saveDB(ETF_DB_PATH, etfDB);
  saveDB(STOCKS_DB_PATH, stocksDB);

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║               📊 สรุปผล                ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║  ETF ใน database:    ${String(Object.keys(etfDB).length).padStart(3)} รายการ       ║`);
  console.log(`║  Stocks ใน database: ${String(Object.keys(stocksDB).length).padStart(3)} รายการ       ║`);
  console.log('╠════════════════════════════════════════╣');
  console.log(`║  API อัปเดต: ETF ${etfResult.updated} + Stock ${stockResult.updated}      ║`);
  console.log(`║  ใช้ Cache:  ETF ${etfResult.skipped} + Stock ${stockResult.skipped}      ║`);
  console.log('╚════════════════════════════════════════╝');
  console.log(`\n📁 ไฟล์ที่บันทึก:`);
  console.log(`   ${ETF_DB_PATH}`);
  console.log(`   ${STOCKS_DB_PATH}`);
}

main().catch(console.error);
