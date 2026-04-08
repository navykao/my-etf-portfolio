/**
 * update-etf-data.cjs
 * ====================================
 * GitHub Actions script — รันทุกวันอัตโนมัติ
 * ดึงข้อมูล ETF/หุ้น จาก Yahoo Finance แล้ว save ลง data/etf-database.json
 * 
 * ฟรี 100% — ไม่ต้องใช้ API key
 */

const fs = require('fs');
const path = require('path');

// ==========================================
// รายชื่อ ETF/หุ้น ที่ต้องการติดตาม
// เพิ่ม/ลบได้ตามต้องการ
// ==========================================
const ETF_SYMBOLS = [
  // S&P 500
  'VOO', 'SPY', 'IVV', 'SPLG',
  // Total Market
  'VTI', 'SCHB',
  // Dividend
  'SCHD', 'VYM', 'VIG', 'DGRO', 'HDV', 'DVY',
  // Growth
  'QQQ', 'VGT', 'QQQM', 'MGK', 'SCHG', 'VUG','VOOG',
  // Income / Covered Call
  'JEPI', 'JEPQ', 'DIVO', 'XYLD', 'QYLD','QQQI', 'SPYI',
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
  // Mid Cap
  'VO', 'SCHM',
  // Other popular
  'ARKK', 'COWZ', 'AVUV', 'SCHX',
  // stock
  'V', 'MSFT', 'KO', 'GOOG', 'JPM','AVGO','MO',
];

