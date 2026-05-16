// ============================================
// update-all-assets.cjs
// อัปเดตข้อมูลหุ้น → stocks.json และ ETFs → etfs.json
//
// Strategy:
//   Phase 1: Finnhub /quote       → ราคา + การเปลี่ยนแปลงรายวัน (PRIMARY)
//   Phase 2: Finnhub /stock/metric → fundamental (divYield, P/E, MarketCap, EPS, 52w)
//   Phase 3: EODHD                 → fallback เฉพาะตัวที่ Finnhub fail
//   Phase 4: Twelve                → fallback สุดท้าย
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
  FMP:     process.env.FMP_API_KEY     || process.env.VITE_FMP0N8_API_KEY  || '',
  EODHD:   process.env.EODHD_API_KEY   || process.env.VITE_EODHD_API_KEY   || '',
  TWELVE:  process.env.TWELVE_DATA_API_KEY || process.env.VITE_TWELVE_DATA_API_KEY || '',
};

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  // ✅ แยกไฟล์ stocks และ ETFs แทน combined
  STOCKS_FILE: path.join(__dirname, '..', 'public', 'data', 'stocks.json'),
  ETFS_FILE:   path.join(__dirname, '..', 'public', 'data', 'etfs.json'),
  FINNHUB_DELAY_MS: 1100,         // ✅ 1.1 วินาที/ตัว (~54 calls/นาที เซฟ)
  FINNHUB_RATE_LIMIT_WAIT: 70000, // ✅ รอ 70 วินาที เมื่อโดน 429
  EODHD_DELAY_MS: 3500,
  TWELVE_DELAY_MS: 1500,
  FETCH_TIMEOUT_MS: 10000,
};

// ============================================
// STATS
// ============================================
const stats = {
  total: 0,
  finnhubPrice:       { success: 0, failed: 0 },
  finnhubFundamental: { success: 0, failed: 0 },
  fmp:                { success: 0, failed: 0 },  // ✅ Phase 3
  eodhd:              { success: 0, failed: 0 },  // Phase 4
  twelve:             { success: 0, failed: 0 },  // Phase 4
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
// API 1A: FINNHUB QUOTE — ราคา + รายวัน
// ดึง: price, change, changePercent, dayHigh, dayLow, open, previousClose
// ============================================
async function fetchFinnhubPrice(symbol) {
  if (!API_KEYS.FINNHUB) return null;
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${API_KEYS.FINNHUB}`;
    const response = await fetchWithTimeout(url);

    if (response.status === 429) {
      console.log(`  [Finnhub] ⏳ Rate limited, waiting 70s...`);
      await sleep(CONFIG.FINNHUB_RATE_LIMIT_WAIT);
      return null;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data && data.c > 0) {
      stats.finnhubPrice.success++;
      return {
        price: data.c,
        change: data.d || 0,
        changePercent: data.dp || 0,
        dayHigh: data.h || 0,
        dayLow: data.l || 0,
        open: data.o || 0,
        previousClose: data.pc || 0,
      };
    }
    return null;
  } catch (error) {
    stats.finnhubPrice.failed++;
    return null;
  }
}

// ============================================
// API 1B: FINNHUB METRIC — Fundamental Data
// ดึง: divYield, peRatio, eps, marketCap, high52w, low52w
// ============================================
async function fetchFinnhubFundamental(symbol) {
  if (!API_KEYS.FINNHUB) return null;
  try {
    const url = `https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${API_KEYS.FINNHUB}`;
    const response = await fetchWithTimeout(url);

    if (response.status === 429) {
      console.log(`  [Finnhub Metric] ⏳ Rate limited, waiting 70s...`);
      await sleep(CONFIG.FINNHUB_RATE_LIMIT_WAIT);
      return null;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data && data.metric) {
      const m = data.metric;
      stats.finnhubFundamental.success++;
      return {
        divYield: m.dividendYieldIndicatedAnnual || 0,
        peRatio: m.peBasicExclExtraTTM || 0,
        eps: m.epsBasicExclExtraTTM || 0,
        marketCap: m.marketCapitalization ? m.marketCapitalization * 1e6 : 0,
        high52w: m['52WeekHigh'] || 0,
        low52w: m['52WeekLow'] || 0,
      };
    }
    return null;
  } catch (error) {
    stats.finnhubFundamental.failed++;
    return null;
  }
}

// ============================================
// API 2B: FINNHUB ETF PROFILE — ETF-specific fields
// ดึง: expenseRatio, totalAssets, numHoldings, trackingIndex
// เรียกเฉพาะ type === 'ETF' เท่านั้น
// ============================================
async function fetchFinnhubETFProfile(symbol) {
  if (!API_KEYS.FINNHUB) return null;
  try {
    const url = `https://finnhub.io/api/v1/etf/profile?symbol=${symbol}&token=${API_KEYS.FINNHUB}`;
    const response = await fetchWithTimeout(url);

    if (response.status === 429) {
      console.log(`  [Finnhub ETF] ⏳ Rate limited, waiting 70s...`);
      await sleep(CONFIG.FINNHUB_RATE_LIMIT_WAIT);
      return null;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data && data.profile) {
      const p = data.profile;
      return {
        totalAssets:    p.totalNav        || 0,
        expenseRatio:   p.expenseRatio    || 0,
        numHoldings:    p.numberOfHoldings || 0,
        trackingIndex:  p.benchmarkIndex  || '',
        inceptionDate:  p.inceptionDate   || '',
      };
    }
    return null;
  } catch (error) {
    return null;
  }
}

