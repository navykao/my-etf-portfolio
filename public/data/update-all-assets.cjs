// ============================================
// update-all-assets.cjs
// อัปเดตข้อมูลหุ้นทั้ง 746 ตัว ลง combined-all-assets.json
//
// Primary:    Finnhub (60 calls/min, เสถียร, ข้อมูลครบ)
// Fallback 1: Yahoo Finance (batch 50 ตัว, ฟรี unlimited)
// Fallback 2: EODHD (ทีละตัว, 20 calls/day free)
// Fallback 3: Twelve Data (ทีละตัว, 800 calls/day free)
//
// วิธีรัน: node scripts/update-all-assets.cjs
// GitHub Actions รันทุกวัน จันทร์-ศุกร์ หลังตลาดปิด
// ============================================

const fs = require('fs');
const path = require('path');

// ============================================
// API KEYS (จาก GitHub Secrets / Environment)
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
  FINNHUB_RATE_LIMIT: 55,      // ใช้ 55/min (เผื่อ buffer จาก 60/min)
  FINNHUB_DELAY_MS: 1200,      // 1.2 วินาที ระหว่าง request (safe)
  YAHOO_BATCH_SIZE: 50,        // Yahoo batch 50 ตัว/ครั้ง
  YAHOO_BATCH_DELAY_MS: 2000,  // 2 วินาที ระหว่าง batch
  EODHD_DELAY_MS: 3500,        // 3.5 วินาที (20/min safe)
  TWELVE_DELAY_MS: 1500,       // 1.5 วินาที
  FETCH_TIMEOUT_MS: 10000,     // 10 วินาที timeout
};

// ============================================
// STATS TRACKING
// ============================================
const stats = {
  total: 0,
  success: 0,
  failed: 0,
  finnhub: { success: 0, failed: 0 },
  yahoo: { success: 0, failed: 0 },
  eodhd: { success: 0, failed: 0 },
  twelve: { success: 0, failed: 0 },
  startTime: Date.now(),
};

// ============================================
// HELPER: Fetch with timeout
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

// ============================================
// HELPER: Sleep
// ============================================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// HELPER: Format elapsed time
// ============================================
function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
}

