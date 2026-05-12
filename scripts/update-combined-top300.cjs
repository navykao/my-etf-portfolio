#!/usr/bin/env node

/**
 * update-combined-top300.cjs v4.0 (Yahoo Finance + Crumb Auth)
 * ดึง cookie+crumb อัตโนมัติ แล้วใช้ batch quote
 * ฟรี ไม่ต้องใช้ API key
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

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
      res.on('end', () => {
        resolve({
          data: data,
          statusCode: res.statusCode,
          headers: res.headers,
          cookies: res.headers['set-cookie'] || []
        });
      });
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
// Yahoo Finance Auth (Cookie + Crumb)
// =====================================================
async function getYahooCrumb() {
  console.log('🔑 Getting Yahoo Finance auth...');
  
  // Step 1: Get cookie from fc.yahoo.com
  const r1 = await httpsGet('https://fc.yahoo.com');
  let cookieStr = r1.cookies.map(c => c.split(';')[0]).join('; ');
  console.log('  Cookie: ' + (cookieStr ? '✅' : '❌'));
  
  // Step 2: Get crumb
  const r2 = await httpsGet('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    'Cookie': cookieStr
  });
  
  const crumb = r2.data.trim();
  console.log('  Crumb: ' + (crumb && r2.statusCode === 200 ? '✅' : '❌ (status ' + r2.statusCode + ')'));
  
  if (!crumb || r2.statusCode !== 200) {
    throw new Error('Failed to get crumb: status=' + r2.statusCode + ' body=' + r2.data.substring(0, 100));
  }
  
  return { cookie: cookieStr, crumb: crumb };
}

// =====================================================
// Yahoo Finance Quote with Auth
// =====================================================
async function fetchQuotes(symbols, auth) {
  const symbolList = symbols.join(',');
  const url = 'https://query2.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(symbolList) + '&crumb=' + encodeURIComponent(auth.crumb);
  
  const response = await httpsGet(url, { 'Cookie': auth.cookie });
  
  if (response.statusCode !== 200) {
    throw new Error('HTTP ' + response.statusCode + ': ' + response.data.substring(0, 100));
  }
  
  const json = JSON.parse(response.data);
  
  if (json.quoteResponse && json.quoteResponse.result) {
    return json.quoteResponse.result;
  }
  
  return [];
}

// =====================================================
// Main
// =====================================================
async function main() {
  const startTime = Date.now();
  
  console.log('');
  console.log('========================================');
  console.log('  Update Stocks + ETF (v4.0)');
  console.log('  Yahoo Finance + Crumb Auth');
  console.log('========================================');
  console.log('📅 ' + new Date().toISOString());
  console.log('');
  
  // Get auth
  const auth = await getYahooCrumb();
  console.log('');
  
  const allAssets = [];
  const errors = [];
  
  // All unique symbols
  const allSymbols = [...sp500Symbols, ...etfSymbols];
  const uniqueSymbols = [...new Set(allSymbols)];
  const typeMap = {};
  sp500Symbols.forEach(s => { typeMap[s] = 'STOCK'; });
  etfSymbols.forEach(s => { if (!typeMap[s]) typeMap[s] = 'ETF'; });
  
  // Fetch in batches
  const chunks = chunkArray(uniqueSymbols, 50);
  console.log('📈 Fetching ' + uniqueSymbols.length + ' symbols in ' + chunks.length + ' batches...');
  console.log('');
  
  for (let i = 0; i < chunks.length; i++) {
    let retries = 3;
    let success = false;
    
    while (retries > 0 && !success) {
      try {
        const results = await fetchQuotes(chunks[i], auth);
        
        if (results.length > 0) {
          for (const q of results) {
            if (q && q.symbol) {
              allAssets.push({
                symbol: q.symbol,
                name: q.shortName || q.longName || q.symbol,
                type: typeMap[q.symbol] || 'STOCK',
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
          console.log('✅ Batch ' + (i + 1) + '/' + chunks.length + ' - ' + results.length + ' results');
          success = true;
        } else {
          throw new Error('Empty response');
        }
      } catch (error) {
        retries--;
        if (retries > 0) {
          console.log('⚠️ Batch ' + (i + 1) + ' retry... (' + error.message.substring(0, 60) + ')');
          await delay(5000);
        } else {
          console.log('❌ Batch ' + (i + 1) + ' failed');
          errors.push(...chunks[i]);
        }
      }
    }
    
    if (i < chunks.length - 1) await delay(1500);
  }
  
  // Deduplicate
  const seen = new Set();
  const uniqueAssets = allAssets.filter(a => { if (seen.has(a.symbol)) return false; seen.add(a.symbol); return true; });
  
  if (uniqueAssets.length === 0) { console.error('❌ No data!'); process.exit(1); }
  
  // Save
  fs.writeFileSync(path.join(dataDir, 'combined-746-assets.json'), JSON.stringify(uniqueAssets, null, 2));
  
  const header = 'Symbol,Name,Type,Price,Change,ChangePercent,DivYield,GrowthRate,PERatio,MarketCap,Volume,AvgVolume,High52w,Low52w,DayHigh,DayLow,Open,PreviousClose,EPS,UpdatedAt';
  const rows = uniqueAssets.map(a => [a.symbol, '"' + (a.name||'').replace(/[",]/g, ' ') + '"', a.type, a.price, a.change, a.changePercent.toFixed(2), a.divYield.toFixed(2), a.growthRate, a.peRatio.toFixed(2), a.marketCap, a.volume, a.avgVolume, a.high52w, a.low52w, a.dayHigh, a.dayLow, a.open, a.previousClose, a.eps, a.updatedAt].join(','));
  fs.writeFileSync(path.join(dataDir, 'combined-746-assets.csv'), header + '\n' + rows.join('\n'));
  
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log('');
  console.log('========================================');
  console.log('✅ DONE! ' + uniqueAssets.length + ' assets (' + elapsed + 's)');
  console.log('  Stocks: ' + uniqueAssets.filter(a => a.type === 'STOCK').length);
  console.log('  ETFs: ' + uniqueAssets.filter(a => a.type === 'ETF').length);
  console.log('========================================');
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