// ============================================
// API 3: FMP — Phase 3 fallback (250 req/day)
// ดึง: price, change, changePercent + volume
// ============================================
async function fetchFMP(symbol) {
  if (!API_KEYS.FMP) return null;
  try {
    const url = `https://financialmodelingprep.com/api/v3/quote-short/${symbol}?apikey=${API_KEYS.FMP}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data && data[0] && data[0].price > 0) {
      stats.fmp.success++;
      return {
        price:         data[0].price,
        change:        data[0].change        || 0,
        changePercent: data[0].changesPercentage || 0,
        volume:        data[0].volume         || 0,
        source: 'FMP',
      };
    }
    stats.fmp.failed++;
    return null;
  } catch (error) {
    stats.fmp.failed++;
    return null;
  }
}

// ============================================
// API 4A: EODHD — Phase 4 fallback (20 req/day)
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
// API 4B: TWELVE DATA — Phase 4 fallback สุดท้าย (800 credits/day)
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
  console.log('║  Phase 1 : Finnhub /quote  → ราคา (PRIMARY)        ║');
  console.log('║  Phase 2 : Finnhub /metric → Fundamental Data       ║');
  console.log('║  Phase 2B: Finnhub /etf    → ETF Profile            ║');
  console.log('║  Phase 3 : FMP             → fallback ราคา          ║');
  console.log('║  Phase 4 : EODHD + Twelve  → fallback สุดท้าย      ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  console.log('[Config] API Keys:');
  console.log(`  Finnhub:     ${API_KEYS.FINNHUB ? '✅ Ready' : '❌ Missing (Required!)'}`);
  console.log(`  FMP:         ${API_KEYS.FMP     ? '✅ Ready' : '⚠️  Missing (Phase 3 skip)'}`);
  console.log(`  EODHD:       ${API_KEYS.EODHD   ? '✅ Ready' : '⚠️  Missing (Phase 4 skip)'}`);
  console.log(`  Twelve Data: ${API_KEYS.TWELVE  ? '✅ Ready' : '⚠️  Missing (Phase 4 skip)'}`);
  console.log(`  Delay:       1.1s/ตัว | Rate limit wait: 70s\n`);

  if (!API_KEYS.FINNHUB) {
    console.error('❌ FINNHUB_API_KEY is required!');
    process.exit(1);
  }

  // ✅ Load stocks และ ETFs แยกกัน
  let stocksData = [];
  let etfsData = [];
  try {
    stocksData = JSON.parse(fs.readFileSync(CONFIG.STOCKS_FILE, 'utf8'));
    console.log(`[Data] ✅ Loaded ${stocksData.length} stocks`);
  } catch (error) {
    console.error('[Data] ❌ Failed to load stocks.json:', error.message);
    process.exit(1);
  }
  try {
    etfsData = JSON.parse(fs.readFileSync(CONFIG.ETFS_FILE, 'utf8'));
    console.log(`[Data] ✅ Loaded ${etfsData.length} ETFs\n`);
  } catch (error) {
    console.error('[Data] ❌ Failed to load etfs.json:', error.message);
    process.exit(1);
  }

  const existingData = [...stocksData, ...etfsData];
  stats.total = existingData.length;
  const finnhubFailed = [];
  const now = new Date().toISOString();

  // ============================================
  // PHASE 1: FINNHUB QUOTE — ราคา ทีละตัว 1.1 วิ
  // ============================================
  console.log('═'.repeat(55));
  console.log('📡 PHASE 1: Finnhub /quote (ราคา + รายวัน)');
  console.log(`   ${existingData.length} symbols @ 1.1s/ตัว`);
  console.log(`   Estimated time: ~${Math.ceil(existingData.length * 1.1 / 60)} minutes`);
  console.log('═'.repeat(55));

  for (let i = 0; i < existingData.length; i++) {
    const asset = existingData[i];

    if (i % 50 === 0 && i > 0) {
      const elapsed = formatTime(Date.now() - stats.startTime);
      const pct = ((i / existingData.length) * 100).toFixed(1);
      console.log(`\n  [Progress] ${i}/${existingData.length} (${pct}%) | ✅ ${stats.finnhubPrice.success} | ❌ ${finnhubFailed.length} | ⏱️ ${elapsed}`);
    }

    const data = await fetchFinnhubPrice(asset.symbol);

    if (data) {
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
        priceSource: 'Finnhub',
      };
      if (i < 3 || i % 100 === 0) {
        console.log(`  ✅ ${asset.symbol}: $${data.price} (${data.changePercent > 0 ? '+' : ''}${data.changePercent?.toFixed(2)}%)`);
      }
    } else {
      finnhubFailed.push(asset.symbol);
      if (finnhubFailed.length <= 10) {
        console.log(`  ⚠️  ${asset.symbol}: Finnhub price failed → fallback Phase 3`);
      }
    }

    await sleep(CONFIG.FINNHUB_DELAY_MS);
  }

  console.log(`\n[Phase 1 Done] Finnhub Price: ${stats.finnhubPrice.success}/${existingData.length} ✅ | Failed: ${finnhubFailed.length} ❌`);

  // ============================================
  // PHASE 2: FINNHUB METRIC — Fundamental Data
  // divYield, P/E, EPS, MarketCap, 52w High/Low
  // ============================================
  console.log('\n' + '═'.repeat(55));
  console.log('📡 PHASE 2: Finnhub /metric (Fundamental Data)');
  console.log(`   ${existingData.length} symbols @ 1.1s/ตัว`);
  console.log(`   Estimated time: ~${Math.ceil(existingData.length * 1.1 / 60)} minutes`);
  console.log(`   Fields: divYield, P/E, EPS, MarketCap, 52w High/Low`);
  console.log('═'.repeat(55));

  for (let i = 0; i < existingData.length; i++) {
    const asset = existingData[i];

    if (i % 50 === 0 && i > 0) {
      const elapsed = formatTime(Date.now() - stats.startTime);
      const pct = ((i / existingData.length) * 100).toFixed(1);
      console.log(`\n  [Progress] ${i}/${existingData.length} (${pct}%) | ✅ ${stats.finnhubFundamental.success} | ⏱️ ${elapsed}`);
    }

    const data = await fetchFinnhubFundamental(asset.symbol);

    if (data) {
      existingData[i] = {
        ...existingData[i],
        divYield: data.divYield || existingData[i].divYield || 0,
        peRatio: data.peRatio || existingData[i].peRatio || 0,
        eps: data.eps || existingData[i].eps || 0,
        marketCap: data.marketCap || existingData[i].marketCap || 0,
        high52w: data.high52w || existingData[i].high52w || 0,
        low52w: data.low52w || existingData[i].low52w || 0,
      };
      if (i < 3 || i % 100 === 0) {
        console.log(`  ✅ ${asset.symbol}: P/E=${data.peRatio?.toFixed(2)} | divYield=${data.divYield?.toFixed(2)}% | Cap=${(data.marketCap / 1e9).toFixed(1)}B`);
      }
    } else {
      if (stats.finnhubFundamental.failed <= 10) {
        console.log(`  ⚠️  ${asset.symbol}: Fundamental failed → คงค่าเดิม`);
      }
    }

    await sleep(CONFIG.FINNHUB_DELAY_MS);
  }

  console.log(`\n[Phase 2 Done] Finnhub Fundamental: ${stats.finnhubFundamental.success}/${existingData.length} ✅ | Failed: ${stats.finnhubFundamental.failed} ❌`);

  // ============================================
  // PHASE 2B: FINNHUB ETF PROFILE — ETF fields พิเศษ
  // เรียกเฉพาะ ETF เท่านั้น (ประหยัด API calls)
  // ============================================
  const etfAssets = existingData.filter(a => a.type === 'ETF');
  console.log('\n' + '═'.repeat(55));
  console.log('📡 PHASE 2B: Finnhub ETF Profile (ETF-specific fields)');
  console.log(`   ${etfAssets.length} ETFs @ 1.1s/ตัว`);
  console.log(`   Fields: totalAssets, expenseRatio, numHoldings, trackingIndex`);
  console.log('═'.repeat(55));

  let etfProfileSuccess = 0, etfProfileFailed = 0;
  for (let i = 0; i < existingData.length; i++) {
    const asset = existingData[i];
    if (asset.type !== 'ETF') continue;  // ข้าม stocks

    const profile = await fetchFinnhubETFProfile(asset.symbol);
    if (profile) {
      existingData[i] = {
        ...existingData[i],
        totalAssets:   profile.totalAssets   || existingData[i].totalAssets   || 0,
        expenseRatio:  profile.expenseRatio   || existingData[i].expenseRatio  || 0,
        numHoldings:   profile.numHoldings    || existingData[i].numHoldings   || 0,
        trackingIndex: profile.trackingIndex  || existingData[i].trackingIndex || '',
        inceptionDate: profile.inceptionDate  || existingData[i].inceptionDate || '',
      };
      etfProfileSuccess++;
      if (etfProfileSuccess <= 3 || etfProfileSuccess % 50 === 0) {
        console.log(`  ✅ ${asset.symbol}: AUM=${ (profile.totalAssets/1e9).toFixed(1)}B | ER=${profile.expenseRatio}% | Holdings=${profile.numHoldings}`);
      }
    } else {
      etfProfileFailed++;
    }
    await sleep(CONFIG.FINNHUB_DELAY_MS);
  }
  console.log(`\n[Phase 2B Done] ETF Profile: ${etfProfileSuccess}/${etfAssets.length} ✅ | Failed: ${etfProfileFailed} ❌`);

  // ============================================
  // PHASE 3: FMP — fallback ราคา (250 req/day)
  // เฉพาะตัวที่ Finnhub price fail เท่านั้น
  // ============================================
  const fmpFailed = [];  // ตัวที่ FMP ก็ fail → ส่งต่อ Phase 4

  if (finnhubFailed.length > 0) {
    console.log('\n' + '═'.repeat(55));
    console.log(`📡 PHASE 3: FMP fallback (${finnhubFailed.length} ตัว)`);
    console.log(`   Free tier: 250 req/day | ใช้ไป: ${stats.fmp.success + stats.fmp.failed}`);
    console.log('═'.repeat(55));

    if (!API_KEYS.FMP) {
      console.log('  ⚠️  ไม่มี FMP_API_KEY — ข้าม Phase 3 ทั้งหมด → ไป Phase 4');
      fmpFailed.push(...finnhubFailed);
    } else {
      for (const symbol of finnhubFailed) {
        const idx = existingData.findIndex(a => a.symbol === symbol);
        if (idx < 0) continue;

        // FMP free tier: 250 req/day — เผื่อไว้ 230 เพื่อความปลอดภัย
        if (stats.fmp.success + stats.fmp.failed >= 230) {
          console.log(`  ⚠️  FMP quota ใกล้หมด (${stats.fmp.success + stats.fmp.failed}/230) → ${symbol} ไป Phase 4`);
          fmpFailed.push(symbol);
          continue;
        }

        const data = await fetchFMP(symbol);
        if (data) {
          existingData[idx] = {
            ...existingData[idx],
            price:         data.price,
            change:        data.change,
            changePercent: data.changePercent,
            volume:        data.volume || existingData[idx].volume,
            updatedAt:     now,
            priceSource:   'FMP',
          };
          console.log(`  ✅ [FMP] ${symbol}: $${data.price} (${data.changePercent > 0 ? '+' : ''}${data.changePercent?.toFixed(2)}%)`);
        } else {
          console.log(`  ⚠️  [FMP] ${symbol}: failed → ไป Phase 4`);
          fmpFailed.push(symbol);
        }

        await sleep(300);  // FMP ไม่มี rate limit เข้มงวด — 300ms พอ
      }
    }

    console.log(`\n[Phase 3 Done] FMP: ${stats.fmp.success} ✅ | Failed: ${stats.fmp.failed} ❌ | ส่งต่อ Phase 4: ${fmpFailed.length} ตัว`);
  }

  // ============================================
  // PHASE 4: EODHD + Twelve — fallback สุดท้าย
  // เฉพาะตัวที่ FMP ก็ fail (หรือ FMP ไม่มี key)
  // ============================================
  if (fmpFailed.length > 0) {
    console.log('\n' + '═'.repeat(55));
    console.log(`📡 PHASE 4: EODHD + Twelve (${fmpFailed.length} ตัว)`);
    console.log(`   EODHD: 20 req/day | Twelve: 800 credits/day`);
    console.log('═'.repeat(55));

    for (const symbol of fmpFailed) {
      const idx = existingData.findIndex(a => a.symbol === symbol);
      if (idx < 0) continue;

      let data = null;

      // ลอง EODHD ก่อน (ถ้ายังมี quota)
      if (API_KEYS.EODHD && stats.eodhd.success + stats.eodhd.failed < 18) {
        data = await fetchEODHD(symbol);
        if (data) await sleep(CONFIG.EODHD_DELAY_MS);
      }

      // ถ้า EODHD fail หรือ quota หมด → ลอง Twelve
      if (!data && API_KEYS.TWELVE && stats.twelve.success + stats.twelve.failed < 780) {
        data = await fetchTwelve(symbol);
        if (data) await sleep(CONFIG.TWELVE_DELAY_MS);
      }

      if (data) {
        existingData[idx] = {
          ...existingData[idx],
          price:         data.price,
          change:        data.change,
          changePercent: data.changePercent,
          dayHigh:       data.dayHigh       || existingData[idx].dayHigh,
          dayLow:        data.dayLow        || existingData[idx].dayLow,
          open:          data.open          || existingData[idx].open,
          previousClose: data.previousClose || existingData[idx].previousClose,
          updatedAt:     now,
          priceSource:   data.source,
        };
        console.log(`  ✅ [${data.source}] ${symbol}: $${data.price}`);
      } else {
        console.log(`  ❌ ${symbol}: All APIs failed — คงราคาเดิมไว้`);
      }
    }

    console.log(`\n[Phase 4 Done] EODHD: ${stats.eodhd.success} ✅ | Twelve: ${stats.twelve.success} ✅`);
  }

  // ============================================
  // SAVE — แยกบันทึก stocks.json และ etfs.json
  // ============================================
  console.log('\n' + '═'.repeat(55));
  console.log('💾 Saving...');

  try {
    const dir = path.dirname(CONFIG.STOCKS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const updatedStocks = existingData.filter(a => a.type === 'STOCK');
    const updatedEtfs   = existingData.filter(a => a.type === 'ETF');

    const stocksJson = JSON.stringify(updatedStocks, null, 2);
    const etfsJson   = JSON.stringify(updatedEtfs, null, 2);

    fs.writeFileSync(CONFIG.STOCKS_FILE, stocksJson, 'utf8');
    fs.writeFileSync(CONFIG.ETFS_FILE, etfsJson, 'utf8');

    console.log(`✅ Saved stocks.json: ${updatedStocks.length} items (${(Buffer.byteLength(stocksJson, 'utf8') / 1024).toFixed(1)} KB)`);
    console.log(`✅ Saved etfs.json:   ${updatedEtfs.length} items (${(Buffer.byteLength(etfsJson, 'utf8') / 1024).toFixed(1)} KB)`);
  } catch (error) {
    console.error('❌ Failed to save:', error.message);
    process.exit(1);
  }

  // ============================================
  // FINAL REPORT
  // ============================================
  const totalTime = formatTime(Date.now() - stats.startTime);
  const totalSuccess = stats.finnhubPrice.success + stats.fmp.success + stats.eodhd.success + stats.twelve.success;

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  📊 UPDATE COMPLETE                                 ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Total assets:        ${stats.total}`);
  console.log(`  ✅ Price updated:    ${totalSuccess} (${(totalSuccess / stats.total * 100).toFixed(1)}%)`);
  console.log(`  ✅ Fundamental:      ${stats.finnhubFundamental.success} (divYield, P/E, EPS, MarketCap, 52w)`);
  console.log(`  ⏱️  Total time:      ${totalTime}`);
  console.log('');
  console.log('  Price Sources:');
  console.log(`    Finnhub (P1): ✅ ${stats.finnhubPrice.success} | ❌ ${stats.finnhubPrice.failed}`);
  console.log(`    FMP     (P3): ✅ ${stats.fmp.success}   | ❌ ${stats.fmp.failed}`);
  console.log(`    EODHD   (P4): ✅ ${stats.eodhd.success}   | ❌ ${stats.eodhd.failed}`);
  console.log(`    Twelve  (P4): ✅ ${stats.twelve.success}   | ❌ ${stats.twelve.failed}`);
  console.log('');
  console.log('  Fundamental (Finnhub /metric):');
  console.log(`    Success:    ✅ ${stats.finnhubFundamental.success} | ❌ ${stats.finnhubFundamental.failed}`);

  if (stats.finnhubPrice.failed + stats.eodhd.failed + stats.twelve.failed > stats.total * 0.3) {
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
