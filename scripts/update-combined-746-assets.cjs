/**
 * update-combined-746-assets.cjs v2.0
 * =====================================================
 * อัปเดต 746 Assets:
 *   - S&P 500: 496 หุ้น (EODHD API)
 *   - Top 250 ETF: 250 ตัว (Financial Modeling Prep API)
 * 
 * ✅ Features:
 *   1. ใช้ EODHD API สำหรับหุ้น (ของคุณมีอยู่แล้ว)
 *   2. ใช้ FMP API สำหรับ ETF (ของคุณมีอยู่แล้ว)
 *   3. สร้าง JSON & CSV รวมสำหรับทั้ง 746 assets
 *   4. แสดง Progress และเวลา
 * 
 * API Keys ที่ใช้:
 *   - EODHD_API_KEY (สำหรับหุ้น)
 *   - FMP0N8_API_KEY (สำหรับ ETF)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// โหลดรายชื่อหุ้น S&P 500
const SP500_FILE = path.join(__dirname, 'sp500-symbols.json');
const sp500Data = JSON.parse(fs.readFileSync(SP500_FILE, 'utf8'));
const SP500_SYMBOLS = sp500Data.symbols;

// โหลดรายชื่อ ETF
const ETF_FILE = path.join(__dirname, 'top250-etf-symbols.json');
const etfData = JSON.parse(fs.readFileSync(ETF_FILE, 'utf8'));
const ETF_SYMBOLS = etfData.symbols;

const TOTAL_ASSETS = SP500_SYMBOLS.length + ETF_SYMBOLS.length;

console.log(`📊 Total Assets to update:`);
console.log(`   S&P 500: ${SP500_SYMBOLS.length} stocks`);
console.log(`   Top 250 ETF: ${ETF_SYMBOLS.length} ETFs`);
console.log(`   Total: ${TOTAL_ASSETS} assets\n`);

// ตั้งค่า API - ใช้ API Keys ที่คุณมีอยู่แล้ว
const EODHD_API_KEY = process.env.EODHD_API_KEY || 'demo';
const FMP0N8_API_KEY = process.env.FMP0N8_API_KEY || 'demo';
const DELAY_MS = 8000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * ดึงข้อมูลหุ้น - Twelve Data API
 */
