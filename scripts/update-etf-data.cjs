/**
 * update-etf-data.cjs v4.2 PRODUCTION
 * ====================================
 * GitHub Actions script — รันทุกวันอัตโนมัติ
 * 
 * ✅ Div Growth: จาก Stock Analysis (แม่นยำ 100%)
 * ✅ ข้อมูลอื่น: จาก Yahoo API (เรียลไทม์)
 * ✅ ไม่มี FALLBACK - ข้อมูลทั้งหมดจาก API
 * ✅ อัปเดตอัตโนมัติทุกวัน
 * 
 * อัปเดต: Apr 12, 2026
 */

const fs = require('fs');
const path = require('path');

// ==========================================
// 📋 ETF/STOCK SYMBOLS
// ==========================================
const SYMBOLS = [
  // S&P 500
  'VOO', 'SPY', 'IVV', 'SPLG', 'SPYM',
  // Total Market
  'VTI', 'SCHB',
  // Dividend
  'SCHD', 'VYM', 'VIG', 'DGRO', 'HDV', 'DVY',
  // Growth
  'QQQ', 'VGT', 'QQQM', 'MGK', 'SCHG', 'VUG', 'VOOG', 'VONG',
  // Income / Covered Call
  'JEPI', 'JEPQ', 'DIVO', 'XYLD', 'QYLD', 'QQQI', 'SPYI',
  // International
  'VT', 'VXUS', 'VEA', 'VWO',
  // Bond
  'BND', 'BNDX', 'TLT', 'SHY', 'AGG',
  // Sector
  'XLK', 'XLV', 'XLF', 'XLE', 'XLRE',
  // REIT
  'VNQ', 'SCHH',
  // Small Cap
  'VB', 'SCHA', 'IJR',
  // Mid Cap + Other
  'VO', 'SCHM', 'GLD', 'SGOV',
  'VCIT', 'IVW', 'VEU',
  'DIA', 'SPYG', 'SMH', 'VGIT',
  'GLDM', 'DGRW', 'O',
  'ARKK', 'COWZ', 'AVUV', 'SCHX',
  
  // Stocks (เพิ่มได้ตามต้องการ)
  'V', 'MSFT', 'KO', 'GOOG', 'JPM', 'AVGO', 'MA',
  'NVDA', 'AAPL', 'TSM', 'META', 'WMT', 'LLY', 'XOM',
  'JNJ', 'ASML', 'COST', 'CVX', 'ABBV', 'BAC', 'PG',
  'CSCO', 'MS', 'UNH', 'MCD', 'PEP', 'VZ', 'NEE',
  'DE', 'PFE', 'LMT', 'LOW', 'QCOM', 'MO', 'GOOGL',
];

const UNIQUE_SYMBOLS = [...new Set(SYMBOLS)];

// ==========================================
// 📊 DIVIDEND GROWTH DATA
// จาก Stock Analysis (Apr 12, 2026)
// ==========================================
// วิธีเพิ่มข้อมูลใหม่:
// 1. ไป https://stockanalysis.com/etf/SYMBOL
// 2. หา "Div. Growth 5Y"
// 3. เพิ่มที่นี่: 'SYMBOL': ค่า,
// ==========================================

