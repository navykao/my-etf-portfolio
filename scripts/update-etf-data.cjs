/**
 * update-etf-data.cjs v4.0 ✨ NEW: Dividend Frequency Support
 * ====================================
 * GitHub Actions script — รันทุกวันอัตโนมัติ
 * ดึงข้อมูล ETF/หุ้น จาก Yahoo Finance แล้ว save ลง data/etf-database.json
 * 
 * v4.0 Changes (NEW):
 * ✨ เพิ่มฟิลด์ divFrequency (monthly/quarterly/semiannual/annual)
 * ✨ ระบุความถี่การจ่ายปันผลของแต่ละหุ้น/ETF
 * ✨ Frontend ใช้ข้อมูลนี้คำนวณ DRIP แบบแม่นยำ
 * 
 * v3.0 Features:
 * - แก้ปัญหา Yield = 0 โดยคำนวณจาก dividend events จริง (trailing 12 months)
 * - แก้ปัญหา Growth Rate ตก fallback โดยใช้ chart data 5 ปี
 * - แก้ปัญหา Div Growth 5Y ได้ 0 โดยจัดกลุ่มเป็นรายปีแทนรายไตรมาส
 * - รวม Growth + DivGrowth + DivYield ไว้ใน fetchChartData() เรียก API ครั้งเดียว
 * - เพิ่ม log ระบุที่มาของแต่ละค่าชัดเจน (yahoo / calculated / fallback)
 * 
 * ฟรี 100% — ไม่ต้องใช้ API key
 */

const fs = require('fs');
const path = require('path');

// ==========================================
// ✨ NEW: Dividend Frequency Database
// ==========================================
const DIVIDEND_FREQUENCIES = {
  // Monthly payers (จ่ายรายเดือน)
  'JEPI': 'monthly',
  'JEPQ': 'monthly',
  'DIVO': 'monthly',
  'XYLD': 'monthly',
  'QYLD': 'monthly',
  'QQQI': 'monthly',
  'SPYI': 'monthly',
  'O': 'monthly',           // Realty Income
  'STAG': 'monthly',
  'MAIN': 'monthly',
  
  // Quarterly payers (จ่ายรายไตรมาส) - ส่วนใหญ่
  'VOO': 'quarterly',
  'SPY': 'quarterly',
  'IVV': 'quarterly',
  'SPLG': 'quarterly',
  'SPYM': 'quarterly',
  'VTI': 'quarterly',
  'SCHB': 'quarterly',
  'SCHD': 'quarterly',
  'VYM': 'quarterly',
  'VIG': 'quarterly',
  'DGRO': 'quarterly',
  'HDV': 'quarterly',
  'DVY': 'quarterly',
  'QQQ': 'quarterly',
  'VGT': 'quarterly',
  'QQQM': 'quarterly',
  'MGK': 'quarterly',
  'SCHG': 'quarterly',
  'VUG': 'quarterly',
  'VOOG': 'quarterly',
  'VONG': 'quarterly',
  'VT': 'quarterly',
  'VXUS': 'quarterly',
  'VEA': 'quarterly',
  'VWO': 'quarterly',
  'XLK': 'quarterly',
  'XLV': 'quarterly',
  'XLF': 'quarterly',
  'XLE': 'quarterly',
  'XLRE': 'quarterly',
  'VNQ': 'quarterly',
  'SCHH': 'quarterly',
  'VB': 'quarterly',
  'SCHA': 'quarterly',
  'IJR': 'quarterly',
  'VO': 'quarterly',
  'SCHM': 'quarterly',
  'ARKK': 'quarterly',
  'COWZ': 'quarterly',
  'AVUV': 'quarterly',
  'SCHX': 'quarterly',
  'DIA': 'quarterly',
  'SPYG': 'quarterly',
  'SMH': 'quarterly',
  'GLDM': 'quarterly',
  'DGRW': 'quarterly',
  
  // Monthly bond ETFs
  'BND': 'monthly',
  'BNDX': 'monthly',
  'TLT': 'monthly',
  'SHY': 'monthly',
  'AGG': 'monthly',
  'VCIT': 'monthly',
  'VGIT': 'monthly',
  'SGOV': 'monthly',
  
  // Stocks - ส่วนใหญ่จ่ายรายไตรมาส
  'AAPL': 'quarterly',
  'MSFT': 'quarterly',
  'GOOGL': 'quarterly',
  'GOOG': 'quarterly',
  'META': 'quarterly',
  'NVDA': 'quarterly',
  'AVGO': 'quarterly',
  'V': 'quarterly',
  'MA': 'quarterly',
  'JPM': 'quarterly',
  'KO': 'quarterly',
  'PEP': 'quarterly',
  'WMT': 'quarterly',
  'JNJ': 'quarterly',
  'PG': 'quarterly',
  'XOM': 'quarterly',
  'CVX': 'quarterly',
  'LLY': 'quarterly',
  'ABBV': 'quarterly',
  'COST': 'quarterly',
  'TSM': 'quarterly',
  'ASML': 'quarterly',
  'BAC': 'quarterly',
  'CSCO': 'quarterly',
  'MS': 'quarterly',
  'UNH': 'quarterly',
  'MCD': 'quarterly',
  'VZ': 'quarterly',
  'NEE': 'quarterly',
  'DE': 'quarterly',
  'PFE': 'quarterly',
  'LMT': 'quarterly',
  'LOW': 'quarterly',
  'QCOM': 'quarterly',
  'MO': 'quarterly',
  
  // Semiannual (ราย 6 เดือน) - น้อยมาก
  'GLD': 'annual',  // Gold ไม่จ่ายปันผล แต่ใส่ไว้
};

