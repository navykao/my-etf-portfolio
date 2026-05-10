#!/usr/bin/env node

/**
 * add-bulk-stocks.cjs
 * 
 * เพิ่มหุ้นจำนวนมากเข้า etf-database.json
 * 
 * วิธีใช้:
 * 1. เตรียมไฟล์ symbols.txt (รายชื่อหุ้น 1 บรรทัด 1 symbol)
 * 2. รันคำสั่ง: node add-bulk-stocks.cjs symbols.txt
 * 3. รอ script ดึงข้อมูลจาก Yahoo Finance
 * 4. ไฟล์ etf-database.json จะถูกอัพเดทอัตโนมัติ
 */

const fs = require('fs');
const path = require('path');

// ==========================================
// Configuration
// ==========================================
const DELAY_MS = 300; // Delay ระหว่าง requests (300ms = ปลอดภัย)
const BATCH_SIZE = 50; // ดึงทีละ 50 หุ้น แล้วบันทึก
const MAX_RETRIES = 3; // Retry สูงสุด 3 ครั้ง

// ==========================================
// Yahoo Finance API
// ==========================================
async function fetchStockData(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    
    const data = await response.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    
    const meta = result.meta;
    const quote = result.indicators?.quote?.[0];
    if (!meta || !quote) return null;
    
    // คำนวณ Growth Rate (1 year)
    const closes = quote.close.filter(c => c !== null);
    const firstPrice = closes[0];
    const lastPrice = closes[closes.length - 1];
    const growthRate = firstPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
    
    return {
      name: meta.longName || meta.shortName || symbol,
      price: lastPrice || 0,
      divYield: meta.dividendYield ? (meta.dividendYield * 100) : 0,
      growthRate: parseFloat(growthRate.toFixed(2)),
      divGrowth5Y: null,
      divGrowth10Y: null,
    };
  } catch (error) {
    console.error(`  ❌ Error fetching ${symbol}:`, error.message);
    return null;
  }
}

// ==========================================
// Retry mechanism
// ==========================================
async function fetchWithRetry(symbol, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    const data = await fetchStockData(symbol);
    if (data) return data;
    
    if (i < retries - 1) {
      console.log(`  ⚠️  Retry ${i + 1}/${retries} for ${symbol}...`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return null;
}

// ==========================================
// Main Function
// ==========================================
async function main() {
  console.log('🚀 Bulk Stock Adder');
  console.log('='.repeat(70));
  
  // 1. อ่านไฟล์ symbols
  const symbolsFile = process.argv[2];
  if (!symbolsFile) {
    console.error('❌ Usage: node add-bulk-stocks.cjs <symbols-file>');
    console.error('   Example: node add-bulk-stocks.cjs symbols.txt');
    process.exit(1);
  }
  
  if (!fs.existsSync(symbolsFile)) {
    console.error(`❌ File not found: ${symbolsFile}`);
    process.exit(1);
  }
  
  const symbolsText = fs.readFileSync(symbolsFile, 'utf8');
  const symbols = symbolsText
    .split('\n')
    .map(s => s.trim().toUpperCase())
    .filter(s => s.length > 0 && !s.startsWith('#'));
  
  console.log(`📋 Found ${symbols.length} symbols to add`);
  console.log('');
  
  // 2. โหลด etf-database.json ปัจจุบัน
  const dbPaths = [
    path.join(__dirname, '..', 'data', 'etf-database.json'),
    path.join(__dirname, 'data', 'etf-database.json'),
    path.join(__dirname, 'etf-database.json'),
  ];
  
  let dbPath = null;
  let database = { _meta: {}, data: {} };
  
  for (const tryPath of dbPaths) {
    if (fs.existsSync(tryPath)) {
      dbPath = tryPath;
      const content = fs.readFileSync(tryPath, 'utf8');
      const parsed = JSON.parse(content);
      database = parsed.data ? parsed : { _meta: {}, data: parsed };
      console.log(`✅ Loaded existing database from: ${tryPath}`);
      console.log(`   Current stocks: ${Object.keys(database.data).length}`);
      break;
    }
  }
  
  if (!dbPath) {
    console.log('⚠️  No existing database found, creating new one');
    dbPath = path.join(__dirname, 'etf-database.json');
  }
  
  console.log('');
  
  // 3. ดึงข้อมูลทีละตัว
  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;
  const startTime = Date.now();
  
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const progress = `[${i + 1}/${symbols.length}]`;
    
    // Skip ถ้ามีอยู่แล้ว
    if (database.data[symbol]) {
      console.log(`${progress} ⏭️  ${symbol.padEnd(8)} - Already exists`);
      skipCount++;
      continue;
    }
    
    // ดึงข้อมูล
    process.stdout.write(`${progress} 🔄 ${symbol.padEnd(8)} - Fetching...`);
    const data = await fetchWithRetry(symbol);
    
    if (data) {
      database.data[symbol] = data;
      successCount++;
      console.log(`\r${progress} ✅ ${symbol.padEnd(8)} - ${data.name.substring(0, 40)}`);
    } else {
      failCount++;
      console.log(`\r${progress} ❌ ${symbol.padEnd(8)} - Failed to fetch`);
    }
    
    // บันทึกทุก BATCH_SIZE หุ้น
    if ((i + 1) % BATCH_SIZE === 0) {
      console.log('');
      console.log(`💾 Saving checkpoint... (${Object.keys(database.data).length} stocks)`);
      const output = {
        _meta: {
          lastUpdate: new Date().toISOString(),
          totalSymbols: Object.keys(database.data).length,
          dataSource: 'Yahoo Finance API',
        },
        data: database.data,
      };
      fs.writeFileSync(dbPath, JSON.stringify(output, null, 2));
      console.log('   ✅ Saved!');
      console.log('');
    }
    
    // Rate limiting
    if (i < symbols.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }
  
  // 4. บันทึกครั้งสุดท้าย
  console.log('');
  console.log('='.repeat(70));
  console.log('💾 Saving final database...');
  
  const output = {
    _meta: {
      lastUpdate: new Date().toISOString(),
      totalSymbols: Object.keys(database.data).length,
      dataSource: 'Yahoo Finance API',
      bulkAddedAt: new Date().toISOString(),
    },
    data: database.data,
  };
  
  fs.writeFileSync(dbPath, JSON.stringify(output, null, 2));
  
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const fileSize = (fs.statSync(dbPath).size / 1024).toFixed(1);
  
  console.log('');
  console.log('='.repeat(70));
  console.log('📊 Summary:');
  console.log(`   ✅ Success: ${successCount}`);
  console.log(`   ⏭️  Skipped: ${skipCount} (already exists)`);
  console.log(`   ❌ Failed:  ${failCount}`);
  console.log(`   📦 Total stocks: ${Object.keys(database.data).length}`);
  console.log(`   ⏱️  Time: ${elapsed} minutes`);
  console.log(`   💾 File: ${dbPath}`);
  console.log(`   📏 Size: ${fileSize} KB`);
  console.log('='.repeat(70));
  console.log('');
  console.log('✅ Done! Next steps:');
  console.log('   1. Commit etf-database.json to GitHub');
  console.log('   2. Run workflow to update historical prices');
  console.log('   3. Check your Stock Screener!');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
