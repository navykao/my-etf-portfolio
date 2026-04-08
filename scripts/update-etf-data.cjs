/**
 * update-data.cjs
 * 
 * โครงสร้างไฟล์ที่แนะนำ:
 * ├── data/
 * │   ├── stocks-database.json     ← หุ้นรายตัว (AAPL, MSFT, ฯลฯ)
 * │   └── etf-database.json        ← ETF ทั้งหมด (VOO, SPY, ฯลฯ)
 * └── scripts/
 *     └── update-data.cjs          ← ไฟล์นี้
 * 
 * วิธีใช้:
 *   node scripts/update-data.cjs              → อัปเดตทุกอย่าง (ใช้ API)
 *   node scripts/update-data.cjs --csv        → import จาก StockAnalysis CSV เท่านั้น
 *   node scripts/update-data.cjs --force      → บังคับดึง API ใหม่ทั้งหมด (ข้าม cache)
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
const SA_CSV_PATH       = path.join(DATA_DIR, 'stockanalysis-export.csv'); // วาง CSV ที่ download จาก StockAnalysis ไว้ที่นี่

// ─── SYMBOLS ──────────────────────────────────────────────────────────────────
const ETF_SYMBOLS = [
  'VOO','SPY','QQQ','VTI','SCHD','VYM','JEPI','JEPQ',
  'VIG','DGRO','HDV','DVY','NOBL','SDY','VTV','MGK'
];

const STOCK_SYMBOLS = [
  'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA',
  'JPM','JNJ','PG','KO','PEP','MCD','WMT','HD'
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

// ─── CSV PARSER (จาก StockAnalysis) ──────────────────────────────────────────
/**
 * StockAnalysis CSV มี header แบบนี้ (ตัวอย่าง):
 * Symbol,Name,Price,Change %,Market Cap,P/E Ratio,Dividend Yield,...
 * 
 * ฟังก์ชันนี้อ่าน CSV แล้วรวมเข้า database ที่มีอยู่
 */
function importFromStockAnalysisCSV(csvPath, existingDB) {
  if (!fs.existsSync(csvPath)) {
    console.log(`⚠️  ไม่พบไฟล์ CSV: ${csvPath}`);
    console.log(`   → Download จาก stockanalysis.com แล้ววางไว้ที่ data/stockanalysis-export.csv`);
    return existingDB;
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const lines   = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

  // Map header ที่ StockAnalysis ใช้ → field ของเรา
  const fieldMap = {
    'Symbol':         'symbol',
    'Name':           'name',
    'Price':          'price',
    'Change %':       'changePercent',
    'Market Cap':     'marketCap',
    'P/E Ratio':      'peRatio',
    'Dividend Yield': 'divYield',
    'Revenue':        'revenue',
    'Net Income':     'netIncome',
    'Assets':         'assets',              // สำหรับ ETF
    'Expense Ratio':  'expenseRatio',        // สำหรับ ETF
    'Total Return 1Y':'totalReturn1Y',
    'Total Return 5Y':'totalReturn5Y',
    '5Y CAGR':        'cagr5Y',
    'Dividend Growth (5Y)': 'divGrowth5Y',
  };

  const db = { ...existingDB };
  let imported = 0;

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (!values || values.length < 2) continue;

    const row = {};
    headers.forEach((h, idx) => {
      const field = fieldMap[h] || h.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const val   = (values[idx] || '').replace(/"/g, '').trim();
      row[field]  = isNaN(val) || val === '' ? val : parseFloat(val);
    });

    if (!row.symbol) continue;

    const sym = row.symbol.toString().toUpperCase();
    db[sym] = {
      ...(db[sym] || {}),      // รักษาข้อมูลเดิม (เช่น ข้อมูลจาก API)
      ...row,
      source:    'stockanalysis-csv',
      updatedAt: new Date().toISOString(),
    };
    imported++;
  }

  console.log(`✅ Import จาก CSV สำเร็จ: ${imported} รายการ`);
  return db;
}

// CSV parser ที่รองรับ quoted fields (กรณีชื่อหุ้นมีเครื่องหมาย ,)
function parseCSVLine(line) {
  const result = [];
  let cur = '', inQuote = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === ',' && !inQuote) { result.push(cur); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

// ─── API FETCHERS ─────────────────────────────────────────────────────────────
async function fetchFromFinnhub(symbol) {
  try {
    const [quoteRes, metricsRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`),
      fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${FINNHUB_API_KEY}`)
    ]);
    const quote   = await quoteRes.json();
    const metrics = await metricsRes.json();

    if (quote.c > 0) {
      return {
        price:        quote.c,
        priceOpen:    quote.o,
        priceHigh:    quote.h,
        priceLow:     quote.l,
        prevClose:    quote.pc,
        changePercent:quote.c && quote.pc ? ((quote.c - quote.pc) / quote.pc * 100) : 0,
        divYield:     metrics.metric?.dividendYieldTTM   || 0,
        growthRate:   metrics.metric?.epsGrowth5Y        || 0,
        peRatio:      metrics.metric?.peBasicExclExtraTTM|| 0,
        marketCap:    metrics.metric?.marketCapitalization|| 0,
        source:       'finnhub',
        updatedAt:    new Date().toISOString(),
      };
    }
  } catch (e) {
    console.log(`   ⚠️  Finnhub error: ${e.message}`);
  }
  return null;
}