// Default frequency สำหรับหุ้นที่ไม่มีในรายการ
const DEFAULT_FREQUENCY = 'quarterly';

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
// v4: เพิ่ม divFrequency ทุกตัว
// ==========================================
const FALLBACK_DATA = {
  'VOO':  { divYield: 1.25, growthRate: 10.5, divGrowth5Y: 6.5, divFrequency: 'quarterly', name: 'Vanguard S&P 500 ETF', price: 540 },
  'SPY':  { divYield: 1.20, growthRate: 10.5, divGrowth5Y: 6.2, divFrequency: 'quarterly', name: 'SPDR S&P 500 ETF Trust', price: 587 },
  'IVV':  { divYield: 1.25, growthRate: 10.5, divGrowth5Y: 8.1, divFrequency: 'quarterly', name: 'iShares Core S&P 500 ETF', price: 590 },
  'SPLG': { divYield: 1.25, growthRate: 10.5, divGrowth5Y: 6.3, divFrequency: 'quarterly', name: 'SPDR Portfolio S&P 500 ETF', price: 64 },
  'VTI':  { divYield: 1.30, growthRate: 10.0, divGrowth5Y: 6.2, divFrequency: 'quarterly', name: 'Vanguard Total Stock Market ETF', price: 290 },
  'SCHB': { divYield: 1.25, growthRate: 9.8, divGrowth5Y: 12.0, divFrequency: 'quarterly', name: 'Schwab US Broad Market ETF', price: 60 },
  'SCHD': { divYield: 3.50, growthRate: 8.2, divGrowth5Y: 8.7, divFrequency: 'quarterly', name: 'Schwab US Dividend Equity ETF', price: 28 },
  'VYM':  { divYield: 2.80, growthRate: 6.5, divGrowth5Y: 3.2, divFrequency: 'quarterly', name: 'Vanguard High Dividend Yield ETF', price: 125 },
  'VIG':  { divYield: 1.75, growthRate: 9.0, divGrowth5Y: 5.0, divFrequency: 'quarterly', name: 'Vanguard Dividend Appreciation ETF', price: 195 },
  'DGRO': { divYield: 2.30, growthRate: 8.5, divGrowth5Y: 8.2, divFrequency: 'quarterly', name: 'iShares Core Dividend Growth ETF', price: 62 },
  'HDV':  { divYield: 3.40, growthRate: 5.5, divGrowth5Y: 3.9, divFrequency: 'quarterly', name: 'iShares Core High Dividend ETF', price: 115 },
  'DVY':  { divYield: 3.30, growthRate: 5.0, divGrowth5Y: 8.7, divFrequency: 'quarterly', name: 'iShares Select Dividend ETF', price: 130 },
  'QQQ':  { divYield: 0.55, growthRate: 15.8, divGrowth5Y: 12.0, divFrequency: 'quarterly', name: 'Invesco QQQ Trust', price: 485 },
  'VGT':  { divYield: 0.60, growthRate: 17.0, divGrowth5Y: 0.8, divFrequency: 'quarterly', name: 'Vanguard Information Technology ETF', price: 580 },
  'JEPI': { divYield: 7.20, growthRate: 3.0, divGrowth5Y: 0, divFrequency: 'monthly', name: 'JPMorgan Equity Premium Income ETF', price: 58 },
  'JEPQ': { divYield: 9.50, growthRate: 5.0, divGrowth5Y: 0, divFrequency: 'monthly', name: 'JPMorgan Nasdaq Equity Premium Income ETF', price: 55 },
  'BND':  { divYield: 3.50, growthRate: 0.5, divGrowth5Y: 2.0, divFrequency: 'monthly', name: 'Vanguard Total Bond Market ETF', price: 72 },
};

