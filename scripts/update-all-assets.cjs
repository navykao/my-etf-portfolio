#!/usr/bin/env node

/**
 * =====================================================
 * update-all-assets.cjs v5.0 (Unified + 3-Tier Fallback)
 * =====================================================
 * รวมทุกระบบเป็นตัวเดียว:
 * - อัพเดทหุ้น + ETF ทุกวัน
 * - รวม divGrowth จาก stockanalysis
 * - รวม etf-database เข้าด้วยกัน
 * 
 * API Priority (ฟรีทั้งหมด):
 *   1. Yahoo Finance (เร็ว batch 50 ตัว, ฟรี ไม่จำกัด)
 *   2. Finnhub (60 calls/นาที, ไม่จำกัด/วัน)
 *   3. Twelve Data (800 credits/วัน, เฉพาะหุ้น)
 * 
 * Output:
 *   - data/combined-all-assets.json (ข้อมูลรวมทั้งหมด)
 *   - data/combined-all-assets.csv
 *   - data/etf-database.json (อัพเดท ETF database เดิม)
 * =====================================================
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// =====================================================
// Configuration
// =====================================================
const FINNHUB_KEY = process.env.FINNHUB_API_KEY || '';
const TWELVE_KEY = process.env.TWELVE_DATA_API_KEY || '';

const SCRIPT_DIR = __dirname;
const DATA_DIR = path.join(SCRIPT_DIR, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// =====================================================
// Load Symbol Lists
// =====================================================
function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const stocksRaw = loadJSON(path.join(SCRIPT_DIR, 'sp500-symbols.json'));
const etfRaw = loadJSON(path.join(SCRIPT_DIR, 'top250-etf-symbols.json'));
const divGrowthData = loadJSON(path.join(DATA_DIR, 'stockanalysis-divgrowth.json')) || {};
const etfDbRaw = loadJSON(path.join(DATA_DIR, 'etf-database.json'));

const sp500Symbols = stocksRaw ? [...new Set((stocksRaw.symbols || stocksRaw).map(s => s.replace('.', '-')))] : [];
const etfSymbols = etfRaw ? [...new Set(etfRaw.symbols || etfRaw)] : [];

// รวม ETF จาก etf-database ที่อาจไม่อยู่ใน top250
const etfDbSymbols = etfDbRaw ? Object.keys(etfDbRaw.data || {}) : [];
const allETFSymbols = [...new Set([...etfSymbols, ...etfDbSymbols])];

console.log('📊 Loaded:');
console.log('   Stocks: ' + sp500Symbols.length);
console.log('   ETFs: ' + allETFSymbols.length + ' (top250: ' + etfSymbols.length + ' + etf-db: ' + etfDbSymbols.length + ')');
console.log('   DivGrowth: ' + Object.keys(divGrowthData).length + ' symbols');

// =====================================================
// HTTP Helper
// =====================================================
function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      }, headers || {})
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ data, statusCode: res.statusCode, headers: res.headers, cookies: res.headers['set-cookie'] || [] }));
    }).on('error', reject);
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// =====================================================
// API 1: Yahoo Finance (Primary - ฟรี ไม่จำกัด)
// =====================================================
async function yahooGetAuth() {
  const r1 = await httpsGet('https://fc.yahoo.com');
  const cookieStr = r1.cookies.map(c => c.split(';')[0]).join('; ');
  const r2 = await httpsGet('https://query2.finance.yahoo.com/v1/test/getcrumb', { 'Cookie': cookieStr });
  if (r2.statusCode !== 200 || !r2.data.trim()) throw new Error('Yahoo auth failed');
  return { cookie: cookieStr, crumb: r2.data.trim() };
}

async function yahooFetchBatch(symbols, auth) {
  const url = 'https://query2.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(symbols.join(',')) + '&crumb=' + encodeURIComponent(auth.crumb);
  const res = await httpsGet(url, { 'Cookie': auth.cookie });
  if (res.statusCode !== 200) throw new Error('HTTP ' + res.statusCode);
  const json = JSON.parse(res.data);
  if (!json.quoteResponse || !json.quoteResponse.result) throw new Error('Invalid response');
  return json.quoteResponse.result;
}

function yahooFormat(q) {
  return {
    symbol: q.symbol,
    name: q.shortName || q.longName || q.symbol,
    price: q.regularMarketPrice || 0,
    change: q.regularMarketChange || 0,
    changePercent: q.regularMarketChangePercent || 0,
    divYield: (q.trailingAnnualDividendYield || 0) * 100,
    trailingDividendRate: q.trailingAnnualDividendRate || 0,
    peRatio: q.trailingPE || 0,
    eps: q.epsTrailingTwelveMonths || 0,
    marketCap: q.marketCap || 0,
    volume: q.regularMarketVolume || 0,
    avgVolume: q.averageDailyVolume10Day || 0,
    high52w: q.fiftyTwoWeekHigh || 0,
    low52w: q.fiftyTwoWeekLow || 0,
    dayHigh: q.regularMarketDayHigh || 0,
    dayLow: q.regularMarketDayLow || 0,
    open: q.regularMarketOpen || 0,
    previousClose: q.regularMarketPreviousClose || 0,
  };
}

async function fetchViaYahoo(symbols) {
  console.log('');
  console.log('🟡 [Yahoo Finance] Fetching ' + symbols.length + ' symbols...');
  
  const auth = await yahooGetAuth();
  console.log('   Auth: ✅');
  
  const results = [];
  const failed = [];
  const chunks = chunkArray(symbols, 50);
  
  for (let i = 0; i < chunks.length; i++) {
    let retries = 2;
    let success = false;
    while (retries >= 0 && !success) {
      try {
        const data = await yahooFetchBatch(chunks[i], auth);
        if (data.length > 0) {
          results.push(...data.map(yahooFormat));
          console.log('   ✅ Batch ' + (i + 1) + '/' + chunks.length + ' — ' + data.length + ' results');
          success = true;
        } else { throw new Error('Empty'); }
      } catch (e) {
        retries--;
        if (retries >= 0) { await delay(3000); }
        else { failed.push(...chunks[i]); console.log('   ❌ Batch ' + (i + 1) + ' failed'); }
      }
    }
    if (i < chunks.length - 1) await delay(1500);
  }
  
  console.log('   📊 Got ' + results.length + '/' + symbols.length);
  return { results, failed };
}

// =====================================================
// API 2: Finnhub (Backup 1 - ฟรี 60/นาที ไม่จำกัด/วัน)
// =====================================================
async function finnhubFetchSingle(symbol) {
  if (!FINNHUB_KEY) return null;
  const url = 'https://finnhub.io/api/v1/quote?symbol=' + symbol + '&token=' + FINNHUB_KEY;
  const res = await httpsGet(url);
  if (res.statusCode !== 200) return null;
  const q = JSON.parse(res.data);
  if (!q || q.c === 0) return null;
  return {
    symbol: symbol,
    name: symbol,
    price: q.c || 0,
    change: q.d || 0,
    changePercent: q.dp || 0,
    divYield: 0,
    trailingDividendRate: 0,
    peRatio: 0,
    eps: 0,
    marketCap: 0,
    volume: 0,
    avgVolume: 0,
    high52w: q.h || 0,
    low52w: q.l || 0,
    dayHigh: q.h || 0,
    dayLow: q.l || 0,
    open: q.o || 0,
    previousClose: q.pc || 0,
  };
}

async function fetchViaFinnhub(symbols) {
  if (!FINNHUB_KEY) { console.log('🔴 [Finnhub] No API key, skipping'); return { results: [], failed: symbols }; }
  console.log('🟠 [Finnhub] Fetching ' + symbols.length + ' symbols (60/min)...');
  
  const results = [];
  const failed = [];
  
  for (let i = 0; i < symbols.length; i++) {
    const data = await finnhubFetchSingle(symbols[i]);
    if (data) { results.push(data); }
    else { failed.push(symbols[i]); }
    
    if ((i + 1) % 50 === 0) console.log('   ⏳ ' + (i + 1) + '/' + symbols.length);
    
    // 60 calls/min = 1 call per second
    if (i < symbols.length - 1) await delay(1100);
  }
  
  console.log('   📊 Got ' + results.length + '/' + symbols.length);
  return { results, failed };
}

// =====================================================
// API 3: Twelve Data (Backup 2 - ฟรี 800/วัน เฉพาะหุ้น)
// =====================================================
async function fetchViaTwelveData(symbols) {
  if (!TWELVE_KEY) { console.log('🔴 [Twelve Data] No API key, skipping'); return { results: [], failed: symbols }; }
  console.log('🟣 [Twelve Data] Fetching ' + symbols.length + ' symbols...');
  
  const results = [];
  const failed = [];
  const chunks = chunkArray(symbols, 50);
  
  for (let i = 0; i < chunks.length; i++) {
    try {
      const symbolList = chunks[i].join(',');
      const url = 'https://api.twelvedata.com/quote?symbol=' + symbolList + '&apikey=' + TWELVE_KEY;
      const res = await httpsGet(url);
      const json = JSON.parse(res.data);
      
      for (const sym of chunks[i]) {
        const q = json[sym] || json;
        if (q && q.close && q.close !== '0') {
          results.push({
            symbol: sym,
            name: q.name || sym,
            price: parseFloat(q.close) || 0,
            change: parseFloat(q.change) || 0,
            changePercent: parseFloat(q.percent_change) || 0,
            divYield: 0, trailingDividendRate: 0, peRatio: 0, eps: 0,
            marketCap: 0, volume: parseInt(q.volume) || 0, avgVolume: 0,
            high52w: parseFloat(q.fifty_two_week?.high) || 0,
            low52w: parseFloat(q.fifty_two_week?.low) || 0,
            dayHigh: parseFloat(q.high) || 0, dayLow: parseFloat(q.low) || 0,
            open: parseFloat(q.open) || 0, previousClose: parseFloat(q.previous_close) || 0,
          });
        } else { failed.push(sym); }
      }
      console.log('   ✅ Batch ' + (i + 1) + '/' + chunks.length);
    } catch (e) {
      failed.push(...chunks[i]);
      console.log('   ❌ Batch ' + (i + 1) + ' error');
    }
    if (i < chunks.length - 1) await delay(8000); // 8 calls/min limit
  }
  
  console.log('   📊 Got ' + results.length + '/' + symbols.length);
  return { results, failed };
}

// =====================================================
// 3-Tier Fallback System
// =====================================================
async function fetchWithFallback(symbols) {
  // Tier 1: Yahoo Finance
  let result;
  try {
    result = await fetchViaYahoo(symbols);
  } catch (e) {
    console.log('   ❌ Yahoo Finance failed: ' + e.message.substring(0, 60));
    result = { results: [], failed: symbols };
  }
  
  if (result.failed.length === 0) return result.results;
  
  // Tier 2: Finnhub (for remaining)
  console.log('');
  console.log('⚡ ' + result.failed.length + ' symbols failed, trying Finnhub...');
  let tier2;
  try {
    tier2 = await fetchViaFinnhub(result.failed);
  } catch (e) {
    console.log('   ❌ Finnhub failed: ' + e.message);
    tier2 = { results: [], failed: result.failed };
  }
  
  const combined = [...result.results, ...tier2.results];
  if (tier2.failed.length === 0) return combined;
  
  // Tier 3: Twelve Data (for remaining)
  console.log('');
  console.log('⚡ ' + tier2.failed.length + ' symbols still failed, trying Twelve Data...');
  let tier3;
  try {
    tier3 = await fetchViaTwelveData(tier2.failed);
  } catch (e) {
    console.log('   ❌ Twelve Data failed: ' + e.message);
    tier3 = { results: [], failed: tier2.failed };
  }
  
  return [...combined, ...tier3.results];
}

// =====================================================
// Merge divGrowth Data
// =====================================================
function enrichWithDivGrowth(asset) {
  const dg = divGrowthData[asset.symbol];
  if (dg) {
    asset.divGrowth3Y = dg.divGrowth3Y || null;
    asset.divGrowth5Y = dg.divGrowth5Y || null;
    asset.divGrowth10Y = dg.divGrowth10Y || null;
  } else {
    asset.divGrowth3Y = null;
    asset.divGrowth5Y = null;
    asset.divGrowth10Y = null;
  }
  return asset;
}

// =====================================================
// Calculate Growth Rate from Yahoo v8 chart
// =====================================================
async function fetchGrowthRate(symbol) {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?interval=1d&range=1y';
    const res = await httpsGet(url);
    if (res.statusCode !== 200) return null;
    const json = JSON.parse(res.data);
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(c => c !== null);
    if (!closes || closes.length < 2) return null;
    return parseFloat((((closes[closes.length - 1] - closes[0]) / closes[0]) * 100).toFixed(2));
  } catch { return null; }
}

// =====================================================
// Main
// =====================================================
async function main() {
  const startTime = Date.now();
  
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Update All Assets v5.0 (Unified)       ║');
  console.log('║  Yahoo → Finnhub → Twelve Data          ║');
  console.log('║  ฟรีทั้งหมด ไม่เสียตัง!                     ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('📅 ' + new Date().toISOString());
  console.log('');
  
  // Combine all unique symbols
  const typeMap = {};
  sp500Symbols.forEach(s => { typeMap[s] = 'STOCK'; });
  allETFSymbols.forEach(s => { if (!typeMap[s]) typeMap[s] = 'ETF'; });
  const allSymbols = [...new Set([...sp500Symbols, ...allETFSymbols])];
  
  console.log('🎯 Total unique symbols: ' + allSymbols.length);
  console.log('   Stocks: ' + sp500Symbols.length + ' | ETFs: ' + allETFSymbols.length);
  
  // ==========================================
  // Fetch all data with 3-tier fallback
  // ==========================================
  const rawResults = await fetchWithFallback(allSymbols);
  
  // ==========================================
  // Enrich with type + divGrowth
  // ==========================================
  console.log('');
  console.log('🔗 Enriching with divGrowth data...');
  
  const enrichedResults = rawResults.map(asset => {
    asset.type = typeMap[asset.symbol] || 'STOCK';
    asset.updatedAt = new Date().toISOString();
    asset.growthRate = 0; // จะคำนวณทีหลังถ้าต้องการ
    return enrichWithDivGrowth(asset);
  });
  
  // Deduplicate
  const seen = new Set();
  const uniqueAssets = enrichedResults.filter(a => {
    if (seen.has(a.symbol)) return false;
    seen.add(a.symbol);
    return true;
  });
  
  if (uniqueAssets.length === 0) {
    console.error('❌ No data fetched from any API!');
    process.exit(1);
  }
  
  // ==========================================
  // Save combined-all-assets.json
  // ==========================================
  console.log('');
  console.log('💾 Saving files...');
  
  const jsonPath = path.join(DATA_DIR, 'combined-all-assets.json');
  fs.writeFileSync(jsonPath, JSON.stringify(uniqueAssets, null, 2));
  console.log('   ✅ ' + jsonPath);
  
  // Save CSV
  const csvPath = path.join(DATA_DIR, 'combined-all-assets.csv');
  const header = 'Symbol,Name,Type,Price,Change,ChangePercent,DivYield,DivGrowth3Y,DivGrowth5Y,DivGrowth10Y,TrailingDivRate,GrowthRate,PERatio,EPS,MarketCap,Volume,AvgVolume,High52w,Low52w,DayHigh,DayLow,Open,PreviousClose,UpdatedAt';
  const rows = uniqueAssets.map(a => {
    const name = (a.name || '').replace(/[",]/g, ' ');
    return [a.symbol, '"' + name + '"', a.type, a.price, a.change, (a.changePercent||0).toFixed(2), (a.divYield||0).toFixed(2), a.divGrowth3Y ?? '', a.divGrowth5Y ?? '', a.divGrowth10Y ?? '', (a.trailingDividendRate||0).toFixed(3), a.growthRate, (a.peRatio||0).toFixed(2), a.eps, a.marketCap, a.volume, a.avgVolume, a.high52w, a.low52w, a.dayHigh, a.dayLow, a.open, a.previousClose, a.updatedAt].join(',');
  });
  fs.writeFileSync(csvPath, header + '\n' + rows.join('\n'));
  console.log('   ✅ ' + csvPath);
  
  // ==========================================
  // Update etf-database.json (keep old format)
  // ==========================================
  const etfAssets = uniqueAssets.filter(a => a.type === 'ETF');
  if (etfAssets.length > 0 && etfDbRaw) {
    const updatedEtfDb = {
      _meta: {
        lastUpdate: new Date().toISOString(),
        totalSymbols: etfAssets.length,
        dataSource: 'unified-v5 (yahoo+finnhub+twelvedata)'
      },
      data: {}
    };
    
    for (const etf of etfAssets) {
      const old = (etfDbRaw.data || {})[etf.symbol] || {};
      updatedEtfDb.data[etf.symbol] = {
        symbol: etf.symbol,
        name: etf.name,
        price: etf.price,
        divYield: etf.divYield,
        growthRate: old.growthRate || etf.growthRate || 0,
        divGrowth3Y: etf.divGrowth3Y ?? old.divGrowth3Y ?? null,
        divGrowth5Y: etf.divGrowth5Y ?? old.divGrowth5Y ?? null,
        divGrowth10Y: etf.divGrowth10Y ?? old.divGrowth10Y ?? null,
        trailingDividendRate: etf.trailingDividendRate || old.trailingDividendRate || 0,
        totalAssets: old.totalAssets || 0,
        fiftyTwoWeekHigh: etf.high52w,
        fiftyTwoWeekLow: etf.low52w,
        updatedAt: etf.updatedAt,
        source: 'unified-v5'
      };
    }
    
    const etfDbPath = path.join(DATA_DIR, 'etf-database.json');
    fs.writeFileSync(etfDbPath, JSON.stringify(updatedEtfDb, null, 2));
    console.log('   ✅ ' + etfDbPath + ' (' + etfAssets.length + ' ETFs)');
  }
  
  // Also save old format for backward compatibility
  const oldJsonPath = path.join(DATA_DIR, 'combined-746-assets.json');
  fs.writeFileSync(oldJsonPath, JSON.stringify(uniqueAssets, null, 2));
  const oldCsvPath = path.join(DATA_DIR, 'combined-746-assets.csv');
  fs.writeFileSync(oldCsvPath, header + '\n' + rows.join('\n'));
  console.log('   ✅ ' + oldJsonPath + ' (backward compat)');
  
  // ==========================================
  // Summary
  // ==========================================
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const stocks = uniqueAssets.filter(a => a.type === 'STOCK');
  const etfs = uniqueAssets.filter(a => a.type === 'ETF');
  const withDivGrowth = uniqueAssets.filter(a => a.divGrowth5Y !== null);
  
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  ✅ DONE!                                ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  📊 Total:      ' + String(uniqueAssets.length).padStart(5) + ' assets             ║');
  console.log('║  📈 Stocks:     ' + String(stocks.length).padStart(5) + '                     ║');
  console.log('║  📊 ETFs:       ' + String(etfs.length).padStart(5) + '                     ║');
  console.log('║  💰 DivGrowth:  ' + String(withDivGrowth.length).padStart(5) + ' symbols           ║');
  console.log('║  ⏱️  Time:       ' + String(elapsed + 's').padStart(5) + '                     ║');
  console.log('║  💵 Cost:        $0.00                   ║');
  console.log('╚══════════════════════════════════════════╝');
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
