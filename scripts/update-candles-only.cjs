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

// ── Twelve Data Batch Candle ──
async function fetchBatchCandles(symbols) {
  if (!TWELVE_KEY || symbols.length === 0) return {};
  try {
    const yesterday = new Date(Date.now() - 86400000);
    const endDate = yesterday.toISOString().split('T')[0];
    const url = `https://api.twelvedata.com/time_series?symbol=${symbols.join(',')}&interval=1day&outputsize=25&end_date=${endDate}&apikey=${TWELVE_KEY}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();

    const result = {};
    if (symbols.length === 1) {
      const sym = symbols[0];
      if (d && d.values && d.values.length > 0) {
        result[sym] = d.values.slice(0, 20).reverse().map(v => ({
          t: Math.floor(new Date(v.datetime).getTime() / 1000),
          o: parseFloat(v.open), h: parseFloat(v.high),
          l: parseFloat(v.low),  c: parseFloat(v.close),
          v: parseInt(v.volume) || 0,
        }));
        stats.success++;
      } else { stats.failed++; }
    } else {
      for (const sym of symbols) {
        const item = d[sym];
        if (item && item.values && item.values.length > 0) {
          result[sym] = item.values.slice(0, 20).reverse().map(v => ({
            t: Math.floor(new Date(v.datetime).getTime() / 1000),
            o: parseFloat(v.open), h: parseFloat(v.high),
            l: parseFloat(v.low),  c: parseFloat(v.close),
            v: parseInt(v.volume) || 0,
          }));
          stats.success++;
        } else { stats.failed++; }
      }
    }
    return result;
  } catch (err) {
    console.log(`  ❌ Batch error: ${err.message}`);
    symbols.forEach(() => stats.failed++);
    return {};
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
  const ordered   = [...priority, ...others];

  console.log(`[Priority] Portfolio: ${portfolio.join(', ') || 'none'}`);
  console.log(`[Priority] Watchlist: ${watchlist.join(', ') || 'none'}\n`);

  // Batch
  const batches = [];
  for (let i = 0; i < ordered.length; i += CONFIG.BATCH_SIZE) {
    batches.push(ordered.slice(i, i + CONFIG.BATCH_SIZE));
  }
  console.log(`${ordered.length} symbols → ${batches.length} batches (${CONFIG.BATCH_SIZE}/batch)\n`);

  const startTime = Date.now();

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    console.log(`📦 Batch ${b + 1}/${batches.length}: ${batch.length} symbols...`);

    const result = await fetchBatchCandles(batch);
    const ok = Object.keys(result);

    for (const sym of ok) {
      const idx = allData.findIndex(a => a.symbol === sym);
      if (idx >= 0) allData[idx].dailyCandles = result[sym];
    }

    console.log(`   ✅ ${ok.length} | ❌ ${batch.length - ok.length}`);

    if (ok.length > 0) {
      const s = ok[0], c = result[s];
      console.log(`   📊 ${s}: ${c.length} candles (${new Date(c[0].t*1000).toLocaleDateString()} → ${new Date(c[c.length-1].t*1000).toLocaleDateString()})`);
    }

    if (b < batches.length - 1) await sleep(CONFIG.TWELVE_DELAY);
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