async function fetchEODHDStock(symbol) {
  return new Promise((resolve) => {
    // EODHD API format: https://eodhistoricaldata.com/api/real-time/{symbol}.US?api_token={API_KEY}&fmt=json
    const url = `https://eodhistoricaldata.com/api/real-time/${symbol}.US?api_token=${EODHD_API_KEY}&fmt=json`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          
          if (json.close && json.close > 0) {
            const high52w = parseFloat(json['52_week_high'] || json.close);
            const low52w = parseFloat(json['52_week_low'] || json.close);
            const growthRate = low52w > 0 
              ? ((parseFloat(json.close) - low52w) / low52w * 100) 
              : 0;
            
            resolve({
              symbol: symbol,
              name: json.name || symbol,
              type: 'STOCK',
              price: parseFloat(json.close),
              divYield: (json.dividend_yield || 0),
              growthRate: growthRate,
              peRatio: parseFloat(json.pe || 0),
              marketCap: json.market_cap || 0,
              high52w: high52w,
              low52w: low52w,
              volume: json.volume || 0
            });
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

/**
 * ดึงข้อมูล ETF - Financial Modeling Prep API
 */
async function fetchFMPETF(symbol) {
  return new Promise((resolve) => {
    const url = `https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${FMP0N8_API_KEY}`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const quote = json[0];
          
          if (quote && quote.price) {
            resolve({
              symbol: symbol,
              name: quote.name || symbol,
              type: 'ETF',
              price: quote.price,
              divYield: (quote.dividendYield || 0) * 100,
              growthRate: quote.changesPercentage || 0,
              peRatio: quote.pe || 0,
              marketCap: quote.marketCap || 0,
              high52w: quote.yearHigh || quote.price,
              low52w: quote.yearLow || quote.price,
              volume: quote.volume || 0
            });
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Starting combined update (S&P 500 + Top 250 ETF)...\n');
  console.log(`📅 Date: ${new Date().toISOString()}\n`);
  
  const startTime = Date.now();
  const database = {};
  let totalSuccess = 0;
  let totalFailed = 0;
  
  // ===== UPDATE S&P 500 (STOCKS) =====
  console.log('📈 [1/2] Processing S&P 500 Stocks...\n');
  console.log(`⏱️  Estimated time: ${Math.ceil(SP500_SYMBOLS.length * 8 / 60)} minutes\n`);
  
  for (let i = 0; i < SP500_SYMBOLS.length; i++) {
    const symbol = SP500_SYMBOLS[i];
    const progress = `[${i+1}/${SP500_SYMBOLS.length}]`;
    
    const data = await fetchEODHDStock(symbol);
    
    if (data && data.price > 0) {
      database[symbol] = {
        symbol: symbol,
        name: data.name,
        type: data.type,
        price: parseFloat(data.price.toFixed(2)),
        divYield: parseFloat(data.divYield.toFixed(2)),
        growthRate: parseFloat(data.growthRate.toFixed(2)),
        peRatio: parseFloat(data.peRatio.toFixed(2)),
        marketCap: data.marketCap,
        high52w: parseFloat(data.high52w.toFixed(2)),
        low52w: parseFloat(data.low52w.toFixed(2)),
        volume: data.volume,
        divGrowth5Y: null,
        divGrowth10Y: null,
        updatedAt: new Date().toISOString()
      };
      
      console.log(`${progress} ✅ ${symbol.padEnd(6)} $${data.price.toFixed(2).padStart(8)}`);
      totalSuccess++;
    } else {
      console.log(`${progress} ❌ ${symbol}`);
      totalFailed++;
    }
    
    if (i < SP500_SYMBOLS.length - 1) {
      await sleep(DELAY_MS);
    }
    
    if ((i + 1) % 100 === 0) {
      const percent = ((i + 1) / SP500_SYMBOLS.length * 100).toFixed(1);
      console.log(`\n📊 Stocks Progress: ${i + 1}/${SP500_SYMBOLS.length} (${percent}%) - Success: ${totalSuccess}\n`);
    }
  }
  
  console.log(`\n✅ Stocks complete! Success: ${totalSuccess}/${SP500_SYMBOLS.length}\n`);
  console.log('='.repeat(70));
  
  // ===== UPDATE TOP 250 ETF =====
  console.log('\n📊 [2/2] Processing Top 250 ETFs...\n');
  console.log(`⏱️  Estimated time: ${Math.ceil(ETF_SYMBOLS.length * 8 / 60)} minutes\n`);
  
  let etfSuccess = 0;
  let etfFailed = 0;
  
  for (let i = 0; i < ETF_SYMBOLS.length; i++) {
    const symbol = ETF_SYMBOLS[i];
    const progress = `[${i+1}/${ETF_SYMBOLS.length}]`;
    
    const data = await fetchFMPETF(symbol);
    
    if (data && data.price > 0) {
      database[symbol] = {
        symbol: symbol,
        name: data.name,
        type: data.type,
        price: parseFloat(data.price.toFixed(2)),
        divYield: parseFloat(data.divYield.toFixed(2)),
        growthRate: parseFloat(data.growthRate.toFixed(2)),
        peRatio: parseFloat(data.peRatio.toFixed(2)),
        marketCap: data.marketCap,
        high52w: parseFloat(data.high52w.toFixed(2)),
        low52w: parseFloat(data.low52w.toFixed(2)),
        volume: data.volume,
        divGrowth5Y: null,
        divGrowth10Y: null,
        updatedAt: new Date().toISOString()
      };
      
      console.log(`${progress} ✅ ${symbol.padEnd(6)} $${data.price.toFixed(2).padStart(8)}`);
      totalSuccess++;
      etfSuccess++;
    } else {
      console.log(`${progress} ❌ ${symbol}`);
      totalFailed++;
      etfFailed++;
    }
    
    if (i < ETF_SYMBOLS.length - 1) {
      await sleep(DELAY_MS);
    }
    
    if ((i + 1) % 50 === 0) {
      const percent = ((i + 1) / ETF_SYMBOLS.length * 100).toFixed(1);
      console.log(`\n📊 ETF Progress: ${i + 1}/${ETF_SYMBOLS.length} (${percent}%) - Success: ${etfSuccess}\n`);
    }
  }
  
  console.log(`\n✅ ETFs complete! Success: ${etfSuccess}/${ETF_SYMBOLS.length}\n`);
  console.log('='.repeat(70));
  
  // ===== SUMMARY =====
  const elapsedTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  console.log('\n📊 COMBINED SUMMARY:');
  console.log(`   S&P 500 Stocks: ${totalSuccess - etfSuccess}/${SP500_SYMBOLS.length} ✅`);
  console.log(`   Top 250 ETF: ${etfSuccess}/${ETF_SYMBOLS.length} ✅`);
  console.log(`   Total Success: ${totalSuccess}/${TOTAL_ASSETS}`);
  console.log(`   Total Failed: ${totalFailed}`);
  console.log(`   Success rate: ${((totalSuccess/TOTAL_ASSETS)*100).toFixed(1)}%`);
  console.log(`   Total time: ${elapsedTime} minutes`);
  console.log('='.repeat(70));
  
  // ===== SAVE FILES =====
  
  // JSON
  const outputJson = {
    _meta: {
      lastUpdated: new Date().toISOString(),
      totalAssets: Object.keys(database).length,
      version: '1.0',
      breakdown: {
        stocks: SP500_SYMBOLS.length,
        etfs: ETF_SYMBOLS.length
      },
      dataSource: {
        stocks: 'Twelve Data API (free tier)',
        etfs: 'Financial Modeling Prep API (free tier)',
        quotaUsage: `Stocks: ${totalSuccess - etfSuccess}/800 | ETFs: ${etfSuccess}/250`
      },
      stats: {
        totalSuccess,
        totalFailed,
        successRate: `${((totalSuccess/TOTAL_ASSETS)*100).toFixed(1)}%`,
        elapsedMinutes: parseFloat(elapsedTime)
      }
    },
    data: database
  };
  
  const jsonPath = path.join(__dirname, 'combined-746-assets.json');
  fs.writeFileSync(jsonPath, JSON.stringify(outputJson, null, 2));
  console.log(`\n✅ JSON saved: combined-746-assets.json`);
  
  // CSV
  const csvHeader = 'Symbol,Name,Type,Price,DivYield,GrowthRate,PERatio,MarketCap,High52w,Low52w,Volume,DivGrowth5Y,DivGrowth10Y,UpdatedAt';
  const csvRows = Object.values(database)
    .sort((a, b) => {
      // เรียงหุ้นก่อน ETF
      if (a.type !== b.type) return a.type === 'STOCK' ? -1 : 1;
      return a.symbol.localeCompare(b.symbol);
    })
    .map(asset => {
      const name = asset.name.includes(',') ? `"${asset.name}"` : asset.name;
      return [
        asset.symbol,
        name,
        asset.type,
        asset.price.toFixed(2),
        asset.divYield.toFixed(2),
        asset.growthRate.toFixed(2),
        asset.peRatio.toFixed(2),
        asset.marketCap,
        asset.high52w.toFixed(2),
        asset.low52w.toFixed(2),
        asset.volume,
        '',
        '',
        asset.updatedAt
      ].join(',');
    });
  
  const csvContent = [csvHeader, ...csvRows].join('\n');
  const csvPath = path.join(__dirname, 'combined-746-assets.csv');
  fs.writeFileSync(csvPath, csvContent);
  
  const fileSize = (fs.statSync(csvPath).size / 1024 / 1024).toFixed(2);
  console.log(`✅ CSV saved: combined-746-assets.csv (${fileSize} MB)`);
  console.log('='.repeat(70));
  console.log('\n✨ Done! All 746 assets updated.\n');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
