#!/usr/bin/env node

/**
 * update-combined-top300.cjs v4.0
 * ใช้ yahoo-finance2 npm package (จัดการ crumb/cookie อัตโนมัติ)
 * ฟรี ไม่ต้องใช้ API key
 */

const fs = require('fs');
const path = require('path');

// Load symbols
const stocksPath = path.join(__dirname, 'sp500-symbols-top300.json');
const etfPath = path.join(__dirname, 'top250-etf-symbols.json');

if (!fs.existsSync(stocksPath)) { console.error('❌ sp500-symbols-top300.json not found'); process.exit(1); }
if (!fs.existsSync(etfPath)) { console.error('❌ top250-etf-symbols.json not found'); process.exit(1); }

const sp500Symbols = [...new Set((JSON.parse(fs.readFileSync(stocksPath, 'utf8'))).symbols || JSON.parse(fs.readFileSync(stocksPath, 'utf8')))];
const etfSymbols = [...new Set((JSON.parse(fs.readFileSync(etfPath, 'utf8'))).symbols || JSON.parse(fs.readFileSync(etfPath, 'utf8')))];

console.log('📊 Loaded ' + sp500Symbols.length + ' stocks + ' + etfSymbols.length + ' ETFs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Helpers
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function main() {
  const startTime = Date.now();
  
  // Dynamic import for ES module
  const yahooFinance = await import('yahoo-finance2').then(m => m.default);
  
  // Suppress validation warnings
  yahooFinance.suppressNotices(['yahooSurvey']);
  
  console.log('');
  console.log('========================================');
  console.log('  Update Stocks + ETF (v4.0)');
  console.log('  yahoo-finance2 - Free & Reliable');
  console.log('========================================');
  console.log('📅 ' + new Date().toISOString());
  console.log('');
  
  const allAssets = [];
  const errors = [];
  
  // Combine all symbols
  const allSymbols = [
    ...sp500Symbols.map(s => ({ symbol: s, type: 'STOCK' })),
    ...etfSymbols.map(s => ({ symbol: s, type: 'ETF' }))
  ];
  
  // Remove duplicate symbols
  const uniqueSymbolMap = new Map();
  for (const item of allSymbols) {
    if (!uniqueSymbolMap.has(item.symbol)) {
      uniqueSymbolMap.set(item.symbol, item.type);
    }
  }
  
  const symbolList = [...uniqueSymbolMap.keys()];
  const typeMap = Object.fromEntries(uniqueSymbolMap);
  
  console.log('📈 Fetching ' + symbolList.length + ' unique symbols...');
  
  // Fetch in batches of 50
  const chunks = chunkArray(symbolList, 50);
  console.log('📦 ' + chunks.length + ' batches (50 symbols each)');
  console.log('');
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let retries = 3;
    let success = false;
    
    while (retries > 0 && !success) {
      try {
        const results = await yahooFinance.quote(chunk);
        
        if (results && results.length > 0) {
          for (const q of results) {
            if (q && q.symbol) {
              allAssets.push({
                symbol: q.symbol,
                name: q.shortName || q.longName || q.symbol,
                type: typeMap[q.symbol] || (q.quoteType === 'ETF' ? 'ETF' : 'STOCK'),
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
              });
            }
          }
          console.log('✅ Batch ' + (i + 1) + '/' + chunks.length + ' - Got ' + results.length + ' results');
          success = true;
        } else {
          throw new Error('Empty response');
        }
      } catch (error) {
        retries--;
        if (retries > 0) {
          console.log('⚠️ Batch ' + (i + 1) + ' error, retry... (' + error.message.substring(0, 60) + ')');
          await delay(5000);
        } else {
          console.log('❌ Batch ' + (i + 1) + ' failed: ' + error.message.substring(0, 60));
          errors.push(...chunk);
        }
      }
    }
    
    if (i < chunks.length - 1) await delay(1500);
  }
  
  // Deduplicate
  const seen = new Set();
  const uniqueAssets = allAssets.filter(a => {
    if (seen.has(a.symbol)) return false;
    seen.add(a.symbol);
    return true;
  });
  
  if (uniqueAssets.length === 0) {
    console.error('❌ No data fetched!');
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
  console.log('');
  console.log('========================================');
  console.log('✅ DONE!');
  console.log('📊 Total: ' + uniqueAssets.length + ' assets');
  console.log('  Stocks: ' + uniqueAssets.filter(a => a.type === 'STOCK').length);
  console.log('  ETFs: ' + uniqueAssets.filter(a => a.type === 'ETF').length);
  console.log('❌ Errors: ' + errors.length);
  console.log('⏱️  Time: ' + elapsed + 's');
  console.log('========================================');
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
