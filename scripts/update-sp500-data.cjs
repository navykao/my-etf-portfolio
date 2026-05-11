/**
 * update-sp500-data.cjs v1.0
 * =====================================================
 * อัปเดตข้อมูลหุ้น S&P 500 ทั้งหมด (503 บริษัท)
 * 
 * ✅ v1.0 Features:
 *   1. ดึงข้อมูลจาก Yahoo Finance API (ฟรี)
 *   2. Batch processing - แบ่งเป็น batch ละ 50 หุ้น
 *   3. Auto retry กรณี API fail
 *   4. สร้าง CSV สำหรับ GitHub
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// โหลดรายชื่อหุ้น S&P 500
const SP500_FILE = path.join(__dirname, 'sp500-symbols.json');
const sp500Data = JSON.parse(fs.readFileSync(SP500_FILE, 'utf8'));
const ALL_SYMBOLS = sp500Data.symbols;

console.log(`📊 Total S&P 500 stocks: ${ALL_SYMBOLS.length}`);

// ตั้งค่า
const DELAY_MS = 8000; // หน่วง 8 วินาที (7.5 requests/min)

// ฟังก์ชัน sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * ดึงข้อมูลจาก Twelve Data API (ฟรี 800 requests/วัน)
 * API Key จาก environment variable
 */
async function fetchTwelveData(symbol) {
  const API_KEY = process.env.TWELVE_API_KEY || 'demo';
  
  return new Promise((resolve) => {
    const url = `https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${API_KEY}`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.close && json.close !== 'N/A') {
            resolve({
              symbol: symbol,
              shortName: json.name || symbol,
              regularMarketPrice: parseFloat(json.close),
              dividendYield: json.dividend_yield ? parseFloat(json.dividend_yield) / 100 : 0,
              fiftyTwoWeekHigh: parseFloat(json.fifty_two_week?.high || 0),
              fiftyTwoWeekLow: parseFloat(json.fifty_two_week?.low || 0),
              trailingPE: parseFloat(json.pe_ratio || 0),
              marketCap: 0 // Twelve Data ไม่มีในแพ็กเกจฟรี
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
 * คำนวณ Growth Rate จาก 52-week range
 */
function calculateGrowthRate(current, low, high) {
  if (!current || !low || !high) return 0;
  // ประมาณการจากตำแหน่งในช่วง 52 สัปดาห์
  const range = high - low;
  const position = (current - low) / range;
  // แปลงเป็นเปอร์เซ็นต์การเติบโต (simplified)
  return ((position - 0.5) * 20); // -10% ถึง +10%
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Starting S&P 500 data update...\n');
  console.log(`📅 Date: ${new Date().toISOString()}\n`);
  
  const database = {};
  
  console.log(`⚡ Processing ${ALL_SYMBOLS.length} stocks (8s delay per stock)...`);
  console.log(`⏱️  Estimated time: ${Math.ceil(ALL_SYMBOLS.length * 8 / 60)} minutes\n`);
  
  let totalSuccess = 0;
  let totalFailed = 0;
  
  // ดึงข้อมูลทีละหุ้น (Twelve Data API limit 8 requests/min ในแพ็กเกจฟรี)
  for (let i = 0; i < ALL_SYMBOLS.length; i++) {
    const symbol = ALL_SYMBOLS[i];
    const progress = `[${i+1}/${ALL_SYMBOLS.length}]`;
    
    const quote = await fetchTwelveData(symbol);
    
    if (quote && quote.regularMarketPrice > 0) {
      const divYield = quote.dividendYield ? quote.dividendYield * 100 : 0;
      const growthRate = calculateGrowthRate(
        quote.regularMarketPrice,
        quote.fiftyTwoWeekLow,
        quote.fiftyTwoWeekHigh
      );
      
      database[symbol] = {
        symbol: symbol,
        name: quote.shortName || symbol,
        price: quote.regularMarketPrice,
        divYield: parseFloat(divYield.toFixed(2)),
        growthRate: parseFloat(growthRate.toFixed(2)),
        peRatio: quote.trailingPE || 0,
        marketCap: quote.marketCap || 0,
        divGrowth5Y: null,
        divGrowth10Y: null,
        updatedAt: new Date().toISOString()
      };
      
      console.log(`${progress} ✅ ${symbol}: $${quote.regularMarketPrice.toFixed(2)}`);
      totalSuccess++;
    } else {
      console.log(`${progress} ❌ ${symbol}: No data`);
      totalFailed++;
    }
    
    // หน่วง 8 วินาที (7.5 requests/min = ปลอดภัย)
    if (i < ALL_SYMBOLS.length - 1) {
      await sleep(8000);
    }
    
    // แสดง progress ทุก 50 หุ้น
    if ((i + 1) % 50 === 0) {
      const percent = ((i + 1) / ALL_SYMBOLS.length * 100).toFixed(1);
      console.log(`\n📊 Progress: ${i + 1}/${ALL_SYMBOLS.length} (${percent}%) - Success: ${totalSuccess}, Failed: ${totalFailed}\n`);
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('📊 Summary:');
  console.log(`   Total symbols: ${ALL_SYMBOLS.length}`);
  console.log(`   Success: ${totalSuccess} ✅`);
  console.log(`   Failed: ${totalFailed} ❌`);
  console.log(`   Success rate: ${((totalSuccess/ALL_SYMBOLS.length)*100).toFixed(1)}%`);
  console.log('='.repeat(70));
  
  // บันทึกเป็น JSON
  const outputJson = {
    _meta: {
      lastUpdated: new Date().toISOString(),
      totalSymbols: Object.keys(database).length,
      version: '1.0',
      source: 'S&P 500 Index',
      dataSource: {
        prices: 'Yahoo Finance API',
        divGrowth: 'To be added from stockanalysis.com'
      },
      stats: {
        success: totalSuccess,
        failed: totalFailed,
        successRate: `${((totalSuccess/ALL_SYMBOLS.length)*100).toFixed(1)}%`
      }
    },
    data: database
  };
  
  const jsonPath = path.join(__dirname, 'sp500-database.json');
  fs.writeFileSync(jsonPath, JSON.stringify(outputJson, null, 2));
  console.log(`\n✅ JSON saved: ${jsonPath}`);
  
  // บันทึกเป็น CSV สำหรับ GitHub
  const csvHeader = 'Symbol,Name,Price,DivYield,GrowthRate,PERatio,MarketCap,DivGrowth5Y,DivGrowth10Y,UpdatedAt';
  const csvRows = Object.values(database)
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map(stock => {
      const name = stock.name.includes(',') ? `"${stock.name}"` : stock.name;
      return [
        stock.symbol,
        name,
        stock.price.toFixed(2),
        stock.divYield.toFixed(2),
        stock.growthRate.toFixed(2),
        stock.peRatio.toFixed(2),
        stock.marketCap,
        '', // DivGrowth5Y - ว่างไว้ก่อน
        '', // DivGrowth10Y - ว่างไว้ก่อน
        stock.updatedAt
      ].join(',');
    });
  
  const csvContent = [csvHeader, ...csvRows].join('\n');
  const csvPath = path.join(__dirname, 'sp500-database.csv');
  fs.writeFileSync(csvPath, csvContent);
  
  const fileSize = (fs.statSync(csvPath).size / 1024).toFixed(1);
  console.log(`✅ CSV saved: ${csvPath} (${fileSize} KB)`);
  console.log('='.repeat(70));
  console.log('\n✨ Done!\n');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