// ==========================================
// Yahoo Finance — ดึง crumb + cookie
// ==========================================
let yahooCookie = '';
let yahooCrumb = '';

async function fetchChartData(symbol, currentPrice) {
  const result = { growthRate: 0, calcDivYield: 0, divGrowth5Y: 0 };
  
  try {
    const url = yahooUrl(`https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=5y&events=div`);
    const res = await fetch(url, { headers: YAHOO_HEADERS() });
    if (!res.ok) return result;
    
    const json = await res.json();
    const chartResult = json?.chart?.result?.[0];
    if (!chartResult) return result;
    
    // 1. Growth Rate (ไม่เปลี่ยน)
    const closes = chartResult?.indicators?.quote?.[0]?.close?.filter(c => c != null && c > 0);
    if (closes && closes.length >= 12) {
      const years = closes.length / 12;
      const cagr = (Math.pow(closes[closes.length - 1] / closes[0], 1 / years) - 1) * 100;
      result.growthRate = Math.round(cagr * 100) / 100;
    }
    
    // 2 & 3. Dividend Yield + Growth (✨ IMPROVED)
    const dividends = chartResult?.events?.dividends;
    if (dividends && Object.keys(dividends).length > 0) {
      const divArray = Object.values(dividends)
        .sort((a, b) => a.date - b.date)
        .map(d => ({ 
          date: new Date(d.date * 1000), 
          amount: d.amount 
        }));
      
      if (divArray.length > 0) {
        // 2. Div Yield: trailing 12 months
        const now = Date.now();
        const oneYearAgo = now - (365.25 * 24 * 60 * 60 * 1000);
        const trailing12m = divArray.filter(d => d.date.getTime() >= oneYearAgo);
        
        if (trailing12m.length > 0 && currentPrice > 0) {
          const totalDiv12m = trailing12m.reduce((sum, d) => sum + d.amount, 0);
          result.calcDivYield = Math.round((totalDiv12m / currentPrice) * 10000) / 100;
        }
        
        // ✨ 3. IMPROVED Div Growth 5Y Calculation
        if (divArray.length >= 8) {  // อย่างน้อย 2 ปี
          const divByYear = {};
          const countByYear = {};
          
          for (const d of divArray) {
            const year = d.date.getFullYear();
            if (!divByYear[year]) {
              divByYear[year] = 0;
              countByYear[year] = 0;
            }
            divByYear[year] += d.amount;
            countByYear[year]++;
          }
          
          const currentYear = new Date().getFullYear();
          const allYears = Object.keys(divByYear).map(Number).sort((a, b) => a - b);
          
          // ✨ กรองเฉพาะปีที่มีข้อมูลครบ (อย่างน้อย 3 payments)
          const fullYears = allYears.filter(year => {
            if (year === currentYear) return countByYear[year] >= 1;
            return countByYear[year] >= 3;  // quarterly ETF จ่าย 4 ครั้ง
          });
          
          if (fullYears.length >= 3) {
            const firstYear = fullYears[0];
            const lastYear = fullYears[fullYears.length - 1];
            const numYears = lastYear - firstYear;
            
            if (numYears >= 2 && divByYear[firstYear] > 0 && divByYear[lastYear] > 0) {
              const divCagr = (Math.pow(divByYear[lastYear] / divByYear[firstYear], 1 / numYears) - 1) * 100;
              
              // ✨ Sanity check: ปกติ Div Growth ไม่น่าจะต่ำกว่า -30% หรือสูงกว่า 50%
              if (divCagr >= -30 && divCagr <= 50) {
                result.divGrowth5Y = Math.round(divCagr * 100) / 100;
              } else {
                console.log(`  ⚠️ ${symbol}: Unusual divGrowth5Y ${divCagr.toFixed(2)}% - rejected`);
              }
            }
          }
        }
      }
    }
  } catch (e) {
    // Silent fail
  }
  
  return result;
}