async function fetchFromEODHD(symbol) {
  try {
    const res  = await fetch(`https://eodhd.com/api/real-time/${symbol}.US?api_token=${EODHD_API_KEY}&fmt=json`);
    const data = await res.json();
    if (data.close > 0) {
      return {
        price:         data.close,
        priceOpen:     data.open  || 0,
        priceHigh:     data.high  || 0,
        priceLow:      data.low   || 0,
        prevClose:     data.previousClose || 0,
        changePercent: data.change_p || 0,
        volume:        data.volume || 0,
        source:        'eodhd',
        updatedAt:     new Date().toISOString(),
      };
    }
  } catch (e) {
    console.log(`   ⚠️  EODHD error: ${e.message}`);
  }
  return null;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const args        = process.argv.slice(2);
  const csvOnly     = args.includes('--csv');
  const forceUpdate = args.includes('--force');

  console.log('╔══════════════════════════════════════╗');
  console.log('║     Portfolio Database Updater       ║');
  console.log('╚══════════════════════════════════════╝\n');

  ensureDataDir();

  // โหลด database ที่มีอยู่
  let etfDB    = loadDB(ETF_DB_PATH);
  let stocksDB = loadDB(STOCKS_DB_PATH);

  // ── STEP 1: Import CSV จาก StockAnalysis ──────────────────────────────────
  console.log('📥 Step 1: Import CSV จาก StockAnalysis...');
  etfDB    = importFromStockAnalysisCSV(SA_CSV_PATH, etfDB);
  stocksDB = importFromStockAnalysisCSV(SA_CSV_PATH, stocksDB);

  if (csvOnly) {
    saveDB(ETF_DB_PATH,    etfDB);
    saveDB(STOCKS_DB_PATH, stocksDB);
    console.log('\n✅ CSV Import เสร็จสิ้น (--csv mode, ข้าม API)');
    return;
  }

  // ── STEP 2: อัปเดต ETF ด้วย API ───────────────────────────────────────────
  console.log('\n📊 Step 2: อัปเดต ETF prices จาก API...');
  let etfUpdated = 0, etfSkipped = 0;

  for (const symbol of ETF_SYMBOLS) {
    const cached = etfDB[symbol];

    // ข้าม cache ถ้ายังไม่เก่า
    if (!forceUpdate && cached?.updatedAt && !isCacheStale(cached.updatedAt)) {
      console.log(`   ⏩ ${symbol}: ใช้ cache (${cached.price?.toFixed(2)}) [อัปเดตล่าสุด: ${new Date(cached.updatedAt).toLocaleString('th-TH')}]`);
      etfSkipped++;
      continue;
    }

    console.log(`   🔄 ${symbol}: กำลังดึงข้อมูล...`);
    let data = await fetchFromFinnhub(symbol);
    if (!data) {
      console.log(`   ↳ Fallback → EODHD`);
      data = await fetchFromEODHD(symbol);
    }

    if (data) {
      etfDB[symbol] = { ...(etfDB[symbol] || {}), symbol, ...data };
      console.log(`   ✅ ${symbol}: $${data.price?.toFixed(2)} (yield: ${(data.divYield||0).toFixed(2)}%)`);
      etfUpdated++;
    } else {
      console.log(`   ❌ ${symbol}: ดึงข้อมูลไม่ได้`);
    }
    await sleep(API_DELAY_MS);
  }

  // ── STEP 3: อัปเดต Stocks ด้วย API ────────────────────────────────────────
  console.log('\n📈 Step 3: อัปเดต Stock prices จาก API...');
  let stockUpdated = 0, stockSkipped = 0;

  for (const symbol of STOCK_SYMBOLS) {
    const cached = stocksDB[symbol];

    if (!forceUpdate && cached?.updatedAt && !isCacheStale(cached.updatedAt)) {
      console.log(`   ⏩ ${symbol}: ใช้ cache ($${cached.price?.toFixed(2)})`);
      stockSkipped++;
      continue;
    }

    console.log(`   🔄 ${symbol}: กำลังดึงข้อมูล...`);
    let data = await fetchFromFinnhub(symbol);
    if (!data) {
      console.log(`   ↳ Fallback → EODHD`);
      data = await fetchFromEODHD(symbol);
    }

    if (data) {
      stocksDB[symbol] = { ...(stocksDB[symbol] || {}), symbol, ...data };
      console.log(`   ✅ ${symbol}: $${data.price?.toFixed(2)} (PE: ${(data.peRatio||0).toFixed(1)})`);
      stockUpdated++;
    } else {
      console.log(`   ❌ ${symbol}: ดึงข้อมูลไม่ได้`);
    }
    await sleep(API_DELAY_MS);
  }

  // ── STEP 4: บันทึก ─────────────────────────────────────────────────────────
  console.log('\n💾 Step 4: บันทึกลง database...');
  saveDB(ETF_DB_PATH,    etfDB);
  saveDB(STOCKS_DB_PATH, stocksDB);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║              สรุปผล                  ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  ETF    → อัปเดต: ${String(etfUpdated).padStart(2)}  ข้าม(cache): ${String(etfSkipped).padStart(2)}  ║`);
  console.log(`║  Stocks → อัปเดต: ${String(stockUpdated).padStart(2)}  ข้าม(cache): ${String(stockSkipped).padStart(2)}  ║`);
  console.log(`║  API calls ที่ประหยัดได้: ${String(etfSkipped+stockSkipped).padStart(2)} calls     ║`);
  console.log('╚══════════════════════════════════════╝');
  console.log(`\n📁 บันทึกแล้ว:`);
  console.log(`   ${ETF_DB_PATH}`);
  console.log(`   ${STOCKS_DB_PATH}`);
}

main().catch(console.error);
