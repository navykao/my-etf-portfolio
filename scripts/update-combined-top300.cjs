#!/usr/bin/env node

/**
 * =====================================================
 * update-combined-top300.cjs v2.0 (BATCH API Version)
 * =====================================================
 * 
 * ปัญหาเดิม: เรียก API ทีละตัว = 560 calls/รัน
 * EODHD Free Plan มีแค่ 20 calls/วัน → เกินลิมิต!
 * 
 * แก้ไข: ใช้ Batch API
 * - FMP: ส่ง symbols หลายตัวใน 1 request (comma-separated)
 * - EODHD: ใช้ Bulk API ดึงทั้ง exchange ใน 1 request
 * 
 * API Calls ที่ใช้:
 * - FMP Batch: ~6 requests (250 ETFs ÷ 50 ต่อ batch)
 * - EODHD: ใช้ FMP แทน (เพื่อประหยัด EODHD calls)
 * - รวม: ~12 API calls แทน 560 calls!
 * =====================================================
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// =====================================================
// Configuration
// =====================================================
const EODHD_API_KEY = process.env.EODHD_API_KEY;
const FMP_API_KEY = process.env.FMP0N8_API_KEY;

if (!FMP_API_KEY) {
  console.error('❌ Error: FMP0N8_API_KEY not found');
  console.error('Please set FMP0N8_API_KEY in GitHub Secrets');
  process.exit(1);
}

if (!EODHD_API_KEY) {
  console.warn('⚠️ Warning: EODHD_API_KEY not found (will use FMP for all data)');
}

// =====================================================
// Load Symbols
// =====================================================
const stocksPath = path.join(__dirname, 'sp500-symbols-top300.json');
const etfPath = path.join(__dirname, 'top250-etf-symbols.json');

if (!fs.existsSync(stocksPath)) {
  console.error('❌ Error: sp500-symbols-top300.json not found');
  process.exit(1);
}
if (!fs.existsSync(etfPath)) {
  console.error('❌ Error: top250-etf-symbols.json not found');
  process.exit(1);
}

const stocksRaw = JSON.parse(fs.readFileSync(stocksPath, 'utf8'));
const etfRaw = JSON.parse(fs.readFileSync(etfPath, 'utf8'));

const sp500Symbols = stocksRaw.symbols || stocksRaw;
const etfSymbols = etfRaw.symbols || etfRaw;

// Remove duplicates
const uniqueStocks = [...new Set(sp500Symbols)];
const uniqueETFs = [...new Set(etfSymbols)];

console.log('📊 Loaded ' + uniqueStocks.length + ' stocks + ' + uniqueETFs.length + ' ETFs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// =====================================================
// Helper Functions
// =====================================================

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('JSON parse error: ' + data.substring(0, 200)));
        }
      });
    }).on('error', reject);
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Split array into chunks of specified size
 */
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// =====================================================
// FMP Batch API - ดึงข้อมูลหลายตัวใน 1 request
// =====================================================

/**
 * Fetch batch quotes from FMP
 * URL: https://financialmodelingprep.com/api/v3/quote/AAPL,MSFT,GOOGL?apikey=KEY
 * 
 * 1 request = หลายตัว (แนะนำ 50 ตัว/request)
 */
async function fetchFMPBatch(symbols, type) {
  const BATCH_SIZE = 50; // 50 symbols per request
  const chunks = chunkArray(symbols, BATCH_SIZE);
  const results = [];
  
  console.log('  📦 ' + chunks.length + ' batches (' + BATCH_SIZE + ' symbols each)');
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const symbolList = chunk.join(',');
    const url = 'https://financialmodelingprep.com/api/v3/quote/' + symbolList + '?apikey=' + FMP_API_KEY;
    
    try {
      const data = await httpsGet(url);
      
      if (Array.isArray(data)) {
        for (const q of data) {
          if (q && q.symbol) {
            results.push({
              symbol: q.symbol,
              name: q.name || q.symbol,
              type: type,
              price: q.price || 0,
              change: q.change || 0,
              changePercent: q.changesPercentage || 0,
              divYield: q.dividendYield ? q.dividendYield * 100 : 0,
              growthRate: 0,
              peRatio: q.pe || 0,
              marketCap: q.marketCap || 0,
              volume: q.volume || 0,
              avgVolume: q.avgVolume || 0,
              high52w: q.yearHigh || q.price || 0,
              low52w: q.yearLow || q.price || 0,
              dayHigh: q.dayHigh || 0,
              dayLow: q.dayLow || 0,
              open: q.open || 0,
              previousClose: q.previousClose || 0,
              eps: q.eps || 0,
              updatedAt: new Date().toISOString()
            });
          }
        }
        console.log('  ✅ Batch ' + (i + 1) + '/' + chunks.length + ' - Got ' + data.length + ' results');
      } else if (data && data['Error Message']) {
        console.log('  ❌ Batch ' + (i + 1) + ' - API Error: ' + data['Error Message']);
      } else {
        console.log('  ❌ Batch ' + (i + 1) + ' - Unexpected response');
      }
    } catch (error) {
      console.log('  ❌ Batch ' + (i + 1) + ' - Network Error: ' + error.message);
    }
    
    // Delay between batches to avoid rate limit
    if (i < chunks.length - 1) {
      await delay(2000); // 2 seconds between batches
    }
  }
  
  return results;
}

