/**
 * =====================================================
 * update-historical-prices.cjs v1.1 (Fixed)
 * =====================================================
 * ดึงราคาหุ้นย้อนหลัง 30 วันจาก Yahoo Finance
 * รันทุกวันอัตโนมัติพร้อมกับ update-etf-data.cjs
 * 
 * Output: stock-prices-30d.json
 * =====================================================
 */

const fs = require('fs');
const path = require('path');

// ==========================================
// 📋 SYMBOLS TO FETCH
// ==========================================
// อ่านจาก etf-database.json ที่มีอยู่

// ⭐ FIX: ระบุ path แน่นอน
const databasePath = path.join(__dirname, '..', 'data', 'etf-database.json');

console.log(`🔍 Looking for database at: ${databasePath}`);
console.log(`📁 File exists: ${fs.existsSync(databasePath)}`);

if (!fs.existsSync(databasePath)) {
  console.error('❌ etf-database.json not found!');
  console.error(`   Expected path: ${databasePath}`);
  console.error(`   Current dir: ${__dirname}`);
  process.exit(1);
}

const dbContent = fs.readFileSync(databasePath, 'utf8');
const db = JSON.parse(dbContent);

// ⭐ FIX: Debug output
console.log(`📊 Database structure:`, Object.keys(db));
console.log(`📊 Has _meta: ${!!db._meta}`);
console.log(`📊 Has data: ${!!db.data}`);

const SYMBOLS = Object.keys(db.data || db);

console.log(`✅ Found ${SYMBOLS.length} symbols from etf-database.json`);
console.log(`📋 First 5 symbols: ${SYMBOLS.slice(0, 5).join(', ')}`);
console.log('');

if (SYMBOLS.length === 0) {
  console.error('❌ No symbols found!');
  process.exit(1);
}

// ==========================================
// 🔐 Yahoo Finance Session
// ==========================================
let yahooCookie = '';
let yahooCrumb = '';

async function initYahooSession() {
  console.log('🔑 Initializing Yahoo Finance session...');
  try {
    const initRes = await fetch('https://fc.yahoo.com', { redirect: 'manual' });
    const cookies = initRes.headers.getSetCookie ? initRes.headers.getSetCookie() : [];
    yahooCookie = cookies.length > 0 ? cookies[0].split(';')[0] : (initRes.headers.get('set-cookie') || '').split(';')[0];
    
    if (yahooCookie) {
      const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
        headers: { 'Cookie': yahooCookie, 'User-Agent': 'Mozilla/5.0' }
      });
      if (crumbRes.ok) {
        yahooCrumb = await crumbRes.text();
        if (yahooCrumb && yahooCrumb.length < 50 && !yahooCrumb.includes('<')) {
          console.log(`✅ Session ready (crumb: ${yahooCrumb.substring(0, 8)}...)\n`);
          return true;
        }
      }
    }
  } catch (e) {
    console.error(`❌ Session error: ${e.message}`);
  }
  
  console.log('❌ Failed to get Yahoo session\n');
  return false;
}

function buildUrl(baseUrl) {
  if (!yahooCrumb) return baseUrl;
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}crumb=${encodeURIComponent(yahooCrumb)}`;
}

const HEADERS = () => ({
  'Cookie': yahooCookie,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
});

// ==========================================
// 📈 Fetch Historical Prices (30 days)
// ==========================================
async function fetchHistoricalPrices(symbol, days = 30) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const period1 = now - (days * 24 * 60 * 60);
    const period2 = now;
    
    const url = buildUrl(
      `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d`
    );
    
    const res = await fetch(url, { headers: HEADERS() });
    if (!res.ok) return null;
    
    const json = await res.json();
    const chart = json?.chart?.result?.[0];
    if (!chart) return null;
    
    const timestamps = chart.timestamp || [];
    const quotes = chart.indicators?.quote?.[0] || {};
    const opens = quotes.open || [];
    const highs = quotes.high || [];
    const lows = quotes.low || [];
    const closes = quotes.close || [];
    const volumes = quotes.volume || [];
    
    const prices = [];
    for (let i = 0; i < timestamps.length; i++) {
      const open = opens[i];
      const high = highs[i];
      const low = lows[i];
      const close = closes[i];
      const volume = volumes[i];
      
      // Skip invalid data
      if (!close || close <= 0) continue;
      
      const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
      
      // Calculate daily change %
      let change = 0;
      if (i > 0 && closes[i - 1] && closes[i - 1] > 0) {
        change = ((close - closes[i - 1]) / closes[i - 1]) * 100;
      }
      
      prices.push({
        date,
        open: open ? Math.round(open * 100) / 100 : close,
        high: high ? Math.round(high * 100) / 100 : close,
        low: low ? Math.round(low * 100) / 100 : close,
        close: Math.round(close * 100) / 100,
        volume: volume || 0,
        change: Math.round(change * 100) / 100
      });
    }
    
    return prices.reverse(); // Newest first
    
  } catch (err) {
    console.error(`  ❌ Error fetching ${symbol}: ${err.message}`);
    return null;
  }
}

// ==========================================
// 🎯 Main Function
// ==========================================
async function main() {
  console.log('='.repeat(70));
  console.log('📈 Historical Prices Update v1.1');
  console.log('='.repeat(70));
  console.log(`📅 ${new Date().toISOString()}`);
  console.log(`📊 Symbols: ${SYMBOLS.length}`);
  console.log(`📍 Period: Last 30 days`);
  console.log('='.repeat(70));
  console.log('');
  
  // Step 1: Initialize session
  const hasSession = await initYahooSession();
  if (!hasSession) {
    console.error('❌ Cannot proceed without Yahoo session');
    process.exit(1);
  }
  
  // Step 2: Fetch historical prices
  console.log('📥 Fetching historical prices (30 days)...\n');
  
  const historicalData = {};
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < SYMBOLS.length; i++) {
    const symbol = SYMBOLS[i];
    const prices = await fetchHistoricalPrices(symbol, 30);
    
    if (prices && prices.length > 0) {
      historicalData[symbol] = prices;
      successCount++;
      console.log(`  ✅ ${symbol.padEnd(8)} - ${prices.length} days`);
    } else {
      failCount++;
      console.log(`  ❌ ${symbol.padEnd(8)} - No data`);
    }
    
    // Progress indicator
    if ((i + 1) % 10 === 0 || i === SYMBOLS.length - 1) {
      console.log(`  ... Progress: ${i + 1}/${SYMBOLS.length}\n`);
    }
    
    // Rate limiting: 250ms between requests
    await new Promise(r => setTimeout(r, 250));
  }
  
  console.log('');
  console.log('='.repeat(70));
  console.log('📊 Summary:');
  console.log(`   Success: ${successCount}`);
  console.log(`   Failed: ${failCount}`);
  console.log(`   Total: ${SYMBOLS.length}`);
  console.log('='.repeat(70));
  
  // Step 3: Save to file
  const outputPath = path.join(__dirname, '..', 'data', 'stock-prices-30d.json');
  const output = {
    _meta: {
      lastUpdate: new Date().toISOString(),
      dataSource: 'Yahoo Finance API',
      period: '30 days',
      totalSymbols: successCount,
    },
    data: historicalData
  };
  
  const dataDir = path.dirname(outputPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  
  const fileSize = (fs.statSync(outputPath).size / 1024).toFixed(1);
  console.log('');
  console.log(`✅ Historical data saved: ${outputPath}`);
  console.log(`📦 File size: ${fileSize} KB`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