// ==========================================
// fetchChartData() — Growth + DivYield + DivGrowth
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
    
    // Growth Rate
    const closes = chartResult?.indicators?.quote?.[0]?.close?.filter(c => c != null && c > 0);
    if (closes && closes.length >= 12) {
      const years = closes.length / 12;
      const cagr = (Math.pow(closes[closes.length - 1] / closes[0], 1 / years) - 1) * 100;
      result.growthRate = Math.round(cagr * 100) / 100;
    }
    
    // Dividend Yield + Growth
    const dividends = chartResult?.events?.dividends;
    if (dividends) {
      const divArray = Object.values(dividends)
        .sort((a, b) => a.date - b.date)
        .map(d => ({ date: new Date(d.date * 1000), amount: d.amount }));
      
      if (divArray.length > 0) {
        const now = Date.now();
        const oneYearAgo = now - (365.25 * 24 * 60 * 60 * 1000);
        const trailing12m = divArray.filter(d => d.date.getTime() >= oneYearAgo);
        
        if (trailing12m.length > 0 && currentPrice > 0) {
          const total = trailing12m.reduce((sum, d) => sum + d.amount, 0);
          result.calcDivYield = Math.round((total / currentPrice) * 10000) / 100;
        }
        
        // Div Growth 5Y
        const yearlyDivs = {};
        for (const d of divArray) {
          const year = d.date.getFullYear();
          yearlyDivs[year] = (yearlyDivs[year] || 0) + d.amount;
        }
        
        const years = Object.keys(yearlyDivs).map(Number).sort((a, b) => a - b);
        if (years.length >= 3) {
          const firstYear = years[0];
          const lastYear = years[years.length - 1];
          const numYears = lastYear - firstYear;
          
          if (numYears >= 3 && yearlyDivs[firstYear] > 0 && yearlyDivs[lastYear] > 0) {
            const cagr = (Math.pow(yearlyDivs[lastYear] / yearlyDivs[firstYear], 1 / numYears) - 1) * 100;
            result.divGrowth5Y = Math.round(cagr * 100) / 100;
          }
        }
      }
    }
  } catch (e) {
    // Silent fail
  }
  
  return result;
}

