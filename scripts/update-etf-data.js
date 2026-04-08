const fs = require('fs');

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const EODHD_API_KEY = process.env.EODHD_API_KEY;

// รายการหุ้นที่ต้องการอัปเดต
const SYMBOLS = [
  'VOO', 'SPY', 'QQQ', 'VTI', 'SCHD', 'VYM', 'JEPI', 'JEPQ',
  'VIG', 'DGRO', 'HDV', 'DVY', 'NOBL', 'SDY', 'VTV', 'MGK',
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA',
  'JPM', 'JNJ', 'PG', 'KO', 'PEP', 'MCD', 'WMT', 'HD'
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchFromFinnhub(symbol) {
  try {
    const [quoteRes, metricsRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`),
      fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${FINNHUB_API_KEY}`)
    ]);
    const quote = await quoteRes.json();
    const metrics = await metricsRes.json();
    
    if (quote.c > 0) {
      return {
        price: quote.c,
        divYield: metrics.metric?.dividendYieldTTM || 0,
        growthRate: metrics.metric?.epsGrowth5Y || 0,
        peRatio: metrics.metric?.peBasicExclExtraTTM || 0,
        marketCap: metrics.metric?.marketCapitalization || 0
      };
    }
  } catch (e) {
    console.log(`Finnhub error for ${symbol}:`, e.message);
  }
  return null;
}

async function fetchFromEODHD(symbol) {
  try {
    const res = await fetch(`https://eodhd.com/api/real-time/${symbol}.US?api_token=${EODHD_API_KEY}&fmt=json`);
    const data = await res.json();
    if (data.close > 0) {
      return {
        price: data.close,
        divYield: 0,
        growthRate: 0,
        peRatio: 0,
        marketCap: 0
      };
    }
  } catch (e) {
    console.log(`EODHD error for ${symbol}:`, e.message);
  }
  return null;
}

async function main() {
  console.log('🚀 Starting ETF data update...\n');
  
  const results = [];
  const now = new Date().toISOString();
  
  for (const symbol of SYMBOLS) {
    console.log(`📊 Fetching ${symbol}...`);
    
    let data = await fetchFromFinnhub(symbol);
    if (!data) {
      console.log(`   ↳ Trying EODHD fallback...`);
      data = await fetchFromEODHD(symbol);
    }
    
    if (data) {
      results.push({
        symbol,
        ...data,
        updatedAt: now
      });
      console.log(`   ✅ ${symbol}: $${data.price.toFixed(2)}`);
    } else {
      console.log(`   ❌ ${symbol}: Failed to fetch`);
    }
    
    // Rate limiting: 1 second between requests
    await sleep(1000);
  }
  
  // สร้าง CSV
  const csvHeader = 'Symbol,Price,DivYield,GrowthRate,PERatio,MarketCap,UpdatedAt';
  const csvRows = results.map(r => 
    `${r.symbol},${r.price},${r.divYield},${r.growthRate},${r.peRatio},${r.marketCap},${r.updatedAt}`
  );
  const csvContent = [csvHeader, ...csvRows].join('\n');
  
  // บันทึกไฟล์
  fs.writeFileSync('etf-database.csv', csvContent);
  
  console.log(`\n✅ Done! Updated ${results.length}/${SYMBOLS.length} symbols`);
  console.log('📁 Saved to etf-database.csv');
}

main().catch(console.error);
