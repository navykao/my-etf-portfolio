/**
 * update-etf-data.cjs
 * ====================================
 * GitHub Actions script — รันทุกวันอัตโนมัติ
 * ดึงข้อมูล ETF จาก Yahoo Finance แล้ว save ลง data/etf-database.json
 * 
 * ข้อมูลที่ดึง:
 * - price (ราคาล่าสุด)
 * - dividendYield (Dividend Yield %)
 * - trailingAnnualDividendRate (เงินปันผลต่อหุ้น)
 * - growthRate (CAGR 5 ปี คำนวณจาก historical price)
 * - name (ชื่อกองทุน)
 * - expenseRatio (ค่าธรรมเนียม)
 * - totalAssets (ขนาดกองทุน)
 * 
 * ฟรี 100% — ไม่ต้องใช้ API key
 */

const fs = require('fs');
const path = require('path');

// ==========================================
// รายชื่อ ETF ที่ต้องการติดตาม
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
  'QQQ', 'VGT', 'QQQM', 'MGK', 'SCHG', 'VUG',
  // Income / Covered Call
  'JEPI', 'JEPQ', 'DIVO', 'XYLD', 'QYLD',
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
];

// ==========================================
// Yahoo Finance Data Fetcher
// ==========================================

/**
 * ดึงข้อมูลพื้นฐาน (price, yield, name) จาก Yahoo Finance quoteSummary
 */
async function fetchQuoteSummary(symbol) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=price,summaryDetail,defaultKeyStatistics,fundProfile`;
  
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    if (!response.ok) {
      console.log(`  ⚠️ quoteSummary failed for ${symbol}: ${response.status}`);
      return null;
    }
    
    const json = await response.json();
    const result = json?.quoteSummary?.result?.[0];
    if (!result) return null;
    
    const price = result.price;
    const summary = result.summaryDetail;
    const keyStats = result.defaultKeyStatistics;
    const fundProfile = result.fundProfile;
    
    return {
      name: price?.shortName || price?.longName || symbol,
      price: price?.regularMarketPrice?.raw || 0,
      currency: price?.currency || 'USD',
      dividendYield: (summary?.dividendYield?.raw || 0) * 100, // แปลงเป็น %
      trailingAnnualDividendRate: summary?.trailingAnnualDividendRate?.raw || 0,
      expenseRatio: (keyStats?.annualReportExpenseRatio?.raw || fundProfile?.feesExpensesInvestment?.annualReportExpenseRatio?.raw || 0) * 100,
      totalAssets: keyStats?.totalAssets?.raw || 0,
      fiftyTwoWeekHigh: summary?.fiftyTwoWeekHigh?.raw || 0,
      fiftyTwoWeekLow: summary?.fiftyTwoWeekLow?.raw || 0,
      beta: keyStats?.beta3Year?.raw || 0,
    };
  } catch (error) {
    console.log(`  ❌ Error fetching quoteSummary for ${symbol}: ${error.message}`);
    return null;
  }
}

/**
 * ดึง historical price 5 ปี แล้วคำนวณ CAGR (Compound Annual Growth Rate)
 */
async function fetchGrowthRate(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=5y`;
  
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    if (!response.ok) return 0;
    
    const json = await response.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(Boolean);
    
    if (!closes || closes.length < 12) return 0;
    
    const startPrice = closes[0];
    const endPrice = closes[closes.length - 1];
    const years = closes.length / 12;
    
    // CAGR formula: (endPrice / startPrice)^(1/years) - 1
    const cagr = (Math.pow(endPrice / startPrice, 1 / years) - 1) * 100;
    
    return Math.round(cagr * 100) / 100; // ปัดทศนิยม 2 ตำแหน่ง
  } catch (error) {
    console.log(`  ❌ Error fetching growth for ${symbol}: ${error.message}`);
    return 0;
  }
}

/**
 * ดึง Dividend Growth Rate (การเติบโตของเงินปันผล 5 ปี)
 */