// ==========================================
// Fallback data — ข้อมูลจริงล่าสุด (อัพเดทเป็นระยะ)
// ใช้เมื่อ Yahoo Finance ดึงไม่ได้
// ==========================================
const FALLBACK_DATA = {
  'VOO':  { divYield: 1.25, growthRate: 10.5, name: 'Vanguard S&P 500 ETF', price: 540 },
  'SPY':  { divYield: 1.20, growthRate: 10.5, name: 'SPDR S&P 500 ETF Trust', price: 587 },
  'IVV':  { divYield: 1.25, growthRate: 10.5, name: 'iShares Core S&P 500 ETF', price: 590 },
  'SPLG': { divYield: 1.25, growthRate: 10.5, name: 'SPDR Portfolio S&P 500 ETF', price: 64 },
  'VTI':  { divYield: 1.30, growthRate: 10.0, name: 'Vanguard Total Stock Market ETF', price: 290 },
  'SCHB': { divYield: 1.25, growthRate: 9.8, name: 'Schwab US Broad Market ETF', price: 60 },
  'SCHD': { divYield: 3.50, growthRate: 8.2, name: 'Schwab US Dividend Equity ETF', price: 28 },
  'VYM':  { divYield: 2.80, growthRate: 6.5, name: 'Vanguard High Dividend Yield ETF', price: 125 },
  'VIG':  { divYield: 1.75, growthRate: 9.0, name: 'Vanguard Dividend Appreciation ETF', price: 195 },
  'DGRO': { divYield: 2.30, growthRate: 8.5, name: 'iShares Core Dividend Growth ETF', price: 62 },
  'HDV':  { divYield: 3.40, growthRate: 5.5, name: 'iShares Core High Dividend ETF', price: 115 },
  'DVY':  { divYield: 3.30, growthRate: 5.0, name: 'iShares Select Dividend ETF', price: 130 },
  'QQQ':  { divYield: 0.55, growthRate: 15.8, name: 'Invesco QQQ Trust', price: 485 },
  'VGT':  { divYield: 0.60, growthRate: 17.0, name: 'Vanguard Information Technology ETF', price: 580 },
  'QQQM': { divYield: 0.55, growthRate: 15.5, name: 'Invesco NASDAQ 100 ETF', price: 200 },
  'MGK':  { divYield: 0.45, growthRate: 16.0, name: 'Vanguard Mega Cap Growth ETF', price: 295 },
  'SCHG': { divYield: 0.35, growthRate: 16.5, name: 'Schwab US Large-Cap Growth ETF', price: 105 },
  'VUG':  { divYield: 0.45, growthRate: 15.0, name: 'Vanguard Growth ETF', price: 380 },
  'JEPI': { divYield: 7.20, growthRate: 3.0, name: 'JPMorgan Equity Premium Income ETF', price: 58 },
  'JEPQ': { divYield: 9.50, growthRate: 5.0, name: 'JPMorgan Nasdaq Equity Premium Income ETF', price: 55 },
  'DIVO': { divYield: 4.50, growthRate: 6.0, name: 'Amplify CWP Enhanced Dividend Income ETF', price: 38 },
  'XYLD': { divYield: 9.80, growthRate: 2.0, name: 'Global X S&P 500 Covered Call ETF', price: 40 },
  'QYLD': { divYield: 11.0, growthRate: 1.5, name: 'Global X NASDAQ 100 Covered Call ETF', price: 17 },
  'VT':   { divYield: 1.90, growthRate: 7.5, name: 'Vanguard Total World Stock ETF', price: 115 },
  'VXUS': { divYield: 2.90, growthRate: 4.5, name: 'Vanguard Total International Stock ETF', price: 62 },
  'VEA':  { divYield: 2.80, growthRate: 4.0, name: 'Vanguard FTSE Developed Markets ETF', price: 53 },
  'VWO':  { divYield: 3.00, growthRate: 2.5, name: 'Vanguard FTSE Emerging Markets ETF', price: 45 },
  'BND':  { divYield: 3.50, growthRate: 0.5, name: 'Vanguard Total Bond Market ETF', price: 72 },
  'BNDX': { divYield: 3.00, growthRate: 0.3, name: 'Vanguard Total International Bond ETF', price: 49 },
  'TLT':  { divYield: 3.80, growthRate: -1.0, name: 'iShares 20+ Year Treasury Bond ETF', price: 90 },
  'SHY':  { divYield: 3.20, growthRate: 0.5, name: 'iShares 1-3 Year Treasury Bond ETF', price: 82 },
  'AGG':  { divYield: 3.40, growthRate: 0.3, name: 'iShares Core US Aggregate Bond ETF', price: 98 },
  'XLK':  { divYield: 0.60, growthRate: 17.5, name: 'Technology Select Sector SPDR Fund', price: 220 },
  'XLV':  { divYield: 1.50, growthRate: 8.0, name: 'Health Care Select Sector SPDR Fund', price: 145 },
  'XLF':  { divYield: 1.60, growthRate: 9.0, name: 'Financial Select Sector SPDR Fund', price: 48 },
  'XLE':  { divYield: 3.20, growthRate: 5.0, name: 'Energy Select Sector SPDR Fund', price: 85 },
  'XLRE': { divYield: 3.00, growthRate: 4.0, name: 'Real Estate Select Sector SPDR Fund', price: 42 },
  'VNQ':  { divYield: 3.50, growthRate: 3.5, name: 'Vanguard Real Estate ETF', price: 88 },
  'SCHH': { divYield: 3.00, growthRate: 3.5, name: 'Schwab US REIT ETF', price: 22 },
  'VB':   { divYield: 1.40, growthRate: 7.0, name: 'Vanguard Small-Cap ETF', price: 225 },
  'SCHA': { divYield: 1.30, growthRate: 6.5, name: 'Schwab US Small-Cap ETF', price: 48 },
  'IJR':  { divYield: 1.30, growthRate: 6.5, name: 'iShares Core S&P Small-Cap ETF', price: 115 },
  'VO':   { divYield: 1.40, growthRate: 8.0, name: 'Vanguard Mid-Cap ETF', price: 260 },
  'SCHM': { divYield: 1.30, growthRate: 7.5, name: 'Schwab US Mid-Cap ETF', price: 48 },
  'ARKK': { divYield: 0.00, growthRate: -5.0, name: 'ARK Innovation ETF', price: 52 },
  'COWZ': { divYield: 1.80, growthRate: 12.0, name: 'Pacer US Cash Cows 100 ETF', price: 56 },
  'AVUV': { divYield: 1.60, growthRate: 10.0, name: 'Avantis US Small Cap Value ETF', price: 95 },
  'SCHX': { divYield: 1.25, growthRate: 10.5, name: 'Schwab US Large-Cap ETF', price: 65 },
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
// Fetch quotes (batch)
// ==========================================
async function fetchQuotes(symbols) {
  const results = {};
  const batchSize = 10;
  
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    try {
      let url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${batch.join(',')}`;
      if (yahooCrumb) url += `&crumb=${encodeURIComponent(yahooCrumb)}`;
      
      const res = await fetch(url, {
        headers: { 'Cookie': yahooCookie, 'User-Agent': 'Mozilla/5.0' }
      });
      
      if (res.ok) {
        const json = await res.json();
        for (const q of (json?.quoteResponse?.result || [])) {
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
// Fetch Growth (CAGR 5Y)
// ==========================================
async function fetchGrowth(symbol) {
  try {
    let url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=5y`;
    if (yahooCrumb) url += `&crumb=${encodeURIComponent(yahooCrumb)}`;
    
    const res = await fetch(url, {
      headers: { 'Cookie': yahooCookie, 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return 0;
    
    const json = await res.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(c => c > 0);
    if (!closes || closes.length < 12) return 0;
    
    const cagr = (Math.pow(closes[closes.length-1] / closes[0], 1 / (closes.length/12)) - 1) * 100;
    return Math.round(cagr * 100) / 100;
  } catch { return 0; }
}

// ==========================================
// Fetch Dividend Growth 5Y (อัตราเติบโตปันผล 5 ปี)
// ==========================================
async function fetchDivGrowth(symbol) {
  try {
    let url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=3mo&range=5y&events=div`;
    if (yahooCrumb) url += `&crumb=${encodeURIComponent(yahooCrumb)}`;
    
    const res = await fetch(url, {
      headers: { 'Cookie': yahooCookie, 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return 0;
    
    const json = await res.json();
    const dividends = json?.chart?.result?.[0]?.events?.dividends;
    if (!dividends) return 0;
    
    // เรียงตามวันที่
    const divArray = Object.values(dividends)
      .sort((a, b) => a.date - b.date)
      .map(d => ({ date: new Date(d.date * 1000), amount: d.amount }));
    
    if (divArray.length < 8) return 0; // ต้องมีอย่างน้อย 2 ปี
    
    // คำนวณปันผลรวมปีแรก vs ปีล่าสุด
    const firstYearDivs = divArray.slice(0, 4).reduce((sum, d) => sum + d.amount, 0);
    const lastYearDivs = divArray.slice(-4).reduce((sum, d) => sum + d.amount, 0);
    
    if (firstYearDivs <= 0) return 0;
    
    // CAGR ของปันผล
    const years = Math.max(1, (divArray.length / 4) - 1);
    const divCagr = (Math.pow(lastYearDivs / firstYearDivs, 1 / years) - 1) * 100;
    return Math.round(divCagr * 100) / 100;
  } catch { return 0; }
}

// ==========================================
// Main
// ==========================================
async function main() {
  console.log('🚀 Starting ETF data update...');
  console.log(`📊 Symbols: ${ETF_SYMBOLS.length}`);
  console.log(`📅 ${new Date().toISOString()}\n`);
  
  const hasSession = await initYahooSession();
  
  // ดึง quotes
  console.log('📥 Fetching quotes...');
  const quotes = hasSession ? await fetchQuotes(ETF_SYMBOLS) : {};
  const quotesCount = Object.keys(quotes).length;
  console.log(`  → Got ${quotesCount} quotes from Yahoo\n`);
  
  // ดึง growth + build database
  console.log('📈 Building database...');
  const database = {};
  let yahooCount = 0, fallbackCount = 0;
  
  for (const sym of ETF_SYMBOLS) {
    const q = quotes[sym];
    const fb = FALLBACK_DATA[sym];
    
    let growthRate = 0;
    let divGrowth5Y = 0;
    if (hasSession && q) {
      [growthRate, divGrowth5Y] = await Promise.all([
        fetchGrowth(sym),
        fetchDivGrowth(sym),
      ]);
      await new Promise(r => setTimeout(r, 200));
    }
    
    if (q && q.price > 0) {
      database[sym] = {
        symbol: sym,
        name: q.name,
        price: q.price,
        divYield: q.divYield > 0 ? q.divYield : (fb?.divYield || 0),
        growthRate: growthRate || (fb?.growthRate || 0),
        divGrowth5Y: divGrowth5Y || 0,
        trailingDividendRate: q.trailingDividendRate,
        totalAssets: q.totalAssets,
        fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: q.fiftyTwoWeekLow,
        updatedAt: new Date().toISOString(),
        source: q.divYield > 0 ? 'yahoo' : 'yahoo+fallback',
      };
      console.log(`  ✅ ${sym}: $${q.price} | Yield: ${database[sym].divYield}% | Growth: ${database[sym].growthRate}% | DivGrowth: ${divGrowth5Y}%`);
      yahooCount++;
    } else if (fb) {
      database[sym] = {
        symbol: sym,
        name: fb.name,
        price: fb.price || 0,
        divYield: fb.divYield,
        growthRate: fb.growthRate,
        trailingDividendRate: 0,
        totalAssets: 0,
        fiftyTwoWeekHigh: 0,
        fiftyTwoWeekLow: 0,
        updatedAt: new Date().toISOString(),
        source: 'fallback',
      };
      console.log(`  📦 ${sym}: FALLBACK | Yield: ${fb.divYield}% | Growth: ${fb.growthRate}%`);
      fallbackCount++;
    } else {
      console.log(`  ❌ ${sym}: No data`);
    }
  }
  
  // Save
  const outputPath = path.join(__dirname, '..', 'data', 'etf-database.json');
  const output = {
    _meta: {
      lastUpdated: new Date().toISOString(),
      totalSymbols: Object.keys(database).length,
      fromYahoo: yahooCount,
      fromFallback: fallbackCount,
      source: 'Yahoo Finance + Fallback (via GitHub Actions)',
      version: '2.1',
    },
    data: database,
  };
  
  const dataDir = path.dirname(outputPath);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Yahoo: ${yahooCount} | 📦 Fallback: ${fallbackCount} | Total: ${Object.keys(database).length}`);
  console.log(`💾 Saved: ${outputPath} (${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB)`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(console.error);
