/**
 * =====================================================
 * update-etf-data.cjs v5.0 PRODUCTION
 * =====================================================
 * GitHub Actions script — รันทุกวันอัตโนมัติ
 * 
 * ✅ v5.0 อัพเดต (Apr 12, 2026):
 *   1. [UPDATE] Div Growth 5Y: ข้อมูลจาก stockanalysis.com (ถูกต้อง 100%)
 *   2. [NEW] เพิ่มหุ้นรายตัว 33 ตัว (AAPL, MSFT, NVDA, AVGO ฯลฯ)
 *   3. [NEW] เพิ่ม ETF ที่ขาด (COWZ, DGRW, DVY, HDV ฯลฯ)
 *   4. [FIX] ค่า COST=-16.60% (ถูกต้องตาม stockanalysis.com)
 *   5. [DATA] ข้อมูลอื่น: จาก Yahoo Finance API (เรียลไทม์)
 *   6. [DATA] ไม่มี FALLBACK — ข้อมูลทั้งหมดจาก API
 * 
 * แหล่งข้อมูล:
 *   - Div Growth 5Y: https://stockanalysis.com (manual จาก CSV export)
 *   - Price, Yield, Growth: Yahoo Finance API (realtime)
 * 
 * เวอร์ชันก่อนหน้า: v4.2
 * =====================================================
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
  
  // Stocks
  'V', 'MSFT', 'KO', 'GOOG', 'JPM', 'AVGO', 'MA',
  'NVDA', 'AAPL', 'TSM', 'META', 'WMT', 'LLY', 'XOM',
  'JNJ', 'ASML', 'COST', 'CVX', 'ABBV', 'BAC', 'PG',
  'CSCO', 'MS', 'UNH', 'MCD', 'PEP', 'VZ', 'NEE',
  'DE', 'PFE', 'LMT', 'LOW', 'QCOM', 'MO', 'GOOGL',
];

const UNIQUE_SYMBOLS = [...new Set(SYMBOLS)];

// =====================================================
// 📊 DIVIDEND GROWTH DATA (v5.0)
// แหล่งข้อมูล: https://stockanalysis.com
// วันที่: Apr 12, 2026
// =====================================================
// วิธีอัพเดตข้อมูล:
// 1. ETF: ไป https://stockanalysis.com/etf/screener/ → Export CSV
// 2. Stock: ไป https://stockanalysis.com/stocks/screener/ → Export CSV
// 3. คัดลอก Div. Growth 5Y มาใส่ตรงนี้
// =====================================================

const DIV_GROWTH_5Y = {
  // ==================== ETF ====================
  'AGG': 10.69,
  'AVUV': 13.11,
  'BND': 7.48,
  'BNDX': 27.31,
  'COWZ': 13.20,    // [NEW v5.0] จาก CSV stockanalysis.com
  'DGRO': 7.09,
  'DGRW': 3.97,     // [NEW v5.0] จาก CSV stockanalysis.com
  'DIA': 4.75,
  'DIVO': 11.60,
  'DVY': 8.20,      // [FIX v5.0] เดิมไม่มี → จาก CSV stockanalysis.com
  'HDV': 2.29,      // [FIX v5.0] เดิมไม่มี → จาก CSV stockanalysis.com
  'IJR': 9.03,
  'IVV': 7.22,
  'IVW': -0.22,
  'MGK': 2.22,
  'QQQ': 9.72,
  'QYLD': -4.79,
  'SCHA': 8.16,     // [FIX v5.0] เดิม 8.57 → แก้ตาม stockanalysis.com
  'SCHB': 4.45,
  'SCHD': 8.68,
  'SCHG': 9.57,
  'SCHH': 5.54,     // [FIX v5.0] เดิม 1.64 → แก้ตาม stockanalysis.com
  'SCHM': 11.14,    // [FIX v5.0] เดิม 8.41 → แก้ตาม stockanalysis.com
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
  'VOOG': 2.77,     // [FIX v5.0] เดิม 3.49 → แก้ตาม stockanalysis.com
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

  // ==================== STOCKS ====================
  // ข้อมูลจาก stockanalysis.com/stocks/screener/ (Apr 12, 2026)
  'AAPL': 4.49,
  'ABBV': 6.33,     // [FIX v5.0] เดิม 7.80 → แก้ตาม stockanalysis.com
  'ASML': 18.74,    // [FIX v5.0] เดิม 21.00 → แก้ตาม stockanalysis.com
  'AVGO': 12.60,    // [FIX v5.0] เดิม 12.90 → แก้ตาม stockanalysis.com
  'BAC': 8.85,      // [FIX v5.0] เดิม 11.50 → แก้ตาม stockanalysis.com
  'COST': -16.60,   // [FIX v5.0] ⚠️ ค่าลบ! เดิม 12.70 → แก้ตาม stockanalysis.com
  'CSCO': 2.62,     // [FIX v5.0] เดิม 2.80 → แก้ตาม stockanalysis.com
  'CVX': 5.81,      // [FIX v5.0] เดิม 6.30 → แก้ตาม stockanalysis.com
  'DE': 15.30,      // [FIX v5.0] เดิม 14.50 → แก้ตาม stockanalysis.com
  'JNJ': 4.92,      // [FIX v5.0] เดิม 5.50 → แก้ตาม stockanalysis.com
  'JPM': 10.38,     // [FIX v5.0] เดิม 9.30 → แก้ตาม stockanalysis.com
  'KO': 4.54,       // [FIX v5.0] เดิม 3.80 → แก้ตาม stockanalysis.com
  'LLY': 14.40,     // [FIX v5.0] เดิม 15.30 → แก้ตาม stockanalysis.com
  'LMT': 5.77,      // [FIX v5.0] เดิม 7.20 → แก้ตาม stockanalysis.com
  'LOW': 15.35,     // [FIX v5.0] เดิม 17.50 → แก้ตาม stockanalysis.com
  'MA': 14.18,      // [FIX v5.0] เดิม 15.40 → แก้ตาม stockanalysis.com
  'MCD': 7.23,      // [FIX v5.0] เดิม 8.10 → แก้ตาม stockanalysis.com
  'MO': 4.19,
  'MS': 22.90,      // [FIX v5.0] เดิม 20.00 → แก้ตาม stockanalysis.com
  'MSFT': 10.20,
  'NEE': 9.58,      // [FIX v5.0] เดิม 10.00 → แก้ตาม stockanalysis.com
  'NVDA': 20.11,    // [FIX v5.0] เดิม 10.70 → แก้ตาม stockanalysis.com
  'O': 2.87,        // [FIX v5.0] เดิม 3.20 → แก้ตาม stockanalysis.com
  'PEP': 6.55,      // [FIX v5.0] เดิม 7.00 → แก้ตาม stockanalysis.com
  'PFE': 2.24,      // [FIX v5.0] เดิม 2.60 → แก้ตาม stockanalysis.com
  'PG': 5.45,       // [FIX v5.0] เดิม 5.70 → แก้ตาม stockanalysis.com
  'QCOM': 6.24,     // [FIX v5.0] เดิม 4.70 → แก้ตาม stockanalysis.com
  'TSM': 13.84,     // [FIX v5.0] เดิม 18.50 → แก้ตาม stockanalysis.com
  'UNH': 12.07,     // [FIX v5.0] เดิม 14.20 → แก้ตาม stockanalysis.com
  'V': 14.87,       // [FIX v5.0] เดิม 17.00 → แก้ตาม stockanalysis.com
  'VZ': 2.06,
  'WMT': 5.93,      // [FIX v5.0] เดิม 8.70 → แก้ตาม stockanalysis.com
  'XOM': 3.03,

  // ==================== ไม่มีข้อมูล Div Growth 5Y ====================
  // หุ้น/ETF เหล่านี้ไม่มีข้อมูล Div Growth 5Y ใน stockanalysis.com
  // เพราะจ่ายปันผลไม่ถึง 5 ปี หรือไม่จ่ายปันผล
  // ARKK, GLD, GLDM, GOOG, GOOGL, JEPI, JEPQ, META,
  // QQQI, QQQM, SGOV, SPLG, SPYI, SPYM, XYLD
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
  console.log('🚀 ETF Data Update v5.0 PRODUCTION');
  console.log('='.repeat(70));
  console.log(`📅 ${new Date().toISOString()}`);
  console.log(`📊 Symbols: ${UNIQUE_SYMBOLS.length}`);
  console.log(`📍 Div Growth 5Y: stockanalysis.com (${Object.keys(DIV_GROWTH_5Y).length} symbols)`);
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
      source: divGrowth5Y !== null ? 'yahoo+stockanalysis' : 'yahoo-only',
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
  console.log(`   With Div Growth 5Y: ${stats.withDivGrowth} (from stockanalysis.com)`);
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
      version: '5.0',
      dataSource: {
        divGrowth5Y: 'stockanalysis.com (manual CSV export)',
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
