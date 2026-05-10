/**
 * =====================================================
 * update-etf-data.cjs v2.0 (Fixed - Preserve Symbols)
 * =====================================================
 * อัพเดทข้อมูลหุ้นที่มีอยู่ใน etf-database.json
 * ไม่ overwrite symbols - เก็บรายการหุ้นเดิมไว้
 * 
 * Output: etf-database.json (update prices/yields only)
 * =====================================================
 */

const fs = require('fs');
const path = require('path');

// ==========================================
// 🔄 Read existing database
// ==========================================
const databasePath = path.join(__dirname, '..', 'data', 'etf-database.json');

console.log('🔍 Reading existing database...');
console.log(`   Path: ${databasePath}`);

if (!fs.existsSync(databasePath)) {
  console.error('❌ etf-database.json not found!');
  process.exit(1);
}

const existingDb = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
const SYMBOLS = Object.keys(existingDb.data || {});

console.log(`✅ Found ${SYMBOLS.length} existing symbols`);
console.log(`📋 First 5: ${SYMBOLS.slice(0, 5).join(', ')}`);
console.log('');

// ==========================================
// 📊 Fetch updated data for each symbol
// ==========================================
async function fetchStockData(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`;
    const res = await fetch(url);
    if (!res.ok) return null;
    
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    
    const meta = result.meta;
    const quote = result.indicators?.quote?.[0];
    if (!meta || !quote) return null;
    
    const closes = quote.close.filter(c => c !== null);
    const firstPrice = closes[0];
    const lastPrice = closes[closes.length - 1];
    const growthRate = firstPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
    
    return {
      price: lastPrice || 0,
      divYield: meta.dividendYield ? (meta.dividendYield * 100) : 0,
      growthRate: parseFloat(growthRate.toFixed(2)),
    };
  } catch (error) {
    return null;
  }
}

// ==========================================
// 🎯 Main Function
// ==========================================
async function main() {
  console.log('='.repeat(70));
  console.log('📊 ETF Data Update v2.0 (Preserve Symbols)');
  console.log('='.repeat(70));
  console.log(`📅 ${new Date().toISOString()}`);
  console.log(`📊 Updating ${SYMBOLS.length} symbols`);
  console.log('='.repeat(70));
  console.log('');
  
  const updatedData = {};
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < SYMBOLS.length; i++) {
    const symbol = SYMBOLS[i];
    const existing = existingDb.data[symbol];
    
    const newData = await fetchStockData(symbol);
    
    if (newData) {
      updatedData[symbol] = {
        ...existing,  // Keep old data
        ...newData,   // Update price, yield, growth
      };
      successCount++;
      console.log(`  ✅ ${symbol.padEnd(8)} - $${newData.price.toFixed(2)}`);
    } else {
      // Keep old data if fetch fails
      updatedData[symbol] = existing;
      failCount++;
      console.log(`  ⚠️  ${symbol.padEnd(8)} - Using cached data`);
    }
    
    if ((i + 1) % 10 === 0 || i === SYMBOLS.length - 1) {
      console.log(`  ... Progress: ${i + 1}/${SYMBOLS.length}\n`);
    }
    
    await new Promise(r => setTimeout(r, 250));
  }
  
  console.log('');
  console.log('='.repeat(70));
  console.log('📊 Summary:');
  console.log(`   Updated: ${successCount}`);
  console.log(`   Cached: ${failCount}`);
  console.log(`   Total: ${SYMBOLS.length}`);
  console.log('='.repeat(70));
  
  // Save updated database
  const output = {
    _meta: {
      lastUpdate: new Date().toISOString(),
      totalSymbols: SYMBOLS.length,
      dataSource: 'Yahoo Finance API',
    },
    data: updatedData
  };
  
  fs.writeFileSync(databasePath, JSON.stringify(output, null, 2), 'utf8');
  
  const fileSize = (fs.statSync(databasePath).size / 1024).toFixed(1);
  console.log('');
  console.log(`✅ Database updated: ${databasePath}`);
  console.log(`📦 File size: ${fileSize} KB`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