// =====================================================
// Main Function
// =====================================================

async function main() {
  console.log('');
  console.log('========================================');
  console.log('  Update 300 Stocks + 250 ETF (v2.0)');
  console.log('  Batch API Mode - ประหยัด API calls');
  console.log('========================================');
  console.log('📅 Date: ' + new Date().toISOString());
  console.log('');
  
  const allAssets = [];
  const errors = [];
  
  // =============================================
  // Part 1: Fetch 300 Stocks via FMP Batch API
  // =============================================
  console.log('[1/2] 📈 Fetching ' + uniqueStocks.length + ' S&P 500 stocks (FMP Batch)...');
  
  const stockResults = await fetchFMPBatch(uniqueStocks, 'STOCK');
  allAssets.push(...stockResults);
  
  const missedStocks = uniqueStocks.filter(s => !stockResults.find(r => r.symbol === s));
  if (missedStocks.length > 0) {
    console.log('  ⚠️ Missing ' + missedStocks.length + ' stocks: ' + missedStocks.slice(0, 10).join(', ') + (missedStocks.length > 10 ? '...' : ''));
    errors.push(...missedStocks);
  }
  
  console.log('  📊 Got ' + stockResults.length + '/' + uniqueStocks.length + ' stocks');
  console.log('');
  
  // Wait between parts
  await delay(3000);
  
  // =============================================
  // Part 2: Fetch 250 ETFs via FMP Batch API
  // =============================================
  console.log('[2/2] 📊 Fetching ' + uniqueETFs.length + ' ETFs (FMP Batch)...');
  
  const etfResults = await fetchFMPBatch(uniqueETFs, 'ETF');
  allAssets.push(...etfResults);
  
  const missedETFs = uniqueETFs.filter(s => !etfResults.find(r => r.symbol === s));
  if (missedETFs.length > 0) {
    console.log('  ⚠️ Missing ' + missedETFs.length + ' ETFs: ' + missedETFs.slice(0, 10).join(', ') + (missedETFs.length > 10 ? '...' : ''));
    errors.push(...missedETFs);
  }
  
  console.log('  📊 Got ' + etfResults.length + '/' + uniqueETFs.length + ' ETFs');
  console.log('');
  
  // =============================================
  // Remove duplicates (by symbol)
  // =============================================
  const uniqueAssets = [];
  const seen = new Set();
  for (const asset of allAssets) {
    if (!seen.has(asset.symbol)) {
      seen.add(asset.symbol);
      uniqueAssets.push(asset);
    }
  }
  
  // =============================================
  // Save Data
  // =============================================
  if (uniqueAssets.length === 0) {
    console.error('❌ No data fetched! Check API keys and connection.');
    process.exit(1);
  }
  
  console.log('💾 Saving data...');
  
  // JSON
  const jsonPath = path.join(dataDir, 'combined-746-assets.json');
  fs.writeFileSync(jsonPath, JSON.stringify(uniqueAssets, null, 2));
  console.log('  ✅ JSON: ' + jsonPath + ' (' + uniqueAssets.length + ' records)');
  
  // CSV
  const csvPath = path.join(dataDir, 'combined-746-assets.csv');
  const csvHeader = 'Symbol,Name,Type,Price,Change,ChangePercent,DivYield,GrowthRate,PERatio,MarketCap,Volume,AvgVolume,High52w,Low52w,DayHigh,DayLow,Open,PreviousClose,EPS,UpdatedAt';
  const csvRows = uniqueAssets.map(function(a) {
    // Escape commas in name
    const name = (a.name || '').replace(/,/g, ' ');
    return [
      a.symbol, name, a.type, a.price, a.change, 
      a.changePercent.toFixed(2), a.divYield.toFixed(2), a.growthRate, 
      a.peRatio.toFixed(2), a.marketCap, a.volume, a.avgVolume,
      a.high52w, a.low52w, a.dayHigh, a.dayLow, a.open, 
      a.previousClose, a.eps, a.updatedAt
    ].join(',');
  });
  fs.writeFileSync(csvPath, csvHeader + '\n' + csvRows.join('\n'));
  console.log('  ✅ CSV: ' + csvPath);
  
  // =============================================
  // Summary
  // =============================================
  console.log('');
  console.log('========================================');
  console.log('  ✅ DONE!');
  console.log('========================================');
  console.log('📊 Total: ' + uniqueAssets.length + ' assets');
  console.log('  - Stocks: ' + uniqueAssets.filter(a => a.type === 'STOCK').length);
  console.log('  - ETFs: ' + uniqueAssets.filter(a => a.type === 'ETF').length);
  console.log('❌ Failed: ' + errors.length);
  console.log('🔑 API calls used: ~' + (Math.ceil(uniqueStocks.length / 50) + Math.ceil(uniqueETFs.length / 50)) + ' (Batch API)');
  console.log('⏱️  Completed in: ' + Math.round((Date.now() - startTime) / 1000) + ' seconds');
  console.log('========================================');
}

const startTime = Date.now();
main().catch((error) => {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});
