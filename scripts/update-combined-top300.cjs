#!/usr/bin/env node

/**
 * =====================================================
 * update-combined-top300.cjs v3.0 (Yahoo Finance)
 * =====================================================
 * ปัญหาเดิม:
 * - EODHD Free = 20 calls/วัน (ไม่พอ)
 * - FMP Stable = ต้อง Paid Plan
 * 
 * แก้ไข: ใช้ Yahoo Finance API
 * - ฟรี ไม่จำกัด
 * - Batch ได้ทีละ 100+ symbols
 * - ไม่ต้องใช้ API key
 * =====================================================
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Load Symbols
const stocksPath = path.join(__dirname, 'sp500-symbols-top300.json');
const etfPath = path.join(__dirname, 'top250-etf-symbols.json');

if (!fs.existsSync(stocksPath)) { console.error('❌ sp500-symbols-top300.json not found'); process.exit(1); }
if (!fs.existsSync(etfPath)) { console.error('❌ top250-etf-symbols.json not found'); process.exit(1); }

const sp500Symbols = [...new Set((JSON.parse(fs.readFileSync(stocksPath, 'utf8'))).symbols || JSON.parse(fs.readFileSync(stocksPath, 'utf8')))];
const etfSymbols = [...new Set((JSON.parse(fs.readFileSync(etfPath, 'utf8'))).symbols || JSON.parse(fs.readFileSync(etfPath, 'utf8')))];

console.log('📊 Loaded ' + sp500Symbols.length + ' stocks + ' + etfSymbols.length + ' ETFs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// =====================================================
// Yahoo Finance Batch Quote
// =====================================================
function fetchYahoo(symbols) {
  return new Promise((resolve, reject) => {
    const symbolList = symbols.join(',');
    
    const options = {
      hostname: 'query1.finance.yahoo.com',
      path: '/v7/finance/quote?symbols=' + encodeURIComponent(symbolList),
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.quoteResponse && json.quoteResponse.result) {
            resolve(json.quoteResponse.result);
          } else {
            resolve([]);
          }
        } catch (e) {
          reject(new Error('Parse error: ' + data.substring(0, 200)));
        }
      });
    }).on('error', reject);
  });
}

// Helpers
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function formatQuote(q, type) {
  return {
    symbol: q.symbol,
    name: q.shortName || q.longName || q.symbol,
    type: type,
    price: q.regularMarketPrice || 0,
    change: q.regularMarketChange || 0,
    changePercent: q.regularMarketChangePercent || 0,
    divYield: (q.trailingAnnualDividendYield || 0) * 100,
    growthRate: 0,
    peRatio: q.trailingPE || 0,
    marketCap: q.marketCap || 0,
    volume: q.regularMarketVolume || 0,
    avgVolume: q.averageDailyVolume10Day || 0,
    high52w: q.fiftyTwoWeekHigh || 0,
    low52w: q.fiftyTwoWeekLow || 0,
    dayHigh: q.regularMarketDayHigh || 0,
    dayLow: q.regularMarketDayLow || 0,
    open: q.regularMarketOpen || 0,
    previousClose: q.regularMarketPreviousClose || 0,
    eps: q.epsTrailingTwelveMonths || 0,
    updatedAt: new Date().toISOString()
  };
}

// =====================================================
// Fetch with retry and fallback to smaller batches
// =====================================================
async function fetchBatch(symbols, type, label) {
  console.log('[' + label + '] 📈 Fetching ' + symbols.length + ' ' + type + '...');
  
  const results = [];
  const errors = [];
  const chunks = chunkArray(symbols, 50);
  
  console.log('  📦 ' + chunks.length + ' batches (50 symbols each)');
  
  for (let i = 0; i < chunks.length; i++) {
    let retries = 3;
    let success = false;
    
    while (retries > 0 && !success) {
      try {
        const data = await fetchYahoo(chunks[i]);
        
        if (data && data.length > 0) {
          for (const q of data) {
            results.push(formatQuote(q, type));
          }
          console.log('  ✅ Batch ' + (i + 1) + '/' + chunks.length + ' - Got ' + data.length + ' results');
          success = true;
        } else {
          console.log('  ⚠️ Batch ' + (i + 1) + ' empty response, retry ' + (4 - retries) + '/3...');
          retries--;
          await delay(5000);
        }
      } catch (error) {
        console.log('  ⚠️ Batch ' + (i + 1) + ' error: ' + error.message.substring(0, 80) + ' - retry ' + (4 - retries) + '/3...');
        retries--;
        await delay(5000);
      }
    }
    
    if (!success) {
      console.log('  ❌ Batch ' + (i + 1) + ' failed after 3 retries');
      errors.push(...chunks[i]);
    }
    
    if (i < chunks.length - 1) await delay(2000);
  }
  
  console.log('  📊 Got ' + results.length + '/' + symbols.length + ' ' + type);
  return { results, errors };
}

// =====================================================
// Main
// =====================================================
async function main() {
  console.log('');
  console.log('========================================');
  console.log('  Update Stocks + ETF (v3.0)');
  console.log('  Yahoo Finance - Free & Unlimited');
  console.log('========================================');
  console.log('📅 ' + new Date().toISOString());
  console.log('');
  
  // Fetch stocks
  const stocks = await fetchBatch(sp500Symbols, 'STOCK', '1/2');
  console.log('');
  
  await delay(3000);
  
  // Fetch ETFs
  const etfs = await fetchBatch(etfSymbols, 'ETF', '2/2');
  console.log('');
  
  // Combine & deduplicate
  const allAssets = [...stocks.results, ...etfs.results];
  const uniqueAssets = [];
  const seen = new Set();
  for (const a of allAssets) {
    if (!seen.has(a.symbol)) {
      seen.add(a.symbol);
      uniqueAssets.push(a);
    }
  }
  
  if (uniqueAssets.length === 0) {
    console.error('❌ No data! Yahoo Finance may be blocking. Try again later.');
    process.exit(1);
  }
  
  // Save JSON
  const jsonPath = path.join(dataDir, 'combined-746-assets.json');
  fs.writeFileSync(jsonPath, JSON.stringify(uniqueAssets, null, 2));
  
  // Save CSV
  const csvPath = path.join(dataDir, 'combined-746-assets.csv');
  const header = 'Symbol,Name,Type,Price,Change,ChangePercent,DivYield,GrowthRate,PERatio,MarketCap,Volume,AvgVolume,High52w,Low52w,DayHigh,DayLow,Open,PreviousClose,EPS,UpdatedAt';
  const rows = uniqueAssets.map(a => {
    const name = (a.name || '').replace(/,/g, ' ').replace(/"/g, '');
    return [a.symbol, '"' + name + '"', a.type, a.price, a.change, a.changePercent.toFixed(2), a.divYield.toFixed(2), a.growthRate, a.peRatio.toFixed(2), a.marketCap, a.volume, a.avgVolume, a.high52w, a.low52w, a.dayHigh, a.dayLow, a.open, a.previousClose, a.eps, a.updatedAt].join(',');
  });
  fs.writeFileSync(csvPath, header + '\n' + rows.join('\n'));
  
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log('💾 Saved: ' + uniqueAssets.length + ' assets');
  console.log('');
  console.log('========================================');
  console.log('  ✅ DONE!');
  console.log('  📊 Stocks: ' + uniqueAssets.filter(a => a.type === 'STOCK').length);
  console.log('  📊 ETFs: ' + uniqueAssets.filter(a => a.type === 'ETF').length);
  console.log('  ❌ Errors: ' + (stocks.errors.length + etfs.errors.length));
  console.log('  ⏱️  Time: ' + elapsed + 's');
  console.log('========================================');
}

const startTime = Date.now();
main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