// ==========================================
// Main — Process all symbols
// ==========================================
async function main() {
  console.log(`📊 ETF Data Updater v4.0 (with Dividend Frequency)\n`);
  console.log(`📌 Tracking ${UNIQUE_SYMBOLS.length} symbols\n`);
  
  const hasSession = await initYahooSession();
  
  console.log('📥 Fetching quotes...');
  const quotes = await fetchQuotes(UNIQUE_SYMBOLS);
  console.log(`✅ Got ${Object.keys(quotes).length} quotes\n`);
  
  console.log('📈 Fetching chart data (growth + dividends)...');
  const finalData = {};
  const stats = {
    fromYahoo: 0,
    fromFallback: 0,
    yield: { yahoo: 0, calculated: 0, fallback: 0, none: 0 },
    growth: { yahoo: 0, fallback: 0, none: 0 },
    divGrowth: { yahoo: 0, fallback: 0, none: 0 },
  };
  
  for (const symbol of UNIQUE_SYMBOLS) {
    const quote = quotes[symbol];
    const fallback = FALLBACK_DATA[symbol];
    
    if (!quote && !fallback) {
      console.log(`  ⚠️ ${symbol}: No data`);
      continue;
    }
    
    let price = quote?.price || fallback?.price || 0;
    let name = quote?.name || fallback?.name || symbol;
    let divYield = quote?.divYield || 0;
    let growthRate = 0;
    let divGrowth5Y = 0;
    
    // ✨ NEW: Get dividend frequency
    let divFrequency = DIVIDEND_FREQUENCIES[symbol] || DEFAULT_FREQUENCY;
    
    const sources = { yield: '', growth: '', divGrowth: '' };
    
    // Fetch chart data if we have a session
    if (hasSession && price > 0) {
      const chartData = await fetchChartData(symbol, price);
      
      if (chartData.growthRate !== 0) {
        growthRate = chartData.growthRate;
        sources.growth = 'yahoo';
      }
      
      if (chartData.calcDivYield > 0 && divYield === 0) {
        divYield = chartData.calcDivYield;
        sources.yield = 'calculated';
      } else if (divYield > 0) {
        sources.yield = 'yahoo';
      }
      
      if (chartData.divGrowth5Y !== 0) {
        divGrowth5Y = chartData.divGrowth5Y;
        sources.divGrowth = 'yahoo';
      }
      
      await new Promise(r => setTimeout(r, 200));
    }
    
    // Use fallback if needed
    if (growthRate === 0 && fallback?.growthRate) {
      growthRate = fallback.growthRate;
      sources.growth = 'fallback';
    }
    
    if (divYield === 0 && fallback?.divYield) {
      divYield = fallback.divYield;
      sources.yield = 'fallback';
    }
    
    if (divGrowth5Y === 0 && fallback?.divGrowth5Y) {
      divGrowth5Y = fallback.divGrowth5Y;
      sources.divGrowth = 'fallback';
    }
    
    // Track stats
    if (quote) stats.fromYahoo++;
    else stats.fromFallback++;
    
    if (sources.yield === 'yahoo') stats.yield.yahoo++;
    else if (sources.yield === 'calculated') stats.yield.calculated++;
    else if (sources.yield === 'fallback') stats.yield.fallback++;
    else stats.yield.none++;
    
    if (sources.growth === 'yahoo') stats.growth.yahoo++;
    else if (sources.growth === 'fallback') stats.growth.fallback++;
    else stats.growth.none++;
    
    if (sources.divGrowth === 'yahoo') stats.divGrowth.yahoo++;
    else if (sources.divGrowth === 'fallback') stats.divGrowth.fallback++;
    else stats.divGrowth.none++;
    
    // ✨ NEW: Include divFrequency in final data
    finalData[symbol] = {
      symbol,
      name,
      price: Math.round(price * 100) / 100,
      divYield: Math.round(divYield * 100) / 100,
      growthRate: Math.round(growthRate * 100) / 100,
      divGrowth5Y: Math.round(divGrowth5Y * 100) / 100,
      divFrequency,  // ✨ NEW FIELD
      trailingDividendRate: quote?.trailingDividendRate || 0,
      totalAssets: quote?.totalAssets || 0,
      fiftyTwoWeekHigh: quote?.fiftyTwoWeekHigh || 0,
      fiftyTwoWeekLow: quote?.fiftyTwoWeekLow || 0,
      updatedAt: new Date().toISOString(),
      source: quote ? 'yahoo' : 'fallback',
      _sources: sources,
    };
    
    const freq_label = divFrequency === 'monthly' ? '📅' : divFrequency === 'quarterly' ? '📊' : '📆';
    console.log(`  ✅ ${symbol}: Y=${divYield.toFixed(2)}% G=${growthRate > 0 ? '+' : ''}${growthRate.toFixed(2)}% ${freq_label} ${divFrequency}`);
  }
  
  console.log(`\n✅ Processed ${Object.keys(finalData).length} symbols\n`);
  
  // Save to JSON
  const output = {
    _meta: {
      lastUpdated: new Date().toISOString(),
      totalSymbols: Object.keys(finalData).length,
      fromYahoo: stats.fromYahoo,
      fromFallback: stats.fromFallback,
      source: 'Yahoo Finance + Fallback (via GitHub Actions)',
      version: '4.0',
      features: ['divFrequency'],  // ✨ NEW
      dataSourceStats: {
        yield: stats.yield,
        growth: stats.growth,
        divGrowth: stats.divGrowth,
      },
    },
    data: finalData,
  };
  
  const outputPath = path.join(__dirname, '..', 'data', 'etf-database.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  
  console.log(`💾 Saved to: ${outputPath}`);
  console.log(`📊 Stats:
  - Total: ${Object.keys(finalData).length}
  - From Yahoo: ${stats.fromYahoo}
  - From Fallback: ${stats.fromFallback}
  - Yield (yahoo/calc/fallback/none): ${stats.yield.yahoo}/${stats.yield.calculated}/${stats.yield.fallback}/${stats.yield.none}
  - Growth (yahoo/fallback/none): ${stats.growth.yahoo}/${stats.growth.fallback}/${stats.growth.none}
  - DivGrowth (yahoo/fallback/none): ${stats.divGrowth.yahoo}/${stats.divGrowth.fallback}/${stats.divGrowth.none}
  `);
  
  console.log('✅ Done!');
}

main().catch(console.error);