// ============================================
// API 1: FINNHUB (Primary - 60 calls/min)
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
// API 2: YAHOO FINANCE (Fallback 1 - batch 50)
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
      if (quote.regularMarketPrice > 0) {
        results[quote.symbol] = {
          price: quote.regularMarketPrice,
          change: quote.regularMarketChange || 0,
          changePercent: quote.regularMarketChangePercent || 0,
          dayHigh: quote.regularMarketDayHigh || 0,
          dayLow: quote.regularMarketDayLow || 0,
          open: quote.regularMarketOpen || 0,
          previousClose: quote.regularMarketPreviousClose || 0,
          divYield: (quote.trailingAnnualDividendYield || 0) * 100,
          trailingDividendRate: quote.trailingAnnualDividendRate || 0,
          volume: quote.regularMarketVolume || 0,
          avgVolume: quote.averageDailyVolume3Month || 0,
          marketCap: quote.marketCap || 0,
          peRatio: quote.trailingPE || 0,
          eps: quote.epsTrailingTwelveMonths || 0,
          high52w: quote.fiftyTwoWeekHigh || 0,
          low52w: quote.fiftyTwoWeekLow || 0,
          source: 'Yahoo',
        };
        stats.yahoo.success++;
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
// API 3: EODHD (Fallback 2 - 20 calls/day free)
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
// API 4: TWELVE DATA (Fallback 3 - 800 calls/day)
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
// MAIN: Fetch single symbol with fallback chain
// ============================================
async function fetchSymbolWithFallback(symbol, skipFinnhub = false) {
  // Try Finnhub first
  if (!skipFinnhub) {
    const data = await fetchFinnhub(symbol);
    if (data) return data;
  }

  // Fallback: will be handled in batch for Yahoo
  // Try EODHD
  if (API_KEYS.EODHD && stats.eodhd.success + stats.eodhd.failed < 18) {
    const data = await fetchEODHD(symbol);
    if (data) {
      await sleep(CONFIG.EODHD_DELAY_MS);
      return data;
    }
  }

  // Try Twelve Data
  if (API_KEYS.TWELVE && stats.twelve.success + stats.twelve.failed < 780) {
    const data = await fetchTwelve(symbol);
    if (data) {
      await sleep(CONFIG.TWELVE_DELAY_MS);
      return data;
    }
  }

  return null;
}

// ============================================
// MAIN UPDATE FUNCTION
// ============================================
async function updateAllAssets() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  📊 ETF Portfolio - Daily Price Update          ║');
  console.log('║  Primary: Finnhub | Fallback: Yahoo/EODHD/12D  ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  // Check API keys
  console.log('[Config] API Keys:');
  console.log(`  Finnhub:    ${API_KEYS.FINNHUB ? '✅ Ready' : '❌ Missing'}`);
  console.log(`  EODHD:      ${API_KEYS.EODHD ? '✅ Ready' : '❌ Missing'}`);
  console.log(`  Twelve:     ${API_KEYS.TWELVE ? '✅ Ready' : '❌ Missing'}`);
  console.log(`  Yahoo:      ✅ No key needed`);
  console.log('');

  if (!API_KEYS.FINNHUB) {
    console.error('❌ FINNHUB API key is required!');
    process.exit(1);
  }

  // Load existing data
  let existingData = [];
  try {
    const raw = fs.readFileSync(CONFIG.DATA_FILE, 'utf8');
    existingData = JSON.parse(raw);
    console.log(`[Data] ✅ Loaded ${existingData.length} assets from JSON`);
  } catch (error) {
    console.error('[Data] ❌ Failed to load JSON:', error.message);
    process.exit(1);
  }

  stats.total = existingData.length;
  const failedSymbols = [];
  const now = new Date().toISOString();

  // ============================================
  // PHASE 1: Finnhub (Primary - ทีละตัว, 60/min)
  // ============================================
  console.log('\n' + '═'.repeat(50));
  console.log('📡 PHASE 1: Finnhub (Primary)');
  console.log(`   ${existingData.length} symbols @ ~55/min`);
  console.log(`   Estimated time: ~${Math.ceil(existingData.length / 55)} minutes`);
  console.log('═'.repeat(50));

  let finnhubCount = 0;

  for (let i = 0; i < existingData.length; i++) {
    const asset = existingData[i];
    const symbol = asset.symbol;

    // Progress
    if (i % 50 === 0 && i > 0) {
      const elapsed = formatTime(Date.now() - stats.startTime);
      const pct = ((i / existingData.length) * 100).toFixed(1);
      console.log(`\n  [Progress] ${i}/${existingData.length} (${pct}%) | ✅ ${stats.success} | ❌ ${failedSymbols.length} | ⏱️ ${elapsed}`);
    }

    // Fetch from Finnhub
    const data = await fetchFinnhub(symbol);

    if (data) {
      // Merge: keep existing fields, update price data
      existingData[i] = {
        ...asset,
        price: data.price,
        change: data.change,
        changePercent: data.changePercent,
        dayHigh: data.dayHigh,
        dayLow: data.dayLow,
        open: data.open,
        previousClose: data.previousClose,
        updatedAt: now,
      };
      stats.success++;
      finnhubCount++;

      if (i < 5 || i % 100 === 0) {
        console.log(`  ✅ ${symbol}: $${data.price}`);
      }
    } else {
      failedSymbols.push(symbol);
    }

    // Rate limit: wait between requests
    await sleep(CONFIG.FINNHUB_DELAY_MS);
  }

  console.log(`\n[Phase 1 Done] Finnhub: ${finnhubCount}/${existingData.length} success`);

  // ============================================
  // PHASE 2: Yahoo Finance (Fallback - batch 50)
  // ============================================
  if (failedSymbols.length > 0) {
    console.log('\n' + '═'.repeat(50));
    console.log(`📡 PHASE 2: Yahoo Finance (${failedSymbols.length} remaining)`);
    console.log(`   Batch size: ${CONFIG.YAHOO_BATCH_SIZE}`);
    console.log('═'.repeat(50));

    // Split into batches of 50
    const batches = [];
    for (let i = 0; i < failedSymbols.length; i += CONFIG.YAHOO_BATCH_SIZE) {
      batches.push(failedSymbols.slice(i, i + CONFIG.YAHOO_BATCH_SIZE));
    }

    const stillFailed = [];

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      console.log(`  [Batch ${b + 1}/${batches.length}] Fetching ${batch.length} symbols...`);

      const results = await fetchYahooBatch(batch);

      for (const symbol of batch) {
        const data = results[symbol];
        if (data) {
          // Find and update in existingData
          const idx = existingData.findIndex(a => a.symbol === symbol);
          if (idx >= 0) {
            existingData[idx] = {
              ...existingData[idx],
              price: data.price,
              change: data.change,
              changePercent: data.changePercent,
              dayHigh: data.dayHigh,
              dayLow: data.dayLow,
              open: data.open,
              previousClose: data.previousClose,
              divYield: data.divYield || existingData[idx].divYield,
              trailingDividendRate: data.trailingDividendRate || existingData[idx].trailingDividendRate,
              volume: data.volume || existingData[idx].volume,
              avgVolume: data.avgVolume || existingData[idx].avgVolume,
              marketCap: data.marketCap || existingData[idx].marketCap,
              peRatio: data.peRatio || existingData[idx].peRatio,
              eps: data.eps || existingData[idx].eps,
              high52w: data.high52w || existingData[idx].high52w,
              low52w: data.low52w || existingData[idx].low52w,
              updatedAt: now,
            };
            stats.success++;
            console.log(`  ✅ [Yahoo] ${symbol}: $${data.price}`);
          }
        } else {
          stillFailed.push(symbol);
        }
      }

      // Wait between batches
      if (b < batches.length - 1) {
        await sleep(CONFIG.YAHOO_BATCH_DELAY_MS);
      }
    }

    console.log(`[Phase 2 Done] Yahoo: ${failedSymbols.length - stillFailed.length}/${failedSymbols.length} success`);

    // ============================================
    // PHASE 3: EODHD + Twelve Data (remaining fails)
    // ============================================
    if (stillFailed.length > 0) {
      console.log('\n' + '═'.repeat(50));
      console.log(`📡 PHASE 3: EODHD + Twelve Data (${stillFailed.length} remaining)`);
      console.log('═'.repeat(50));

      for (const symbol of stillFailed) {
        const data = await fetchSymbolWithFallback(symbol, true); // skip Finnhub
        
        if (data) {
          const idx = existingData.findIndex(a => a.symbol === symbol);
          if (idx >= 0) {
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
            };
            stats.success++;
            console.log(`  ✅ [${data.source}] ${symbol}: $${data.price}`);
          }
        } else {
          stats.failed++;
          console.log(`  ❌ ${symbol}: All APIs failed (keeping old data)`);
        }
      }
    }
  }

  // ============================================
  // SAVE UPDATED DATA
  // ============================================
  console.log('\n' + '═'.repeat(50));
  console.log('💾 Saving updated data...');
  console.log('═'.repeat(50));

  try {
    // Ensure directory exists
    const dir = path.dirname(CONFIG.DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write JSON (pretty print for readability)
    const jsonStr = JSON.stringify(existingData, null, 2);
    fs.writeFileSync(CONFIG.DATA_FILE, jsonStr, 'utf8');

    const fileSizeKB = (Buffer.byteLength(jsonStr, 'utf8') / 1024).toFixed(1);
    console.log(`✅ Saved to: ${CONFIG.DATA_FILE}`);
    console.log(`   File size: ${fileSizeKB} KB`);
  } catch (error) {
    console.error('❌ Failed to save:', error.message);
    process.exit(1);
  }

  // ============================================
  // FINAL REPORT
  // ============================================
  const totalTime = formatTime(Date.now() - stats.startTime);

  console.log('\n' + '╔══════════════════════════════════════════════════╗');
  console.log('║  📊 UPDATE COMPLETE - FINAL REPORT               ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Total assets:    ${stats.total}`);
  console.log(`  ✅ Updated:      ${stats.success} (${(stats.success / stats.total * 100).toFixed(1)}%)`);
  console.log(`  ❌ Failed:       ${stats.failed}`);
  console.log(`  ⏱️  Total time:  ${totalTime}`);
  console.log('');
  console.log('  API Breakdown:');
  console.log(`    Finnhub:    ✅ ${stats.finnhub.success} | ❌ ${stats.finnhub.failed}`);
  console.log(`    Yahoo:      ✅ ${stats.yahoo.success} | ❌ ${stats.yahoo.failed}`);
  console.log(`    EODHD:      ✅ ${stats.eodhd.success} | ❌ ${stats.eodhd.failed}`);
  console.log(`    Twelve:     ✅ ${stats.twelve.success} | ❌ ${stats.twelve.failed}`);
  console.log('');

  // Exit with error if too many failures
  if (stats.failed > stats.total * 0.3) {
    console.error(`⚠️ Warning: ${stats.failed} failures (>${30}% of total)`);
    process.exit(1);
  }

  console.log('🎉 All done! Data is ready for deployment.');
}

// ============================================
// RUN
// ============================================
updateAllAssets().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