async function fetchDividendGrowth(symbol) {
  // ดึงข้อมูลเงินปันผลย้อนหลัง 5 ปี
  const fiveYearsAgo = Math.floor(Date.now() / 1000) - (5 * 365 * 24 * 60 * 60);
  const now = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=3mo&range=5y&events=div`;
  
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    if (!response.ok) return 0;
    
    const json = await response.json();
    const dividends = json?.chart?.result?.[0]?.events?.dividends;
    
    if (!dividends) return 0;
    
    // แปลง dividends object เป็น array sorted by date
    const divArray = Object.values(dividends)
      .sort((a, b) => a.date - b.date)
      .map(d => ({ date: new Date(d.date * 1000), amount: d.amount }));
    
    if (divArray.length < 8) return 0; // ต้องมีข้อมูลอย่างน้อย 2 ปี (4 ไตรมาส x 2)
    
    // คำนวณเงินปันผลรายปีของปีแรกและปีล่าสุด
    const firstYearDivs = divArray.slice(0, 4).reduce((sum, d) => sum + d.amount, 0);
    const lastYearDivs = divArray.slice(-4).reduce((sum, d) => sum + d.amount, 0);
    
    if (firstYearDivs <= 0) return 0;
    
    const years = divArray.length / 4; // ประมาณจำนวนปี
    const divGrowth = (Math.pow(lastYearDivs / firstYearDivs, 1 / years) - 1) * 100;
    
    return Math.round(divGrowth * 100) / 100;
  } catch (error) {
    return 0;
  }
}

// ==========================================
// Main Execution
// ==========================================
async function main() {
  console.log('🚀 Starting ETF data update...');
  console.log(`📊 Fetching data for ${ETF_SYMBOLS.length} ETFs`);
  console.log(`📅 ${new Date().toISOString()}\n`);
  
  const database = {};
  let successCount = 0;
  let failCount = 0;
  
  for (const symbol of ETF_SYMBOLS) {
    console.log(`📥 Fetching ${symbol}...`);
    
    // ดึงข้อมูลพร้อมกัน 3 อย่าง
    const [summary, growthRate, divGrowth] = await Promise.all([
      fetchQuoteSummary(symbol),
      fetchGrowthRate(symbol),
      fetchDividendGrowth(symbol),
    ]);
    
    if (summary && summary.price > 0) {
      database[symbol] = {
        symbol,
        name: summary.name,
        price: summary.price,
        currency: summary.currency,
        divYield: Math.round(summary.dividendYield * 100) / 100,
        trailingDividendRate: summary.trailingAnnualDividendRate,
        growthRate: growthRate,
        divGrowth5Y: divGrowth,
        expenseRatio: Math.round(summary.expenseRatio * 1000) / 1000,
        totalAssets: summary.totalAssets,
        fiftyTwoWeekHigh: summary.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: summary.fiftyTwoWeekLow,
        beta: summary.beta,
        updatedAt: new Date().toISOString(),
      };
      
      console.log(`  ✅ ${symbol}: $${summary.price} | Yield: ${database[symbol].divYield}% | Growth: ${growthRate}% | DivGrowth: ${divGrowth}%`);
      successCount++;
    } else {
      console.log(`  ❌ ${symbol}: Failed to fetch data`);
      failCount++;
    }
    
    // Rate limit — รอ 500ms ระหว่างแต่ละ ETF เพื่อไม่ถูก block
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // ==========================================
  // Save to JSON file
  // ==========================================
  const outputPath = path.join(__dirname, '..', 'data', 'etf-database.json');
  
  const output = {
    _meta: {
      lastUpdated: new Date().toISOString(),
      totalSymbols: Object.keys(database).length,
      source: 'Yahoo Finance (via GitHub Actions)',
      version: '2.0',
    },
    data: database,
  };
  
  // สร้างโฟลเดอร์ data/ ถ้ายังไม่มี
  const dataDir = path.dirname(outputPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Success: ${successCount} ETFs`);
  console.log(`❌ Failed: ${failCount} ETFs`);
  console.log(`💾 Saved to: ${outputPath}`);
  console.log(`📦 File size: ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(console.error);
