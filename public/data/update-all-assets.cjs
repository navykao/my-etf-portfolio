// ============================================
// update-all-assets.cjs
// อัปเดตข้อมูลหุ้นทั้ง 746 ตัว ลง combined-all-assets.json
//
// Strategy:
//   Phase 1: Finnhub  → ราคา + การเปลี่ยนแปลงรายวัน (PRIMARY)
//   Phase 2: Yahoo    → เฉพาะ field ที่ Finnhub ไม่มี
//                       (divYield, P/E, MarketCap, Volume, 52w, EPS)
//   Phase 3: EODHD    → fallback เฉพาะตัวที่ Finnhub fail
//   Phase 4: Twelve   → fallback สุดท้าย
//
// วิธีรัน: node scripts/update-all-assets.cjs
// GitHub Actions รันทุกวัน จันทร์-ศุกร์ วันละ 2 ครั้ง
// ============================================

const fs = require('fs');
const path = require('path');

// ============================================
// API KEYS
// ============================================
const API_KEYS = {
  FINNHUB: process.env.FINNHUB_API_KEY || process.env.VITE_FINNHUB_API_KEY || '',
  EODHD: process.env.EODHD_API_KEY || process.env.VITE_EODHD_API_KEY || '',
  TWELVE: process.env.TWELVE_DATA_API_KEY || process.env.VITE_TWELVE_DATA_API_KEY || '',
};

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  DATA_FILE: path.join(__dirname, '..', 'public', 'data', 'combined-all-assets.json'),
  FINNHUB_DELAY_MS: 1200,      // ✅ ปรับเป็น 1.2 วินาที (เซฟขึ้น)
  YAHOO_BATCH_SIZE: 50,        // Yahoo batch 50 ตัว/ครั้ง
  YAHOO_BATCH_DELAY_MS: 3000,  // 2 วินาที ระหว่าง batch
  EODHD_DELAY_MS: 3500,
  TWELVE_DELAY_MS: 1500,
  FETCH_TIMEOUT_MS: 10000,
};

// ============================================
// STATS
// ============================================
const stats = {
  total: 0,
  finnhub: { success: 0, failed: 0 },
  yahoo: { enriched: 0, failed: 0 },  // Yahoo ทำหน้าที่ "enrich" ไม่ใช่ "replace"
  eodhd: { success: 0, failed: 0 },
  twelve: { success: 0, failed: 0 },
  startTime: Date.now(),
};

// ============================================
// HELPERS
// ============================================
async function fetchWithTimeout(url, timeoutMs = CONFIG.FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
}

// ============================================
// API 1: FINNHUB — ราคา + รายวัน (PRIMARY)
// ดึง: price, change, changePercent, dayHigh, dayLow, open, previousClose
// ============================================
async function fetchFinnhub(symbol) {
  if (!API_KEYS.FINNHUB) return null;
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${API_KEYS.FINNHUB}`;
    const response = await fetchWithTimeout(url);

    if (response.status === 429) {
      console.log(`  [Finnhub] ⏳ Rate limited, waiting 60s...`);
      await sleep(60000);
      return null;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data && data.c > 0) {
      stats.finnhub.success++;
      return {
        price: data.c,
        change: data.d || 0,
        changePercent: data.dp || 0,
        dayHigh: data.h || 0,
        dayLow: data.l || 0,
        open: data.o || 0,
        previousClose: data.pc || 0,
        source: 'Finnhub',
      };
    }
    return null;
  } catch (error) {
    stats.finnhub.failed++;
    return null;
  }
}

// ============================================
// API 2: YAHOO FINANCE — เฉพาะ field ที่ Finnhub ไม่มี
// ดึง: divYield, trailingDividendRate, peRatio, eps,
//       marketCap, volume, avgVolume, high52w, low52w
// batch 50 ตัว/ครั้ง → เร็วมาก, ฟรีไม่จำกัด
// ============================================
async function fetchYahooBatch(symbols) {
  try {
    const symbolsParam = symbols.join(',');
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbolsParam}`;
    const response = await fetchWithTimeout(url, 15000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!data.quoteResponse?.result) return {};

    const results = {};
    data.quoteResponse.result.forEach(quote => {
      if (quote.symbol) {
        // เก็บเฉพาะ field ที่ Finnhub ไม่ได้ให้
        results[quote.symbol] = {
          divYield: (quote.trailingAnnualDividendYield || 0) * 100,
          trailingDividendRate: quote.trailingAnnualDividendRate || 0,
          peRatio: quote.trailingPE || 0,
          eps: quote.epsTrailingTwelveMonths || 0,
          marketCap: quote.marketCap || 0,
          volume: quote.regularMarketVolume || 0,
          avgVolume: quote.averageDailyVolume3Month || 0,
          high52w: quote.fiftyTwoWeekHigh || 0,
          low52w: quote.fiftyTwoWeekLow || 0,
        };
        stats.yahoo.enriched++;
      }
    });
    return results;
  } catch (error) {
    console.error(`  [Yahoo] ❌ Batch error:`, error.message);
    symbols.forEach(() => stats.yahoo.failed++);
    return {};
  }
}

// ============================================
// API 3: EODHD — fallback ราคา (เฉพาะ Finnhub fail)
// ============================================
async function fetchEODHD(symbol) {
  if (!API_KEYS.EODHD) return null;
  try {
    const url = `https://eodhd.com/api/real-time/${symbol}.US?api_token=${API_KEYS.EODHD}&fmt=json`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data && data.close > 0) {
      stats.eodhd.success++;
      return {
        price: parseFloat(data.close),
        change: parseFloat(data.change) || 0,
        changePercent: parseFloat(data.change_p) || 0,
        dayHigh: parseFloat(data.high) || 0,
        dayLow: parseFloat(data.low) || 0,
        open: parseFloat(data.open) || 0,
        previousClose: parseFloat(data.previousClose) || 0,
        volume: parseInt(data.volume) || 0,
        source: 'EODHD',
      };
    }
    return null;
  } catch (error) {
    stats.eodhd.failed++;
    return null;
  }
}

// ============================================
// API 4: TWELVE DATA — fallback สุดท้าย
// ============================================
async function fetchTwelve(symbol) {
  if (!API_KEYS.TWELVE) return null;
  try {
    const url = `https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${API_KEYS.TWELVE}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data && data.close) {
      stats.twelve.success++;
      return {
        price: parseFloat(data.close),
        change: parseFloat(data.change) || 0,
        changePercent: parseFloat(data.percent_change) || 0,
        dayHigh: parseFloat(data.high) || 0,
        dayLow: parseFloat(data.low) || 0,
        open: parseFloat(data.open) || 0,
        previousClose: parseFloat(data.previous_close) || 0,
        volume: parseInt(data.volume) || 0,
        source: 'TwelveData',
      };
    }
    return null;
  } catch (error) {
    stats.twelve.failed++;
    return null;
  }
}

// ============================================
// MAIN UPDATE FUNCTION
// ============================================
async function updateAllAssets() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  📊 ETF Portfolio - Daily Price Update              ║');
  console.log('║  Phase 1: Finnhub  → ราคา (PRIMARY, 1.2s/ตัว)      ║');
  console.log('║  Phase 2: Yahoo    → เพิ่ม field ที่ Finnhub ไม่มี  ║');
  console.log('║  Phase 3: EODHD   → fallback ราคา (Finnhub fail)   ║');
  console.log('║  Phase 4: Twelve  → fallback สุดท้าย               ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  console.log('[Config] API Keys:');
  console.log(`  Finnhub:  ${API_KEYS.FINNHUB ? '✅ Ready' : '❌ Missing'}`);
  console.log(`  EODHD:    ${API_KEYS.EODHD ? '✅ Ready' : '❌ Missing'}`);
  console.log(`  Twelve:   ${API_KEYS.TWELVE ? '✅ Ready' : '❌ Missing'}`);
  console.log(`  Yahoo:    ✅ No key needed (batch 50)\n`);

  if (!API_KEYS.FINNHUB) {
    console.error('❌ FINNHUB_API_KEY is required!');
    process.exit(1);
  }

  // Load existing data
  let existingData = [];
  try {
    const raw = fs.readFileSync(CONFIG.DATA_FILE, 'utf8');
    existingData = JSON.parse(raw);
    console.log(`[Data] ✅ Loaded ${existingData.length} assets\n`);
  } catch (error) {
    console.error('[Data] ❌ Failed to load JSON:', error.message);
    process.exit(1);
  }

  stats.total = existingData.length;
  const finnhubFailed = [];
  const now = new Date().toISOString();

  // ============================================
  // PHASE 1: FINNHUB — ดึงราคา ทีละตัว 1.2 วิ
  // field ที่ได้: price, change, changePercent,
  //              dayHigh, dayLow, open, previousClose
  // ============================================
  console.log('═'.repeat(55));
  console.log('📡 PHASE 1: Finnhub (PRIMARY — ราคา + รายวัน)');
  console.log(`   ${existingData.length} symbols @ 1.2s/ตัว`);
  console.log(`   Estimated time: ~${Math.ceil(existingData.length * 1.2 / 60)} minutes`);
  console.log('═'.repeat(55));

  for (let i = 0; i < existingData.length; i++) {
    const asset = existingData[i];

    if (i % 50 === 0 && i > 0) {
      const elapsed = formatTime(Date.now() - stats.startTime);
      const pct = ((i / existingData.length) * 100).toFixed(1);
      console.log(`\n  [Progress] ${i}/${existingData.length} (${pct}%) | ✅ ${stats.finnhub.success} | ❌ ${finnhubFailed.length} | ⏱️ ${elapsed}`);
    }

    const data = await fetchFinnhub(asset.symbol);

    if (data) {
      // อัพเดทเฉพาะ field ที่ Finnhub ให้ — ไม่แตะ field อื่น
      existingData[i] = {
        ...asset,                          // คง field เดิมทั้งหมด (รวม Yahoo fields)
        price: data.price,
        change: data.change,
        changePercent: data.changePercent,
        dayHigh: data.dayHigh,
        dayLow: data.dayLow,
        open: data.open,
        previousClose: data.previousClose,
        updatedAt: now,
        priceSource: 'Finnhub',
      };

      if (i < 3 || i % 100 === 0) {
        console.log(`  ✅ ${asset.symbol}: $${data.price} (${data.changePercent > 0 ? '+' : ''}${data.changePercent?.toFixed(2)}%)`);
      }
    } else {
      finnhubFailed.push(asset.symbol);
      if (i < 3 || finnhubFailed.length <= 10) {
        console.log(`  ⚠️  ${asset.symbol}: Finnhub failed → จะ fallback Phase 3`);
      }
    }

    await sleep(CONFIG.FINNHUB_DELAY_MS); // 1.2 วินาที
  }

  console.log(`\n[Phase 1 Done] Finnhub: ${stats.finnhub.success}/${existingData.length} ✅ | Failed: ${finnhubFailed.length} ❌`);

  // ============================================
  // PHASE 2: YAHOO — เพิ่ม field ที่ Finnhub ไม่มี
  // field ที่ได้: divYield, peRatio, eps,
  //              marketCap, volume, avgVolume, high52w, low52w
  // ทำกับ ALL 746 ตัว (ไม่ใช่แค่ที่ Finnhub fail)
  // ============================================
  console.log('\n' + '═'.repeat(55));
  console.log('📡 PHASE 2: Yahoo Finance (ENRICH — field ที่ Finnhub ไม่มี)');
  console.log(`   ${existingData.length} symbols in batches of ${CONFIG.YAHOO_BATCH_SIZE}`);
  console.log(`   Estimated time: ~${Math.ceil(existingData.length / CONFIG.YAHOO_BATCH_SIZE) * 2}s`);
  console.log('═'.repeat(55));

  const allSymbols = existingData.map(a => a.symbol);
  const batches = [];
  for (let i = 0; i < allSymbols.length; i += CONFIG.YAHOO_BATCH_SIZE) {
    batches.push(allSymbols.slice(i, i + CONFIG.YAHOO_BATCH_SIZE));
  }

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    console.log(`  [Batch ${b + 1}/${batches.length}] ${batch.length} symbols...`);

    const results = await fetchYahooBatch(batch);

    for (const symbol of batch) {
      const yahooData = results[symbol];
      if (yahooData) {
        const idx = existingData.findIndex(a => a.symbol === symbol);
        if (idx >= 0) {
          // Merge: เพิ่มเฉพาะ field ที่ Yahoo ให้
          // ถ้า field มีค่าอยู่แล้ว (จากข้อมูลเก่า) ให้อัพเดทเสมอ
          // ถ้า Yahoo ให้ค่า 0 → คงค่าเดิมไว้ (ไม่เขียนทับด้วย 0)
          existingData[idx] = {
            ...existingData[idx],
            divYield: yahooData.divYield || existingData[idx].divYield || 0,
            trailingDividendRate: yahooData.trailingDividendRate || existingData[idx].trailingDividendRate || 0,
            peRatio: yahooData.peRatio || existingData[idx].peRatio || 0,
            eps: yahooData.eps || existingData[idx].eps || 0,
            marketCap: yahooData.marketCap || existingData[idx].marketCap || 0,
            volume: yahooData.volume || existingData[idx].volume || 0,
            avgVolume: yahooData.avgVolume || existingData[idx].avgVolume || 0,
            high52w: yahooData.high52w || existingData[idx].high52w || 0,
            low52w: yahooData.low52w || existingData[idx].low52w || 0,
          };
        }
      }
    }

    if (b < batches.length - 1) {
      await sleep(CONFIG.YAHOO_BATCH_DELAY_MS);
    }
  }

  console.log(`\n[Phase 2 Done] Yahoo enriched: ${stats.yahoo.enriched} ✅ | Failed: ${stats.yahoo.failed} ❌`);

  // ============================================
  // PHASE 3 & 4: EODHD + Twelve — ราคา fallback
  // เฉพาะตัวที่ Finnhub fail เท่านั้น
  // ============================================
  if (finnhubFailed.length > 0) {
    console.log('\n' + '═'.repeat(55));
    console.log(`📡 PHASE 3: EODHD + Twelve (fallback ${finnhubFailed.length} ตัวที่ Finnhub fail)`);
    console.log('═'.repeat(55));

    for (const symbol of finnhubFailed) {
      const idx = existingData.findIndex(a => a.symbol === symbol);
      if (idx < 0) continue;

      // ลอง EODHD ก่อน
      let data = null;
      if (API_KEYS.EODHD && stats.eodhd.success + stats.eodhd.failed < 18) {
        data = await fetchEODHD(symbol);
        if (data) await sleep(CONFIG.EODHD_DELAY_MS);
      }

      // ลอง Twelve ถ้า EODHD fail
      if (!data && API_KEYS.TWELVE && stats.twelve.success + stats.twelve.failed < 780) {
        data = await fetchTwelve(symbol);
        if (data) await sleep(CONFIG.TWELVE_DELAY_MS);
      }

      if (data) {
        existingData[idx] = {
          ...existingData[idx],
          price: data.price,
          change: data.change,
          changePercent: data.changePercent,
          dayHigh: data.dayHigh || existingData[idx].dayHigh,
          dayLow: data.dayLow || existingData[idx].dayLow,
          open: data.open || existingData[idx].open,
          previousClose: data.previousClose || existingData[idx].previousClose,
          updatedAt: now,
          priceSource: data.source,
        };
        console.log(`  ✅ [${data.source}] ${symbol}: $${data.price}`);
      } else {
        console.log(`  ❌ ${symbol}: All APIs failed — คงราคาเดิมไว้`);
      }
    }

    console.log(`\n[Phase 3 Done] EODHD: ${stats.eodhd.success} ✅ | Twelve: ${stats.twelve.success} ✅`);
  }

  // ============================================
  // SAVE
  // ============================================
  console.log('\n' + '═'.repeat(55));
  console.log('💾 Saving...');

  try {
    const dir = path.dirname(CONFIG.DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const jsonStr = JSON.stringify(existingData, null, 2);
    fs.writeFileSync(CONFIG.DATA_FILE, jsonStr, 'utf8');

    const fileSizeKB = (Buffer.byteLength(jsonStr, 'utf8') / 1024).toFixed(1);
    console.log(`✅ Saved: ${CONFIG.DATA_FILE} (${fileSizeKB} KB)`);
  } catch (error) {
    console.error('❌ Failed to save:', error.message);
    process.exit(1);
  }

  // ============================================
  // FINAL REPORT
  // ============================================
  const totalTime = formatTime(Date.now() - stats.startTime);
  const totalSuccess = stats.finnhub.success + stats.eodhd.success + stats.twelve.success;

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  📊 UPDATE COMPLETE                                 ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Total assets:     ${stats.total}`);
  console.log(`  ✅ Price updated: ${totalSuccess} (${(totalSuccess / stats.total * 100).toFixed(1)}%)`);
  console.log(`  📊 Yahoo enriched:${stats.yahoo.enriched} (divYield, P/E, MarketCap, etc.)`);
  console.log(`  ⏱️  Total time:   ${totalTime}`);
  console.log('');
  console.log('  Price Sources:');
  console.log(`    Finnhub:    ✅ ${stats.finnhub.success} | ❌ ${stats.finnhub.failed}`);
  console.log(`    EODHD:      ✅ ${stats.eodhd.success} | ❌ ${stats.eodhd.failed}`);
  console.log(`    Twelve:     ✅ ${stats.twelve.success} | ❌ ${stats.twelve.failed}`);
  console.log('');
  console.log('  Fundamental Data (Yahoo):');
  console.log(`    Enriched:   ✅ ${stats.yahoo.enriched} | ❌ ${stats.yahoo.failed}`);

  if (stats.finnhub.failed + stats.eodhd.failed + stats.twelve.failed > stats.total * 0.3) {
    console.error(`\n⚠️ Warning: มี failures มากกว่า 30%`);
    process.exit(1);
  }

  console.log('\n🎉 Done! Data ready for deployment.');
}

// ============================================
// RUN
// ============================================
updateAllAssets().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
