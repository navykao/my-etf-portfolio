// ============================================
// update-candles-only.cjs — รัน Phase 6 อย่างเดียว
// ดึง OHLC 20 วันจาก Twelve Data แล้วเขียนลง stocks.json + etfs.json
//
// วิธีรัน: node scripts/update-candles-only.cjs
// ต้องมี TWELVE_DATA_API_KEY ใน environment หรือ .env
// ============================================

const fs   = require('fs');
const path = require('path');

const CONFIG = {
  STOCKS_FILE:   path.join(__dirname, '..', 'public', 'data', 'stocks.json'),
  ETFS_FILE:     path.join(__dirname, '..', 'public', 'data', 'etfs.json'),
  TWELVE_DELAY:  1500,
  FETCH_TIMEOUT: 30000,
  BATCH_SIZE:    50,
};

const TWELVE_KEY = process.env.TWELVE_DATA_API_KEY
  || process.env.VITE_TWELVE_DATA_API_KEY
  || '';

const stats = { success: 0, failed: 0 };

async function fetchWithTimeout(url, ms = CONFIG.FETCH_TIMEOUT) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(tid);
    return res;
  } catch (err) { clearTimeout(tid); throw err; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Twelve Data Candle — ดึงทีละตัว (เสถียรกว่า batch บน free tier) ──
async function fetchSingleCandle(symbol) {
  if (!TWELVE_KEY) return null;
  try {
    const yesterday = new Date(Date.now() - 86400000);
    const endDate = yesterday.toISOString().split('T')[0];
    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1day&outputsize=25&end_date=${endDate}&apikey=${TWELVE_KEY}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();

    // Debug: แสดง response keys สำหรับตัวแรกๆ
    if (stats.success + stats.failed < 3) {
      console.log(`     [DEBUG] ${symbol} response keys: ${Object.keys(d).join(', ')}`);
      if (d.status) console.log(`     [DEBUG] status: ${d.status}, message: ${d.message || 'none'}`);
      if (d.values) console.log(`     [DEBUG] values count: ${d.values.length}`);
    }

    if (d && d.values && d.values.length > 0) {
      stats.success++;
      return d.values.slice(0, 20).reverse().map(v => ({
        t: Math.floor(new Date(v.datetime).getTime() / 1000),
        o: parseFloat(v.open), h: parseFloat(v.high),
        l: parseFloat(v.low),  c: parseFloat(v.close),
        v: parseInt(v.volume) || 0,
      }));
    }

    // Debug: แสดงเหตุผลที่ล้มเหลว
    if (d.code) console.log(`     [DEBUG] ${symbol} error: code=${d.code} message=${d.message}`);
    stats.failed++;
    return null;
  } catch (err) {
    if (stats.failed < 5) console.log(`     [DEBUG] ${symbol} fetch error: ${err.message}`);
    stats.failed++;
    return null;
  }
}

// ── MAIN ──
async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  🕯️  Candle-Only Update (Phase 6)                    ║');
  console.log('║  Twelve Data batch → OHLC 20 วัน (นับจากเมื่อวาน)  ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  if (!TWELVE_KEY) {
    console.error('❌ TWELVE_DATA_API_KEY is required!');
    process.exit(1);
  }
  console.log('[Config] Twelve Data API Key: ✅');
  console.log(`[Config] Batch size: ${CONFIG.BATCH_SIZE}\n`);

  // โหลดข้อมูล
  let stocksData, etfsData;
  try {
    stocksData = JSON.parse(fs.readFileSync(CONFIG.STOCKS_FILE, 'utf8'));
    etfsData   = JSON.parse(fs.readFileSync(CONFIG.ETFS_FILE, 'utf8'));
    console.log(`[Data] ✅ ${stocksData.length} stocks + ${etfsData.length} ETFs\n`);
  } catch (e) {
    console.error('❌ Failed to load data:', e.message);
    process.exit(1);
  }

  const allData = [...stocksData, ...etfsData];
  const allSymbols = allData.map(a => a.symbol);

  // Priority first
  const portfolio = etfsData.filter(e => e.inPortfolio).map(e => e.symbol);
  const watchlist = etfsData.filter(e => e.inWatchlist && !e.inPortfolio).map(e => e.symbol);
  const priority  = [...new Set([...portfolio, ...watchlist])];
  const others    = allSymbols.filter(s => !priority.includes(s));
  // ดึงเฉพาะ Priority (Portfolio + Watchlist) เท่านั้น
  // Twelve Data free = 8 req/min → 300 ตัวจะนานเกินไป
  // หุ้นที่ไม่อยู่ใน Watchlist ก็ไม่ได้ดูกราฟบน Dashboard อยู่แล้ว
  const ordered = [...priority];

  if (ordered.length === 0) {
    console.log('⚠️  ไม่มี Priority symbols (Portfolio/Watchlist) — ไม่ต้องดึง candle');
    return;
  }

  console.log(`[Priority] Portfolio: ${portfolio.join(', ') || 'none'}`);
  console.log(`[Priority] Watchlist: ${watchlist.join(', ') || 'none'}`);
  console.log(`\n🎯 ดึงเฉพาะ Priority ${ordered.length} ตัว (Twelve Data free = 8 req/min)\n`);
  console.log(`${ordered.length} symbols — ดึงทีละตัว (8 req/min safe)\n`);

  const startTime = Date.now();
  const DELAY = 8000; // 8s per request = safe for Twelve Data free (8 req/min)

  for (let i = 0; i < ordered.length; i++) {
    const sym = ordered[i];
    const idx = allData.findIndex(a => a.symbol === sym);
    if (idx < 0) continue;

    const candles = await fetchSingleCandle(sym);

    if (candles && candles.length > 0) {
      allData[idx].dailyCandles = candles;
      if (i < 5 || (i + 1) % 50 === 0) {
        const first = new Date(candles[0].t * 1000).toLocaleDateString();
        const last = new Date(candles[candles.length - 1].t * 1000).toLocaleDateString();
        console.log(`  ✅ ${sym}: ${candles.length} candles (${first} → ${last})`);
      }
    } else {
      if (stats.failed <= 10) {
        console.log(`  ⚠️  ${sym}: no candle data`);
      }
    }

    if ((i + 1) % 50 === 0) {
      const pct = (((i + 1) / ordered.length) * 100).toFixed(1);
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`\n  [Progress] ${i + 1}/${ordered.length} (${pct}%) | ✅ ${stats.success} | ❌ ${stats.failed} | ⏱️ ${elapsed}s\n`);
    }

    await sleep(DELAY);
  }

  // Save
  console.log('\n💾 Saving...');
  const updStocks = allData.filter(a => a.type === 'STOCK');
  const updEtfs   = allData.filter(a => a.type === 'ETF');

  const sJson = JSON.stringify(updStocks, null, 2);
  const eJson = JSON.stringify(updEtfs, null, 2);

  fs.writeFileSync(CONFIG.STOCKS_FILE, sJson, 'utf8');
  fs.writeFileSync(CONFIG.ETFS_FILE,   eJson, 'utf8');

  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  console.log(`✅ stocks.json: ${updStocks.length} items (${(Buffer.byteLength(sJson) / 1024).toFixed(1)} KB)`);
  console.log(`✅ etfs.json:   ${updEtfs.length} items (${(Buffer.byteLength(eJson) / 1024).toFixed(1)} KB)`);
  console.log(`\n🎉 Done! ✅ ${stats.success} | ❌ ${stats.failed} | ⏱️ ${elapsed}s`);
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });
