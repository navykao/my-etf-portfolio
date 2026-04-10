/**
 * update-etf-data.cjs v3.0
 * ====================================
 * GitHub Actions script — รันทุกวันอัตโนมัติ
 * ดึงข้อมูล ETF/หุ้น จาก Yahoo Finance แล้ว save ลง data/etf-database.json
 * 
 * v3.0 Changes:
 * - แก้ปัญหา Yield = 0 โดยคำนวณจาก dividend events จริง (trailing 12 months)
 * - แก้ปัญหา Growth Rate ตก fallback โดยใช้ chart data 5 ปี
 * - แก้ปัญหา Div Growth 5Y ได้ 0 โดยจัดกลุ่มเป็นรายปีแทนรายไตรมาส
 * - รวม Growth + DivGrowth + DivYield ไว้ใน fetchChartData() เรียก API ครั้งเดียว
 *   ประหยัด API calls จาก 3 calls/symbol → 1 call/symbol
 * - เพิ่ม log ระบุที่มาของแต่ละค่าชัดเจน (yahoo / calculated / fallback)
 * - ลบ symbol ซ้ำอัตโนมัติ
 * - เพิ่ม divGrowth5Y ใน FALLBACK_DATA
 * 
 * ฟรี 100% — ไม่ต้องใช้ API key
 */

const fs = require('fs');
const path = require('path');

// ==========================================
// รายชื่อ ETF/หุ้น ที่ต้องการติดตาม
// ==========================================
const ETF_SYMBOLS = [
  // S&P 500
  'VOO', 'SPY', 'IVV', 'SPLG','SPYM',
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
  // Other popular
  'ARKK', 'COWZ', 'AVUV', 'SCHX',
  // Stock
  'V', 'MSFT', 'KO', 'GOOG', 'JPM', 'AVGO', 'MA',
  'NVDA', 'AAPL', 'TSM', 'META', 'WMT', 'LLY', 'XOM',
  'JNJ', 'ASML', 'COST', 'CVX', 'ABBV', 'BAC', 'PG',
  'CSCO', 'MS', 'UNH', 'MCD', 'PEP', 'VZ', 'NEE',
  'DE', 'PFE', 'LMT', 'LOW', 'QCOM', 'MO', 'GOOGL',
];

// ลบ duplicate อัตโนมัติ
const UNIQUE_SYMBOLS = [...new Set(ETF_SYMBOLS)];

// ==========================================
// Fallback data — ใช้เฉพาะเมื่อ Yahoo ดึงไม่ได้เลย
// v3: เพิ่ม divGrowth5Y ทุกตัว
// ==========================================
const FALLBACK_DATA = {
  'VOO':  { divYield: 1.25, growthRate: 10.5, divGrowth5Y: 6.5, name: 'Vanguard S&P 500 ETF', price: 540 },
  'SPY':  { divYield: 1.20, growthRate: 10.5, divGrowth5Y: 6.2, name: 'SPDR S&P 500 ETF Trust', price: 587 },
  'IVV':  { divYield: 1.25, growthRate: 10.5, divGrowth5Y: 8.1, name: 'iShares Core S&P 500 ETF', price: 590 },
  'SPLG': { divYield: 1.25, growthRate: 10.5, divGrowth5Y: 6.3, name: 'SPDR Portfolio S&P 500 ETF', price: 64 },
  'VTI':  { divYield: 1.30, growthRate: 10.0, divGrowth5Y: 6.2, name: 'Vanguard Total Stock Market ETF', price: 290 },
  'SCHB': { divYield: 1.25, growthRate: 9.8, divGrowth5Y: 12.0, name: 'Schwab US Broad Market ETF', price: 60 },
  'SCHD': { divYield: 3.50, growthRate: 8.2, divGrowth5Y: 8.7, name: 'Schwab US Dividend Equity ETF', price: 28 },
  'VYM':  { divYield: 2.80, growthRate: 6.5, divGrowth5Y: 3.2, name: 'Vanguard High Dividend Yield ETF', price: 125 },
  'VIG':  { divYield: 1.75, growthRate: 9.0, divGrowth5Y: 5.0, name: 'Vanguard Dividend Appreciation ETF', price: 195 },
  'DGRO': { divYield: 2.30, growthRate: 8.5, divGrowth5Y: 8.2, name: 'iShares Core Dividend Growth ETF', price: 62 },
  'HDV':  { divYield: 3.40, growthRate: 5.5, divGrowth5Y: 3.9, name: 'iShares Core High Dividend ETF', price: 115 },
  'DVY':  { divYield: 3.30, growthRate: 5.0, divGrowth5Y: 8.7, name: 'iShares Select Dividend ETF', price: 130 },
  'QQQ':  { divYield: 0.55, growthRate: 15.8, divGrowth5Y: 12.0, name: 'Invesco QQQ Trust', price: 485 },
  'VGT':  { divYield: 0.60, growthRate: 17.0, divGrowth5Y: 0.8, name: 'Vanguard Information Technology ETF', price: 580 },
  'QQQM': { divYield: 0.55, growthRate: 15.5, divGrowth5Y: 16.4, name: 'Invesco NASDAQ 100 ETF', price: 200 },
  'MGK':  { divYield: 0.45, growthRate: 16.0, divGrowth5Y: 8.1, name: 'Vanguard Mega Cap Growth ETF', price: 295 },
  'SCHG': { divYield: 0.35, growthRate: 16.5, divGrowth5Y: 14.0, name: 'Schwab US Large-Cap Growth ETF', price: 105 },
  'VUG':  { divYield: 0.45, growthRate: 15.0, divGrowth5Y: 8.0, name: 'Vanguard Growth ETF', price: 380 },
  'JEPI': { divYield: 7.20, growthRate: 3.0, divGrowth5Y: 0, name: 'JPMorgan Equity Premium Income ETF', price: 58 },
  'JEPQ': { divYield: 9.50, growthRate: 5.0, divGrowth5Y: 0, name: 'JPMorgan Nasdaq Equity Premium Income ETF', price: 55 },
  'DIVO': { divYield: 4.50, growthRate: 6.0, divGrowth5Y: 0, name: 'Amplify CWP Enhanced Dividend Income ETF', price: 38 },
  'XYLD': { divYield: 9.80, growthRate: 2.0, divGrowth5Y: 0, name: 'Global X S&P 500 Covered Call ETF', price: 40 },
  'QYLD': { divYield: 11.0, growthRate: 1.5, divGrowth5Y: 0, name: 'Global X NASDAQ 100 Covered Call ETF', price: 17 },
  'VT':   { divYield: 1.90, growthRate: 7.5, divGrowth5Y: 4.0, name: 'Vanguard Total World Stock ETF', price: 115 },
  'VXUS': { divYield: 2.90, growthRate: 4.5, divGrowth5Y: 3.0, name: 'Vanguard Total International Stock ETF', price: 62 },
  'VEA':  { divYield: 2.80, growthRate: 4.0, divGrowth5Y: 3.5, name: 'Vanguard FTSE Developed Markets ETF', price: 53 },
  'VWO':  { divYield: 3.00, growthRate: 2.5, divGrowth5Y: 2.0, name: 'Vanguard FTSE Emerging Markets ETF', price: 45 },
  'BND':  { divYield: 3.50, growthRate: 0.5, divGrowth5Y: 2.0, name: 'Vanguard Total Bond Market ETF', price: 72 },
  'BNDX': { divYield: 3.00, growthRate: 0.3, divGrowth5Y: 0, name: 'Vanguard Total International Bond ETF', price: 49 },
  'TLT':  { divYield: 3.80, growthRate: -1.0, divGrowth5Y: 0, name: 'iShares 20+ Year Treasury Bond ETF', price: 90 },
  'SHY':  { divYield: 3.20, growthRate: 0.5, divGrowth5Y: 5.0, name: 'iShares 1-3 Year Treasury Bond ETF', price: 82 },
  'AGG':  { divYield: 3.40, growthRate: 0.3, divGrowth5Y: 2.0, name: 'iShares Core US Aggregate Bond ETF', price: 98 },
  'XLK':  { divYield: 0.60, growthRate: 17.5, divGrowth5Y: 5.0, name: 'Technology Select Sector SPDR Fund', price: 220 },
  'XLV':  { divYield: 1.50, growthRate: 8.0, divGrowth5Y: 5.0, name: 'Health Care Select Sector SPDR Fund', price: 145 },
  'XLF':  { divYield: 1.60, growthRate: 9.0, divGrowth5Y: 7.0, name: 'Financial Select Sector SPDR Fund', price: 48 },
  'XLE':  { divYield: 3.20, growthRate: 5.0, divGrowth5Y: 4.0, name: 'Energy Select Sector SPDR Fund', price: 85 },
  'XLRE': { divYield: 3.00, growthRate: 4.0, divGrowth5Y: 3.0, name: 'Real Estate Select Sector SPDR Fund', price: 42 },
  'VNQ':  { divYield: 3.50, growthRate: 3.5, divGrowth5Y: 3.0, name: 'Vanguard Real Estate ETF', price: 88 },
  'SCHH': { divYield: 3.00, growthRate: 3.5, divGrowth5Y: 3.0, name: 'Schwab US REIT ETF', price: 22 },
  'VB':   { divYield: 1.40, growthRate: 7.0, divGrowth5Y: 5.0, name: 'Vanguard Small-Cap ETF', price: 225 },
  'SCHA': { divYield: 1.30, growthRate: 6.5, divGrowth5Y: 5.0, name: 'Schwab US Small-Cap ETF', price: 48 },
  'IJR':  { divYield: 1.30, growthRate: 6.5, divGrowth5Y: 5.0, name: 'iShares Core S&P Small-Cap ETF', price: 115 },
  'VO':   { divYield: 1.40, growthRate: 8.0, divGrowth5Y: 5.0, name: 'Vanguard Mid-Cap ETF', price: 260 },
  'SCHM': { divYield: 1.30, growthRate: 7.5, divGrowth5Y: 5.0, name: 'Schwab US Mid-Cap ETF', price: 48 },
  'ARKK': { divYield: 0.00, growthRate: -5.0, divGrowth5Y: 0, name: 'ARK Innovation ETF', price: 52 },
  'COWZ': { divYield: 1.80, growthRate: 12.0, divGrowth5Y: 5.0, name: 'Pacer US Cash Cows 100 ETF', price: 56 },
  'AVUV': { divYield: 1.60, growthRate: 10.0, divGrowth5Y: 5.0, name: 'Avantis US Small Cap Value ETF', price: 95 },
  'SCHX': { divYield: 1.25, growthRate: 10.5, divGrowth5Y: 6.0, name: 'Schwab US Large-Cap ETF', price: 65 },
};