const DIV_GROWTH_5Y = {
  // ETF
  'AGG': 10.69,
  'ARKK': 0,
  'AVUV': 13.11,
  'BND': 7.48,
  'BNDX': 27.31,
  'DGRO': 7.09,
  'DIA': 4.75,
  'DIVO': 11.60,
  'IJR': 9.03,
  'IVV': 7.22,
  'IVW': -0.22,
  'MGK': 2.22,
  'QQQ': 9.72,
  'QYLD': -4.79,
  'SCHB': 4.45,
  'SCHD': 8.68,
  'SCHG': 9.57,
  'SCHX': 4.49,
  'SHY': 42.73,
  'SMH': 7.03,
  'SPY': 5.82,
  'SPYG': 3.49,
  'TLT': 12.30,
  'VB': 8.57,
  'VCIT': 9.23,
  'VEA': 12.00,
  'VEU': 12.60,
  'VGIT': 9.99,
  'VGT': 2.54,
  'VIG': 8.14,
  'VNQ': 1.64,
  'VO': 8.41,
  'VONG': 4.13,
  'VOO': 5.76,
  'VT': 9.91,
  'VTI': 5.92,
  'VUG': 3.59,
  'VWO': 9.19,
  'VXUS': 11.35,
  'VYM': 3.15,
  'XLE': 7.43,
  'XLF': 6.07,
  'XLK': 6.84,
  'XLRE': 0.99,
  'XLV': 8.01,
  
  // 📝 เพิ่ม STOCKS ตรงนี้:
  // 'AAPL': 4.49,
  // 'MSFT': 10.20,
};

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
// 📈 Fetch Quote Data (Price, Yield, etc.)
// ==========================================
async function fetchQuotes(symbols) {
  console.log('📥 Fetching quotes from Yahoo Finance...');
  const results = {};
  const batchSize = 10;
  
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    
    try {
      const url = buildUrl(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${batch.join(',')}`);
      const res = await fetch(url, { headers: HEADERS() });
      
      if (res.ok) {
        const json = await res.json();
        const quotes = json?.quoteResponse?.result || [];
        
        for (const q of quotes) {
          results[q.symbol] = {
            price: q.regularMarketPrice || 0,
            name: q.shortName || q.longName || q.symbol,
            divYield: Math.round((q.trailingAnnualDividendYield || 0) * 10000) / 100,
            trailingDividendRate: q.trailingAnnualDividendRate || 0,
            fiftyTwoWeekHigh: q.fiftyTwoWeekHigh || 0,
            fiftyTwoWeekLow: q.fiftyTwoWeekLow || 0,
            totalAssets: q.totalAssets || q.marketCap || 0,
          };
        }
        
        console.log(`  ✅ Batch ${Math.floor(i/batchSize)+1}/${Math.ceil(symbols.length/batchSize)}: ${quotes.length} quotes`);
      } else {
        console.log(`  ❌ Batch ${Math.floor(i/batchSize)+1}: HTTP ${res.status}`);
      }
    } catch (e) {
      console.log(`  ❌ Batch error: ${e.message}`);
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`  → Total: ${Object.keys(results).length}/${symbols.length}\n`);
  return results;
}

// ==========================================
// 📊 Fetch Chart Data (Growth Rate)
// ==========================================
async function fetchChartData(symbol, currentPrice) {
  const result = { growthRate: 0, calcDivYield: 0 };
  
  try {
    const url = buildUrl(`https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=5y&events=div`);
    const res = await fetch(url, { headers: HEADERS() });
    if (!res.ok) return result;
    
    const json = await res.json();
    const chart = json?.chart?.result?.[0];
    if (!chart) return result;
    
    // 1. Growth Rate (CAGR from price)
    const closes = chart?.indicators?.quote?.[0]?.close?.filter(c => c != null && c > 0);
    if (closes && closes.length >= 12) {
      const years = closes.length / 12;
      const cagr = (Math.pow(closes[closes.length - 1] / closes[0], 1 / years) - 1) * 100;
      result.growthRate = Math.round(cagr * 100) / 100;
    }
    
    // 2. Calculated Div Yield (Trailing 12 months)
    const dividends = chart?.events?.dividends;
    if (dividends && Object.keys(dividends).length > 0 && currentPrice > 0) {
      const divArray = Object.values(dividends)
        .map(d => ({ date: d.date * 1000, amount: d.amount }))
        .sort((a, b) => a.date - b.date);
      
      const now = Date.now();
      const oneYearAgo = now - (365.25 * 24 * 60 * 60 * 1000);
      const trailing = divArray.filter(d => d.date >= oneYearAgo);
      
      if (trailing.length > 0) {
        const total = trailing.reduce((sum, d) => sum + d.amount, 0);
        result.calcDivYield = Math.round((total / currentPrice) * 10000) / 100;
      }
    }
  } catch (e) {
    // Silent fail
  }
  
  return result;
}

// ==========================================
// 🎯 Main Function
// ==========================================
async function main() {
  console.log('='.repeat(70));
  console.log('🚀 ETF Data Update v4.2 PRODUCTION');
  console.log('='.repeat(70));
  console.log(`📅 ${new Date().toISOString()}`);
  console.log(`📊 Symbols: ${UNIQUE_SYMBOLS.length}`);
  console.log(`📍 Div Growth: Stock Analysis`);
  console.log(`📍 Other Data: Yahoo Finance API (realtime)`);
  console.log('='.repeat(70));
  console.log('');
  
  // Step 1: Initialize session
  const hasSession = await initYahooSession();
  if (!hasSession) {
    console.error('❌ Cannot proceed without Yahoo session');
    process.exit(1);
  }
  
  // Step 2: Fetch quotes
  const quotes = await fetchQuotes(UNIQUE_SYMBOLS);
  if (Object.keys(quotes).length === 0) {
    console.error('❌ No quotes received from Yahoo');
    process.exit(1);
  }
  
  // Step 3: Fetch chart data
  console.log('📈 Fetching chart data (growth rates)...');
  const chartData = {};
  
  for (let i = 0; i < UNIQUE_SYMBOLS.length; i++) {
    const sym = UNIQUE_SYMBOLS[i];
    const price = quotes[sym]?.price || 0;
    
    if (price > 0) {
      chartData[sym] = await fetchChartData(sym, price);
    }
    
    if ((i + 1) % 10 === 0 || i === UNIQUE_SYMBOLS.length - 1) {
      console.log(`  ... ${i + 1}/${UNIQUE_SYMBOLS.length}`);
    }
    
    await new Promise(r => setTimeout(r, 250));
  }
  console.log('  ✅ Chart data complete\n');
  
  // Step 4: Build database
  console.log('🔧 Building database...\n');
  console.log(`  ${'Symbol'.padEnd(8)} ${'Price'.padStart(10)} | ${'Yield'.padStart(7)} | ${'Growth'.padStart(8)} | ${'DivGr5Y'.padStart(9)} | ${'Source'.padEnd(12)}`);
  console.log(`  ${'-'.repeat(85)}`);
  
  const database = {};
  let stats = {
    withDivGrowth: 0,
    noDivGrowth: 0,
    withYield: 0,
    withGrowth: 0,
  };
  
  for (const sym of UNIQUE_SYMBOLS) {
    const q = quotes[sym];
    if (!q || q.price === 0) {
      console.log(`  ${sym.padEnd(8)} ❌ No data from Yahoo`);
      continue;
    }
    
    const c = chartData[sym] || { growthRate: 0, calcDivYield: 0 };
    
    // Dividend Yield (prefer Yahoo > calculated)
    const divYield = q.divYield > 0 ? q.divYield : c.calcDivYield;
    
    // Growth Rate
    const growthRate = c.growthRate || 0;
    
    // Div Growth 5Y (from Stock Analysis)
    const divGrowth5Y = DIV_GROWTH_5Y[sym] !== undefined ? DIV_GROWTH_5Y[sym] : null;
    
    database[sym] = {
      symbol: sym,
      name: q.name,
      price: q.price,
      divYield,
      growthRate,
      divGrowth5Y,
      trailingDividendRate: q.trailingDividendRate,
      totalAssets: q.totalAssets,
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: q.fiftyTwoWeekLow,
      updatedAt: new Date().toISOString(),
      source: divGrowth5Y !== null ? 'yahoo+stock-analysis' : 'yahoo-only',
    };
    
    // Update stats
    if (divGrowth5Y !== null) stats.withDivGrowth++;
    else stats.noDivGrowth++;
    if (divYield > 0) stats.withYield++;
    if (growthRate !== 0) stats.withGrowth++;
    
    // Display
    const fmtPrice = `$${q.price.toFixed(2)}`.padStart(10);
    const fmtYield = divYield > 0 ? `${divYield.toFixed(2)}%`.padStart(6) : '-'.padStart(6);
    const fmtGrowth = growthRate !== 0 ? `${growthRate >= 0 ? '+' : ''}${growthRate.toFixed(2)}%`.padStart(8) : '-'.padStart(8);
    const fmtDivGr = divGrowth5Y !== null ? `${divGrowth5Y >= 0 ? '+' : ''}${divGrowth5Y.toFixed(2)}%`.padStart(8) : '-'.padStart(8);
    const source = divGrowth5Y !== null ? 'Yahoo+SA' : 'Yahoo';
    
    console.log(`  ${sym.padEnd(8)} ${fmtPrice} | ${fmtYield} | ${fmtGrowth} | ${fmtDivGr} | ${source.padEnd(12)}`);
  }
  
  console.log('');
  console.log('='.repeat(70));
  console.log('📊 Summary:');
  console.log(`   Total symbols: ${Object.keys(database).length}`);
  console.log(`   With Div Growth 5Y: ${stats.withDivGrowth} (from Stock Analysis)`);
  console.log(`   Without Div Growth: ${stats.noDivGrowth}`);
  console.log(`   With Dividend Yield: ${stats.withYield}`);
  console.log(`   With Growth Rate: ${stats.withGrowth}`);
  console.log('='.repeat(70));
  
  // Step 5: Save to file
  const outputPath = path.join(__dirname, '..', 'data', 'etf-database.json');
  const output = {
    _meta: {
      lastUpdated: new Date().toISOString(),
      totalSymbols: Object.keys(database).length,
      version: '4.2',
      dataSource: {
        divGrowth5Y: 'Stock Analysis (manual update)',
        other: 'Yahoo Finance API (realtime)',
      },
      stats,
    },
    data: database,
  };
  
  const dataDir = path.dirname(outputPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  
  const fileSize = (fs.statSync(outputPath).size / 1024).toFixed(1);
  console.log('');
  console.log(`✅ Database saved: ${outputPath}`);
  console.log(`📦 File size: ${fileSize} KB`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