// ==========================================
// Yahoo Finance — ดึง crumb + cookie
// ==========================================
let yahooCookie = '';
let yahooCrumb = '';

async function initYahooSession() {
  console.log('🔑 Getting Yahoo Finance session...');
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
          console.log(`✅ Yahoo session OK (crumb: ${yahooCrumb.substring(0, 8)}...)\n`);
          return true;
        }
      }
    }
  } catch (e) {
    console.log(`⚠️ Session error: ${e.message}`);
  }
  console.log('⚠️ Yahoo session failed — will use fallback data\n');
  return false;
}

// ==========================================
// Yahoo Finance URL helper
// ==========================================
function yahooUrl(baseUrl) {
  let url = baseUrl;
  if (yahooCrumb) url += (url.includes('?') ? '&' : '?') + `crumb=${encodeURIComponent(yahooCrumb)}`;
  return url;
}

const YAHOO_HEADERS = () => ({
  'Cookie': yahooCookie,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
});

// ==========================================
// Fetch quotes (batch) — ดึง price, name, yield พื้นฐาน
// ==========================================
async function fetchQuotes(symbols) {
  const results = {};
  const batchSize = 10;
  
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    try {
      const url = yahooUrl(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${batch.join(',')}`);
      const res = await fetch(url, { headers: YAHOO_HEADERS() });
      
      if (res.ok) {
        const json = await res.json();
        for (const q of (json?.quoteResponse?.result || [])) {
          results[q.symbol] = {
            price: q.regularMarketPrice || 0,
            name: q.shortName || q.longName || q.symbol,
            // trailingAnnualDividendYield เป็น decimal (0.009 = 0.9%)
            divYield: Math.round((q.trailingAnnualDividendYield || 0) * 10000) / 100,
            trailingDividendRate: q.trailingAnnualDividendRate || 0,
            fiftyTwoWeekHigh: q.fiftyTwoWeekHigh || 0,
            fiftyTwoWeekLow: q.fiftyTwoWeekLow || 0,
            totalAssets: q.totalAssets || q.marketCap || 0,
          };
        }
        console.log(`  ✅ Batch ${Math.floor(i/batchSize)+1}: Got ${(json?.quoteResponse?.result || []).length} quotes`);
      } else {
        console.log(`  ❌ Batch ${Math.floor(i/batchSize)+1}: HTTP ${res.status}`);
      }
    } catch (e) {
      console.log(`  ❌ Batch error: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return results;
}

// ==========================================
// fetchChartData() — รวม 3 อย่างในครั้งเดียว:
//   1. Growth Rate (CAGR จากราคา 5 ปี)
//   2. Div Yield (คำนวณจาก dividend events 12 เดือนล่าสุด)
//   3. Div Growth 5Y (CAGR เงินปันผลรายปี)
// 
// ใช้ range=5y + events=div → เรียก API แค่ 1 ครั้งต่อ symbol
// (เดิม v2 เรียก 2 ครั้ง: fetchGrowth + fetchDivGrowth)
// ==========================================
async function fetchChartData(symbol, currentPrice) {
  const result = { growthRate: 0, calcDivYield: 0, divGrowth5Y: 0 };
  
  try {
    const url = yahooUrl(`https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=5y&events=div`);
    const res = await fetch(url, { headers: YAHOO_HEADERS() });
    if (!res.ok) return result;
    
    const json = await res.json();
    const chartResult = json?.chart?.result?.[0];
    if (!chartResult) return result;
    
    // -----------------------------------------------
    // 1. Growth Rate (CAGR จากราคาปิดรายเดือน 5 ปี)
    // -----------------------------------------------
    const closes = chartResult?.indicators?.quote?.[0]?.close?.filter(c => c != null && c > 0);
    if (closes && closes.length >= 12) {
      const years = closes.length / 12;
      const cagr = (Math.pow(closes[closes.length - 1] / closes[0], 1 / years) - 1) * 100;
      result.growthRate = Math.round(cagr * 100) / 100;
    }
    
    // -----------------------------------------------
    // 2 & 3. Dividend Yield + Div Growth (จาก dividend events)
    // -----------------------------------------------
    const dividends = chartResult?.events?.dividends;
    if (dividends) {
      const divArray = Object.values(dividends)
        .sort((a, b) => a.date - b.date)
        .map(d => ({ date: new Date(d.date * 1000), amount: d.amount }));
      
      if (divArray.length > 0) {
        // --- 2. Div Yield: รวมปันผล 12 เดือนล่าสุด ÷ ราคาปัจจุบัน ---
        const now = Date.now();
        const oneYearAgo = now - (365.25 * 24 * 60 * 60 * 1000);
        const trailing12m = divArray.filter(d => d.date.getTime() >= oneYearAgo);
        
        if (trailing12m.length > 0 && currentPrice > 0) {
          const totalDiv12m = trailing12m.reduce((sum, d) => sum + d.amount, 0);
          result.calcDivYield = Math.round((totalDiv12m / currentPrice) * 10000) / 100;
        }
        
        // --- 3. Div Growth 5Y: CAGR จากปันผลรวมรายปี ---
        // จัดกลุ่มเป็นรายปี (แม่นยำกว่าวิธีเดิมที่ใช้ slice 4 ไตรมาส)
        if (divArray.length >= 4) {
          const divByYear = {};
          for (const d of divArray) {
            const year = d.date.getFullYear();
            if (!divByYear[year]) divByYear[year] = 0;
            divByYear[year] += d.amount;
          }
          
          const allYears = Object.keys(divByYear).sort();
          // ตัดปีปัจจุบันออก (อาจจ่ายยังไม่ครบปี)
          const currentYear = new Date().getFullYear().toString();
          const fullYears = allYears.filter(y => y !== currentYear);
          
          if (fullYears.length >= 2) {
            const firstYearDiv = divByYear[fullYears[0]];
            const lastYearDiv = divByYear[fullYears[fullYears.length - 1]];
            
            if (firstYearDiv > 0 && lastYearDiv > 0) {
              const numYears = fullYears.length - 1;
              const divCagr = (Math.pow(lastYearDiv / firstYearDiv, 1 / numYears) - 1) * 100;
              result.divGrowth5Y = Math.round(divCagr * 100) / 100;
            }
          }
        }
      }
    }
  } catch (e) {
    // silent fail — ใช้ fallback
  }
  
  return result;
}

// ==========================================
// Main
// ==========================================
async function main() {
  console.log('🚀 Starting ETF data update v3.0...');
  console.log(`📊 Symbols: ${UNIQUE_SYMBOLS.length} (deduplicated from ${ETF_SYMBOLS.length})`);
  console.log(`📅 ${new Date().toISOString()}\n`);
  
  const hasSession = await initYahooSession();
  
  // ===== Step 1: ดึง quotes (price, name, basic yield) =====
  console.log('📥 Step 1: Fetching quotes...');
  const quotes = hasSession ? await fetchQuotes(UNIQUE_SYMBOLS) : {};
  const quotesCount = Object.keys(quotes).length;
  console.log(`  → Got ${quotesCount} quotes from Yahoo\n`);
  
  // ===== Step 2: ดึง chart data (growth + div yield + div growth) =====
  // v3: รวมเป็น 1 API call ต่อ symbol (เดิม 2 calls)
  console.log('📈 Step 2: Fetching chart data (growth + dividends) — 1 call per symbol...');
  const chartData = {};
  
  if (hasSession) {
    for (let i = 0; i < UNIQUE_SYMBOLS.length; i++) {
      const sym = UNIQUE_SYMBOLS[i];
      const price = quotes[sym]?.price || FALLBACK_DATA[sym]?.price || 0;
      chartData[sym] = await fetchChartData(sym, price);
      
      if ((i + 1) % 10 === 0 || i === UNIQUE_SYMBOLS.length - 1) {
        console.log(`  ... ${i + 1}/${UNIQUE_SYMBOLS.length} done`);
      }
      await new Promise(r => setTimeout(r, 250));
    }
  }
  console.log(`  → Chart data done for ${Object.keys(chartData).length} symbols\n`);
  
  // ===== Step 3: Build database =====
  console.log('🔧 Step 3: Building database...\n');
  console.log(`  ${'Symbol'.padEnd(8)} ${'Price'.padStart(10)} | ${'Yield'.padStart(7)} ${'[src]'.padEnd(13)} | ${'Growth'.padStart(8)} ${'[src]'.padEnd(10)} | ${'DivGr5Y'.padStart(9)} ${'[src]'.padEnd(10)}`);
  console.log(`  ${'-'.repeat(95)}`);
  
  const database = {};
  let stat = { yahoo: 0, fallback: 0 };
  
  for (const sym of UNIQUE_SYMBOLS) {
    const q = quotes[sym];       // จาก quote API
    const c = chartData[sym];    // จาก chart API
    const fb = FALLBACK_DATA[sym]; // fallback
    
    if (q && q.price > 0) {
      // --- Div Yield: เลือกค่าที่ดีที่สุด ---
      // ลำดับ: Yahoo quote → คำนวณจาก chart dividend events → fallback
      let divYield = 0;
      let yieldSource = 'none';
      
      if (q.divYield > 0) {
        divYield = q.divYield;
        yieldSource = 'yahoo';
      } else if (c?.calcDivYield > 0) {
        divYield = c.calcDivYield;
        yieldSource = 'calculated';
      } else if (fb?.divYield > 0) {
        divYield = fb.divYield;
        yieldSource = 'fallback';
      }
      
      // --- Growth Rate: chart → fallback ---
      let growthRate = 0;
      let growthSource = 'none';
      
      if (c?.growthRate && c.growthRate !== 0) {
        growthRate = c.growthRate;
        growthSource = 'yahoo';
      } else if (fb?.growthRate) {
        growthRate = fb.growthRate;
        growthSource = 'fallback';
      }
      
      // --- Div Growth 5Y: chart → fallback ---
      let divGrowth5Y = 0;
      let divGrowthSource = 'none';
      
      if (c?.divGrowth5Y && c.divGrowth5Y !== 0) {
        divGrowth5Y = c.divGrowth5Y;
        divGrowthSource = 'yahoo';
      } else if (fb?.divGrowth5Y) {
        divGrowth5Y = fb.divGrowth5Y;
        divGrowthSource = 'fallback';
      }
      
      // --- กำหนด source label ---
      const sources = [yieldSource, growthSource, divGrowthSource];
      const hasAnyFallback = sources.some(s => s === 'fallback');
      const source = hasAnyFallback ? 'yahoo+fallback' : 'yahoo';
      
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
        source,
        _sources: { yield: yieldSource, growth: growthSource, divGrowth: divGrowthSource },
      };
      
      const fmtYield = `${divYield.toFixed(2)}%`.padStart(6);
      const fmtGrowth = `${growthRate >= 0 ? '+' : ''}${growthRate.toFixed(2)}%`.padStart(8);
      const fmtDivGr = `${divGrowth5Y >= 0 ? '+' : ''}${divGrowth5Y.toFixed(2)}%`.padStart(8);
      
      console.log(`  ${sym.padEnd(8)} $${q.price.toFixed(2).padStart(9)} | ${fmtYield} [${yieldSource.padEnd(10)}] | ${fmtGrowth} [${growthSource.padEnd(8)}] | ${fmtDivGr} [${divGrowthSource.padEnd(8)}]`);
      stat.yahoo++;
      
    } else if (fb) {
      database[sym] = {
        symbol: sym,
        name: fb.name,
        price: fb.price || 0,
        divYield: fb.divYield || 0,
        growthRate: fb.growthRate || 0,
        divGrowth5Y: fb.divGrowth5Y || 0,
        trailingDividendRate: 0,
        totalAssets: 0,
        fiftyTwoWeekHigh: 0,
        fiftyTwoWeekLow: 0,
        updatedAt: new Date().toISOString(),
        source: 'fallback',
        _sources: { yield: 'fallback', growth: 'fallback', divGrowth: 'fallback' },
      };
      console.log(`  ${sym.padEnd(8)} 📦 FULL FALLBACK`);
      stat.fallback++;
      
    } else {
      console.log(`  ${sym.padEnd(8)} ❌ No data`);
    }
  }
  
  // ===== Step 4: Summary & Save =====
  const allEntries = Object.values(database);
  const yieldStats = { yahoo: 0, calculated: 0, fallback: 0, none: 0 };
  const growthStats = { yahoo: 0, fallback: 0, none: 0 };
  const divGrowthStats = { yahoo: 0, fallback: 0, none: 0 };
  
  for (const entry of allEntries) {
    const s = entry._sources || {};
    yieldStats[s.yield || 'none']++;
    growthStats[s.growth || 'none']++;
    divGrowthStats[s.divGrowth || 'none']++;
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 Data Source Summary (${allEntries.length} symbols):`);
  console.log(`   Yield:     Yahoo ${yieldStats.yahoo} | Calculated ${yieldStats.calculated} | Fallback ${yieldStats.fallback} | None ${yieldStats.none}`);
  console.log(`   Growth:    Yahoo ${growthStats.yahoo} | Fallback ${growthStats.fallback} | None ${growthStats.none}`);
  console.log(`   DivGrowth: Yahoo ${divGrowthStats.yahoo} | Fallback ${divGrowthStats.fallback} | None ${divGrowthStats.none}`);
  console.log(`${'='.repeat(60)}`);
  
  // Save
  const outputPath = path.join(__dirname, '..', 'data', 'etf-database.json');
  const output = {
    _meta: {
      lastUpdated: new Date().toISOString(),
      totalSymbols: Object.keys(database).length,
      fromYahoo: stat.yahoo,
      fromFallback: stat.fallback,
      source: 'Yahoo Finance + Fallback (via GitHub Actions)',
      version: '3.0',
      dataSourceStats: { yield: yieldStats, growth: growthStats, divGrowth: divGrowthStats },
    },
    data: database,
  };
  
  const dataDir = path.dirname(outputPath);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  
  console.log(`\n✅ Yahoo: ${stat.yahoo} | 📦 Fallback: ${stat.fallback} | Total: ${Object.keys(database).length}`);
  console.log(`💾 Saved: ${outputPath} (${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB)`);
  console.log(`${'='.repeat(60)}`);
}

main().catch(console.error);
