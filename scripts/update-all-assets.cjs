// ============================================
// update-all-assets.cjs  — v2 (รวม ETF Profile)
// อัปเดตราคา + Fundamental + ETF Profile
//
// Phase 1 : Finnhub /quote        → ราคาทุก asset (หุ้น+ETF) ทุกวัน
// Phase 2 : Finnhub /metric       → P/E, EPS, divYield, MarketCap, 52w ทุกวัน
// Phase 3 : Alpha Vantage         → ETF Profile เฉพาะ ETF ครบ 7 วัน
//           Priority 1: Portfolio ETF
//           Priority 2: Watchlist ETF
//           Priority 3: ETF ทั่วไป (ถ้า quota เหลือ)
// Phase 4 : FMP /quote-short      → fallback ราคา เฉพาะ Finnhub fail
// Phase 5 : EODHD + Twelve Data   → fallback สุดท้าย
//
// Alpha Vantage: 25 req/day (free)
// FMP:           250 req/day (free)
// EODHD:         20 req/day (free)
// Twelve Data:   800 credits/day (free)
//
// วิธีรัน: node scripts/update-all-assets.cjs
// GitHub Actions: ทุกวัน จันทร์-ศุกร์ วันละ 2 ครั้ง
// ============================================

const fs   = require('fs');
const path = require('path');

// ============================================
// ETF PRIORITY LISTS — อ่านจาก etfs.json (dynamic)
// inPortfolio / inWatchlist ถูก sync โดย useFirestore.js
// ============================================
function getEtfPriorityLists(etfsData) {
  const portfolio = etfsData
    .filter(e => e.inPortfolio === true)
    .map(e => e.symbol);
  const watchlist = etfsData
    .filter(e => e.inWatchlist === true && !e.inPortfolio)
    .map(e => e.symbol);
  const priority  = [...new Set([...portfolio, ...watchlist])];
  return { portfolio, watchlist, priority };
}

// ============================================
// API KEYS
// ============================================
const API_KEYS = {
  FINNHUB: process.env.FINNHUB_API_KEY      || process.env.VITE_FINNHUB_API_KEY      || '',
  FMP:     process.env.FMP0N8_API_KEY       || process.env.VITE_FMP0N8_API_KEY       || '',
  EODHD:   process.env.EODHD_API_KEY        || process.env.VITE_EODHD_API_KEY        || '',
  TWELVE:  process.env.TWELVE_DATA_API_KEY  || process.env.VITE_TWELVE_DATA_API_KEY  || '',
  ALPHAV:  process.env.ALPHAVANTAGE_API_KEY || process.env.VITE_ALPHAVANTAGE_API_KEY || '',
};

// ============================================
// CONFIG
// ============================================
const CONFIG = {
  STOCKS_FILE:              path.join(__dirname, '..', 'public', 'data', 'stocks.json'),
  ETFS_FILE:                path.join(__dirname, '..', 'public', 'data', 'etfs.json'),
  FINNHUB_DELAY_MS:         1100,   // ~54 req/min (safe)
  FINNHUB_RATE_LIMIT_WAIT:  70000,  // รอ 70s เมื่อโดน 429
  ALPHAV_DELAY_MS:          12000,  // 12s/req = 5 req/min (free limit)
  ALPHAV_QUOTA:             25,     // free: 25 req/day
  ALPHAV_REFRESH_DAYS:      7,      // อัปเดต ETF Profile ทุก 7 วัน
  FMP_DELAY_MS:             300,
  FMP_QUOTA:                230,    // เผื่อ 20 จาก 250/day
  EODHD_DELAY_MS:           3500,
  EODHD_QUOTA:              18,
  TWELVE_DELAY_MS:          1500,
  TWELVE_QUOTA:             780,
  FETCH_TIMEOUT_MS:         10000,
};

// ============================================
// STATS
// ============================================
const stats = {
  total:              0,
  finnhubPrice:       { success: 0, failed: 0 },
  finnhubFundamental: { success: 0, failed: 0 },
  alphaVantage:       { success: 0, skipped: 0, failed: 0 },
  fmp:                { success: 0, failed: 0 },
  eodhd:              { success: 0, failed: 0 },
  twelve:             { success: 0, failed: 0 },
  startTime:          Date.now(),
};

// ============================================
// HELPERS
// ============================================
async function fetchWithTimeout(url, timeoutMs = CONFIG.FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

// ตรวจว่า ETF นั้นยังไม่ถูก AV update มาในรอบ 7 วัน
function needsAlphaVantageUpdate(etf) {
  if (!etf.profileUpdatedAt) return true; // ยังไม่เคยอัป
  const lastUpdate = new Date(etf.profileUpdatedAt);
  const daysSince  = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= CONFIG.ALPHAV_REFRESH_DAYS;
}

// ============================================
// API 1A: FINNHUB QUOTE — ราคา + รายวัน
// ============================================
async function fetchFinnhubPrice(symbol) {
  if (!API_KEYS.FINNHUB) return null;
  try {
    const url  = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${API_KEYS.FINNHUB}`;
    const res  = await fetchWithTimeout(url);
    if (res.status === 429) {
      console.log(`  [Finnhub] ⏳ Rate limited — รอ 70s...`);
      await sleep(CONFIG.FINNHUB_RATE_LIMIT_WAIT);
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    if (d && d.c > 0) {
      stats.finnhubPrice.success++;
      return {
        price: d.c, change: d.d || 0, changePercent: d.dp || 0,
        dayHigh: d.h || 0, dayLow: d.l || 0,
        open: d.o || 0, previousClose: d.pc || 0,
      };
    }
    stats.finnhubPrice.failed++;
    return null;
  } catch {
    stats.finnhubPrice.failed++;
    return null;
  }
}

// ============================================
// API 1B: FINNHUB METRIC — Fundamental Data
// ============================================
async function fetchFinnhubFundamental(symbol) {
  if (!API_KEYS.FINNHUB) return null;
  try {
    const url = `https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${API_KEYS.FINNHUB}`;
    const res = await fetchWithTimeout(url);
    if (res.status === 429) {
      console.log(`  [Finnhub Metric] ⏳ Rate limited — รอ 70s...`);
      await sleep(CONFIG.FINNHUB_RATE_LIMIT_WAIT);
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    if (d && d.metric) {
      const m = d.metric;
      stats.finnhubFundamental.success++;
      return {
        divYield:  m.dividendYieldIndicatedAnnual || 0,
        peRatio:   m.peBasicExclExtraTTM          || 0,
        eps:       m.epsBasicExclExtraTTM         || 0,
        marketCap: m.marketCapitalization ? m.marketCapitalization * 1e6 : 0,
        high52w:   m['52WeekHigh'] || 0,
        low52w:    m['52WeekLow']  || 0,
      };
    }
    stats.finnhubFundamental.failed++;
    return null;
  } catch {
    stats.finnhubFundamental.failed++;
    return null;
  }
}

// ============================================
// API 3: ALPHA VANTAGE — ETF Profile
// ให้: net_assets, net_expense_ratio, dividend_yield,
//       inception_date, sectors[], holdings[]
// Free: 25 req/day, refresh ทุก 7 วัน
// ============================================
async function fetchAlphaVantageETFProfile(symbol) {
  if (!API_KEYS.ALPHAV) return null;
  try {
    const url = `https://www.alphavantage.co/query?function=ETF_PROFILE&symbol=${symbol}&apikey=${API_KEYS.ALPHAV}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();

    // AV คืน { "Information": "..." } เมื่อ quota หมด
    if (d.Information || d.Note) {
      console.log(`  [AlphaV] ⚠️  Quota หมดหรือ rate limit: ${d.Information || d.Note}`);
      return null;
    }

    if (d && d.net_assets) {
      stats.alphaVantage.success++;
      // sectors: [{ sector, weight }] → หาตัวแรกเป็น primary category
      const topSector = d.sectors && d.sectors.length > 0
        ? d.sectors.sort((a, b) => parseFloat(b.weight) - parseFloat(a.weight))[0].sector
        : '';

      return {
        totalAssets:   parseFloat(d.net_assets)          || 0,
        expenseRatio:  parseFloat(d.net_expense_ratio) * 100 || 0, // AV ให้เป็น decimal เช่น 0.000945
        divYield:      parseFloat(d.dividend_yield)       || 0,
        inceptionDate: d.inception_date                   || '',
        numHoldings:   d.holdings ? d.holdings.length     : 0,
        category:      topSector,
        sectors:       d.sectors  || [],
        holdings:      d.holdings || [],
      };
    }
    stats.alphaVantage.failed++;
    return null;
  } catch {
    stats.alphaVantage.failed++;
    return null;
  }
}

// ============================================
// API 4: FMP /quote-short — fallback ราคา
// ============================================
async function fetchFMP(symbol) {
  if (!API_KEYS.FMP) return null;
  try {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${symbol}&apikey=${API_KEYS.FMP}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    const item = Array.isArray(d) ? d[0] : d;
    if (item && item.price > 0) {
      stats.fmp.success++;
      return {
        price:         item.price,
        change:        item.change             || 0,
        changePercent: item.changePercentage   || 0,
        volume:        item.volume             || 0,
        source:        'FMP',
      };
    }
    stats.fmp.failed++;
    return null;
  } catch {
    stats.fmp.failed++;
    return null;
  }
}

// ============================================
// API 5A: EODHD — fallback สุดท้าย
// ============================================
async function fetchEODHD(symbol) {
  if (!API_KEYS.EODHD) return null;
  try {
    const url = `https://eodhd.com/api/real-time/${symbol}.US?api_token=${API_KEYS.EODHD}&fmt=json`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    if (d && d.close > 0) {
      stats.eodhd.success++;
      return {
        price:         parseFloat(d.close),
        change:        parseFloat(d.change)        || 0,
        changePercent: parseFloat(d.change_p)      || 0,
        dayHigh:       parseFloat(d.high)          || 0,
        dayLow:        parseFloat(d.low)           || 0,
        open:          parseFloat(d.open)          || 0,
        previousClose: parseFloat(d.previousClose) || 0,
        volume:        parseInt(d.volume)          || 0,
        source:        'EODHD',
      };
    }
    stats.eodhd.failed++;
    return null;
  } catch {
    stats.eodhd.failed++;
    return null;
  }
}

// ============================================
// API 5B: TWELVE DATA — fallback สุดท้าย
// ============================================
async function fetchTwelve(symbol) {
  if (!API_KEYS.TWELVE) return null;
  try {
    const url = `https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${API_KEYS.TWELVE}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    if (d && d.close) {
      stats.twelve.success++;
      return {
        price:         parseFloat(d.close),
        change:        parseFloat(d.change)         || 0,
        changePercent: parseFloat(d.percent_change) || 0,
        dayHigh:       parseFloat(d.high)           || 0,
        dayLow:        parseFloat(d.low)            || 0,
        open:          parseFloat(d.open)           || 0,
        previousClose: parseFloat(d.previous_close) || 0,
        volume:        parseInt(d.volume)           || 0,
        source:        'TwelveData',
      };
    }
    stats.twelve.failed++;
    return null;
  } catch {
    stats.twelve.failed++;
    return null;
  }
}

// ============================================
// MAIN
// ============================================
async function updateAllAssets() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  📊 US Stock Portfolio — Daily Asset Update  v2     ║');
  console.log('║  Phase 1: Finnhub /quote    → ราคา (ทุกวัน)        ║');
  console.log('║  Phase 2: Finnhub /metric   → Fundamental (ทุกวัน) ║');
  console.log('║  Phase 3: Alpha Vantage     → ETF Profile (7 วัน)  ║');
  console.log('║  Phase 4: FMP               → fallback ราคา        ║');
  console.log('║  Phase 5: EODHD + Twelve    → fallback สุดท้าย     ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // ตรวจ API Keys
  console.log('[Config] API Keys:');
  console.log(`  Finnhub:       ${API_KEYS.FINNHUB ? '✅' : '❌ Missing (Required!)'}`);
  console.log(`  Alpha Vantage: ${API_KEYS.ALPHAV  ? '✅' : '⚠️  Missing (Phase 3 skip)'}`);
  console.log(`  FMP:           ${API_KEYS.FMP     ? '✅' : '⚠️  Missing (Phase 4 skip)'}`);
  console.log(`  EODHD:         ${API_KEYS.EODHD   ? '✅' : '⚠️  Missing (Phase 5 skip)'}`);
  console.log(`  Twelve Data:   ${API_KEYS.TWELVE  ? '✅' : '⚠️  Missing (Phase 5 skip)'}`);

  if (!API_KEYS.FINNHUB) {
    console.error('\n❌ FINNHUB_API_KEY is required!');
    process.exit(1);
  }

  console.log(`  Alpha Vantage quota: ${CONFIG.ALPHAV_QUOTA} req/day | Refresh: every ${CONFIG.ALPHAV_REFRESH_DAYS} days\n`);

  // โหลดข้อมูล
  let stocksData = [];
  let etfsData   = [];
  try {
    stocksData = JSON.parse(fs.readFileSync(CONFIG.STOCKS_FILE, 'utf8'));
    console.log(`[Data] ✅ Loaded ${stocksData.length} stocks`);
  } catch (e) {
    console.error('[Data] ❌ Failed to load stocks.json:', e.message);
    process.exit(1);
  }
  try {
    etfsData = JSON.parse(fs.readFileSync(CONFIG.ETFS_FILE, 'utf8'));
    console.log(`[Data] ✅ Loaded ${etfsData.length} ETFs\n`);
  } catch (e) {
    console.error('[Data] ❌ Failed to load etfs.json:', e.message);
    process.exit(1);
  }

  // แสดง ETF Priority หลัง load etfsData แล้ว (ต้องอยู่นอก try block)
  const { portfolio: ETF_PORTFOLIO, watchlist: ETF_WATCHLIST, priority: ETF_PRIORITY } = getEtfPriorityLists(etfsData);
  console.log('[Config] ETF Priority:');
  console.log(`  Portfolio (${ETF_PORTFOLIO.length}): ${ETF_PORTFOLIO.join(', ') || 'none'}`);
  console.log(`  Watchlist (${ETF_WATCHLIST.length}): ${ETF_WATCHLIST.join(', ') || 'none'}`);

  const allData      = [...stocksData, ...etfsData];
  stats.total        = allData.length;
  const finnhubFailed = [];
  const now          = new Date().toISOString();

  // ============================================
  // PHASE 1: FINNHUB QUOTE — ราคาทุก asset
  // ============================================
  console.log('═'.repeat(55));
  console.log('📡 PHASE 1: Finnhub /quote (ราคา + รายวัน)');
  console.log(`   ${allData.length} symbols @ ${CONFIG.FINNHUB_DELAY_MS}ms/ตัว`);
  console.log(`   Estimated: ~${Math.ceil(allData.length * CONFIG.FINNHUB_DELAY_MS / 60000)} minutes`);
  console.log('═'.repeat(55));

  for (let i = 0; i < allData.length; i++) {
    const asset = allData[i];

    if (i % 50 === 0 && i > 0) {
      const pct = ((i / allData.length) * 100).toFixed(1);
      console.log(`\n  [Progress] ${i}/${allData.length} (${pct}%) | ✅ ${stats.finnhubPrice.success} | ❌ ${finnhubFailed.length} | ⏱️ ${formatTime(Date.now() - stats.startTime)}`);
    }

    const data = await fetchFinnhubPrice(asset.symbol);
    if (data) {
      allData[i] = {
        ...asset,
        price:         data.price,
        change:        data.change,
        changePercent: data.changePercent,
        dayHigh:       data.dayHigh,
        dayLow:        data.dayLow,
        open:          data.open,
        previousClose: data.previousClose,
        updatedAt:     now,
        priceSource:   'Finnhub',
      };
      if (i < 3 || i % 100 === 0) {
        console.log(`  ✅ ${asset.symbol}: $${data.price} (${data.changePercent >= 0 ? '+' : ''}${data.changePercent?.toFixed(2)}%)`);
      }
    } else {
      finnhubFailed.push(asset.symbol);
      if (finnhubFailed.length <= 10) {
        console.log(`  ⚠️  ${asset.symbol}: Finnhub failed → Phase 4`);
      }
    }
    await sleep(CONFIG.FINNHUB_DELAY_MS);
  }
  console.log(`\n[Phase 1 Done] ✅ ${stats.finnhubPrice.success} | ❌ ${finnhubFailed.length}`);

  // ============================================
  // PHASE 2: FINNHUB METRIC — Fundamental Data
  // ============================================
  console.log('\n' + '═'.repeat(55));
  console.log('📡 PHASE 2: Finnhub /metric (Fundamental)');
  console.log(`   ${allData.length} symbols @ ${CONFIG.FINNHUB_DELAY_MS}ms/ตัว`);
  console.log(`   Fields: divYield, P/E, EPS, MarketCap, 52w`);
  console.log('═'.repeat(55));

  for (let i = 0; i < allData.length; i++) {
    const asset = allData[i];

    if (i % 50 === 0 && i > 0) {
      const pct = ((i / allData.length) * 100).toFixed(1);
      console.log(`\n  [Progress] ${i}/${allData.length} (${pct}%) | ✅ ${stats.finnhubFundamental.success} | ⏱️ ${formatTime(Date.now() - stats.startTime)}`);
    }

    const data = await fetchFinnhubFundamental(asset.symbol);
    if (data) {
      allData[i] = {
        ...allData[i],
        divYield:  data.divYield  || allData[i].divYield  || 0,
        peRatio:   data.peRatio   || allData[i].peRatio   || 0,
        eps:       data.eps       || allData[i].eps       || 0,
        marketCap: data.marketCap || allData[i].marketCap || 0,
        high52w:   data.high52w   || allData[i].high52w   || 0,
        low52w:    data.low52w    || allData[i].low52w    || 0,
      };
      if (i < 3 || i % 100 === 0) {
        console.log(`  ✅ ${asset.symbol}: P/E=${data.peRatio?.toFixed(2)} | Yield=${data.divYield?.toFixed(2)}% | Cap=${(data.marketCap / 1e9).toFixed(1)}B`);
      }
    } else {
      if (stats.finnhubFundamental.failed <= 10) {
        console.log(`  ⚠️  ${asset.symbol}: Fundamental failed → คงค่าเดิม`);
      }
    }
    await sleep(CONFIG.FINNHUB_DELAY_MS);
  }
  console.log(`\n[Phase 2 Done] ✅ ${stats.finnhubFundamental.success} | ❌ ${stats.finnhubFundamental.failed}`);

  // ============================================
  // PHASE 3: ALPHA VANTAGE — ETF Profile
  // เฉพาะ ETF ที่ครบ 7 วัน | Priority: Portfolio > Watchlist > Others
  // ============================================
  console.log('\n' + '═'.repeat(55));
  console.log('📡 PHASE 3: Alpha Vantage ETF Profile (7-day refresh)');
  console.log(`   Quota: ${CONFIG.ALPHAV_QUOTA} req/day | Delay: ${CONFIG.ALPHAV_DELAY_MS / 1000}s/ตัว`);
  console.log(`   Priority 1 — Portfolio: ${ETF_PORTFOLIO.join(', ')}`);
  console.log(`   Priority 2 — Watchlist: ${ETF_WATCHLIST.join(', ')}`);
  console.log(`   Priority 3 — Others: ETF ทั่วไปที่ครบ 7 วัน`);
  console.log('═'.repeat(55));

  if (!API_KEYS.ALPHAV) {
    console.log('  ⚠️  ไม่มี ALPHAVANTAGE_API_KEY — ข้าม Phase 3');
  } else {
    // สร้าง ordered list: Priority > Watchlist > Others (เฉพาะ ETF เท่านั้น)
    const etfIndices = allData
      .map((a, i) => ({ ...a, _idx: i }))
      .filter(a => a.type === 'ETF');

    const portfolioEtfs = etfIndices.filter(a => ETF_PORTFOLIO.includes(a.symbol));
    const watchlistEtfs = etfIndices.filter(a => ETF_WATCHLIST.includes(a.symbol) && !ETF_PORTFOLIO.includes(a.symbol));
    const otherEtfs     = etfIndices.filter(a => !ETF_PRIORITY.includes(a.symbol));

    const orderedEtfs = [...portfolioEtfs, ...watchlistEtfs, ...otherEtfs];
    let avUsed = 0;

    for (const etf of orderedEtfs) {
      // หยุดเมื่อ quota หมด
      if (avUsed >= CONFIG.ALPHAV_QUOTA) {
        console.log(`  ⏹️  Alpha Vantage quota ครบ ${CONFIG.ALPHAV_QUOTA} req — หยุด Phase 3`);
        break;
      }

      // ข้ามถ้าอัปมาน้อยกว่า 7 วัน
      if (!needsAlphaVantageUpdate(etf)) {
        const daysSince = ((Date.now() - new Date(etf.profileUpdatedAt).getTime()) / 86400000).toFixed(1);
        const tag = ETF_PORTFOLIO.includes(etf.symbol) ? '💼' : ETF_WATCHLIST.includes(etf.symbol) ? '👁️' : '  ';
        console.log(`  ${tag} ⏭️  ${etf.symbol}: ข้าม (อัปมา ${daysSince} วัน < 7 วัน)`);
        stats.alphaVantage.skipped++;
        continue;
      }

      const tag = ETF_PORTFOLIO.includes(etf.symbol) ? '💼' : ETF_WATCHLIST.includes(etf.symbol) ? '👁️' : '  ';
      const data = await fetchAlphaVantageETFProfile(etf.symbol);
      avUsed++;

      if (data) {
        allData[etf._idx] = {
          ...allData[etf._idx],
          totalAssets:      data.totalAssets   || allData[etf._idx].totalAssets   || 0,
          expenseRatio:     data.expenseRatio  || allData[etf._idx].expenseRatio  || 0,
          divYield:         data.divYield      || allData[etf._idx].divYield      || 0,
          inceptionDate:    data.inceptionDate || allData[etf._idx].inceptionDate || '',
          numHoldings:      data.numHoldings   || allData[etf._idx].numHoldings   || 0,
          category:         data.category      || allData[etf._idx].category      || '',
          top10Holdings:    (data.holdings || []).slice(0, 10).map(h => ({
            symbol: h.symbol      || '',
            name:   h.description || h.name || '',
            weight: parseFloat(h.weight) || 0,
          })),
          sectorBreakdown:  (data.sectors || []).map(s => ({
            sector: s.sector || '',
            weight: parseFloat(s.weight) || 0,
          })),
          // คงค่าเดิมที่ AV ไม่ได้ให้
          trackingIndex:    allData[etf._idx].trackingIndex    || '',
          distributionRate: allData[etf._idx].distributionRate || 0,
          profileUpdatedAt: now,
          profileSource:    'AlphaVantage',
        };
        const aum = data.totalAssets >= 1e9
          ? `$${(data.totalAssets / 1e9).toFixed(1)}B`
          : `$${(data.totalAssets / 1e6).toFixed(0)}M`;
        const top3 = allData[etf._idx].top10Holdings.slice(0, 3).map(h => h.symbol).join(', ');
        console.log(`  ${tag} ✅ ${etf.symbol}: AUM=${aum} | ER=${data.expenseRatio.toFixed(4)}% | Holdings=${data.numHoldings} | Top3: ${top3}`);
      } else {
        console.log(`  ${tag} ❌ ${etf.symbol}: Alpha Vantage failed — คงค่าเดิม`);
      }

      // delay เพื่อไม่เกิน 5 req/min (free limit)
      await sleep(CONFIG.ALPHAV_DELAY_MS);
    }

    console.log(`\n[Phase 3 Done] AV: ✅ ${stats.alphaVantage.success} | ⏭️ ${stats.alphaVantage.skipped} skipped | ❌ ${stats.alphaVantage.failed} | Used ${avUsed}/${CONFIG.ALPHAV_QUOTA} quota`);
  }

  // ============================================
  // PHASE 4: FMP — fallback ราคา เฉพาะ Finnhub fail
  // ============================================
  const fmpFailed = [];

  if (finnhubFailed.length > 0) {
    console.log('\n' + '═'.repeat(55));
    console.log(`📡 PHASE 4: FMP fallback ราคา (${finnhubFailed.length} ตัว)`);
    console.log(`   Quota: ${CONFIG.FMP_QUOTA} req/day`);
    console.log('═'.repeat(55));

    if (!API_KEYS.FMP) {
      console.log('  ⚠️  ไม่มี FMP_API_KEY — ข้าม Phase 4 → Phase 5');
      fmpFailed.push(...finnhubFailed);
    } else {
      for (const symbol of finnhubFailed) {
        const idx = allData.findIndex(a => a.symbol === symbol);
        if (idx < 0) continue;

        if (stats.fmp.success + stats.fmp.failed >= CONFIG.FMP_QUOTA) {
          console.log(`  ⚠️  FMP quota หมด → ${symbol} ไป Phase 5`);
          fmpFailed.push(symbol);
          continue;
        }

        const data = await fetchFMP(symbol);
        if (data) {
          allData[idx] = {
            ...allData[idx],
            price:         data.price,
            change:        data.change,
            changePercent: data.changePercent,
            volume:        data.volume || allData[idx].volume,
            updatedAt:     now,
            priceSource:   'FMP',
          };
          console.log(`  ✅ [FMP] ${symbol}: $${data.price} (${data.changePercent >= 0 ? '+' : ''}${data.changePercent?.toFixed(2)}%)`);
        } else {
          console.log(`  ⚠️  [FMP] ${symbol}: failed → Phase 5`);
          fmpFailed.push(symbol);
        }
        await sleep(CONFIG.FMP_DELAY_MS);
      }
    }
    console.log(`\n[Phase 4 Done] FMP: ✅ ${stats.fmp.success} | ❌ ${stats.fmp.failed} | Phase 5: ${fmpFailed.length} ตัว`);
  }

  // ============================================
  // PHASE 5: EODHD + Twelve — fallback สุดท้าย
  // ============================================
  if (fmpFailed.length > 0) {
    console.log('\n' + '═'.repeat(55));
    console.log(`📡 PHASE 5: EODHD + Twelve fallback (${fmpFailed.length} ตัว)`);
    console.log(`   EODHD: ${CONFIG.EODHD_QUOTA} req/day | Twelve: ${CONFIG.TWELVE_QUOTA} credits/day`);
    console.log('═'.repeat(55));

    for (const symbol of fmpFailed) {
      const idx = allData.findIndex(a => a.symbol === symbol);
      if (idx < 0) continue;

      let data = null;

      if (API_KEYS.EODHD && stats.eodhd.success + stats.eodhd.failed < CONFIG.EODHD_QUOTA) {
        data = await fetchEODHD(symbol);
        if (data) await sleep(CONFIG.EODHD_DELAY_MS);
      }

      if (!data && API_KEYS.TWELVE && stats.twelve.success + stats.twelve.failed < CONFIG.TWELVE_QUOTA) {
        data = await fetchTwelve(symbol);
        if (data) await sleep(CONFIG.TWELVE_DELAY_MS);
      }

      if (data) {
        allData[idx] = {
          ...allData[idx],
          price:         data.price,
          change:        data.change,
          changePercent: data.changePercent,
          dayHigh:       data.dayHigh       || allData[idx].dayHigh,
          dayLow:        data.dayLow        || allData[idx].dayLow,
          open:          data.open          || allData[idx].open,
          previousClose: data.previousClose || allData[idx].previousClose,
          updatedAt:     now,
          priceSource:   data.source,
        };
        console.log(`  ✅ [${data.source}] ${symbol}: $${data.price}`);
      } else {
        console.log(`  ❌ ${symbol}: All APIs failed — คงราคาเดิม`);
      }
    }
    console.log(`\n[Phase 5 Done] EODHD: ✅ ${stats.eodhd.success} | Twelve: ✅ ${stats.twelve.success}`);
  }

  // ============================================
  // SAVE — แยก stocks.json และ etfs.json
  // ============================================
  console.log('\n' + '═'.repeat(55));
  console.log('💾 Saving...');

  try {
    const dir = path.dirname(CONFIG.STOCKS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const updatedStocks = allData.filter(a => a.type === 'STOCK');
    const updatedEtfs   = allData.filter(a => a.type === 'ETF');

    const stocksJson = JSON.stringify(updatedStocks, null, 2);
    const etfsJson   = JSON.stringify(updatedEtfs,   null, 2);

    fs.writeFileSync(CONFIG.STOCKS_FILE, stocksJson, 'utf8');
    fs.writeFileSync(CONFIG.ETFS_FILE,   etfsJson,   'utf8');

    console.log(`✅ stocks.json: ${updatedStocks.length} items (${(Buffer.byteLength(stocksJson, 'utf8') / 1024).toFixed(1)} KB)`);
    console.log(`✅ etfs.json:   ${updatedEtfs.length}   items (${(Buffer.byteLength(etfsJson,   'utf8') / 1024).toFixed(1)} KB)`);
  } catch (e) {
    console.error('❌ Failed to save:', e.message);
    process.exit(1);
  }

  // ============================================
  // FINAL REPORT
  // ============================================
  const totalTime    = formatTime(Date.now() - stats.startTime);
  const totalSuccess = stats.finnhubPrice.success + stats.fmp.success + stats.eodhd.success + stats.twelve.success;

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  📊 UPDATE COMPLETE                                 ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Total assets:     ${stats.total}`);
  console.log(`  ✅ Price updated: ${totalSuccess} (${(totalSuccess / stats.total * 100).toFixed(1)}%)`);
  console.log(`  ✅ Fundamental:   ${stats.finnhubFundamental.success}`);
  console.log(`  ✅ ETF Profile:   ${stats.alphaVantage.success} updated | ${stats.alphaVantage.skipped} skipped`);
  console.log(`  ⏱️  Total time:   ${totalTime}`);
  console.log('');
  console.log('  Price Sources:');
  console.log(`    Finnhub  (P1): ✅ ${stats.finnhubPrice.success}       | ❌ ${stats.finnhubPrice.failed}`);
  console.log(`    FMP      (P4): ✅ ${stats.fmp.success}        | ❌ ${stats.fmp.failed}`);
  console.log(`    EODHD    (P5): ✅ ${stats.eodhd.success}        | ❌ ${stats.eodhd.failed}`);
  console.log(`    Twelve   (P5): ✅ ${stats.twelve.success}        | ❌ ${stats.twelve.failed}`);
  console.log('');
  console.log('  ETF Profile (Alpha Vantage):');
  console.log(`    Updated:  ✅ ${stats.alphaVantage.success} | Skipped: ⏭️ ${stats.alphaVantage.skipped} | Failed: ❌ ${stats.alphaVantage.failed}`);

  if (stats.finnhubPrice.failed > stats.total * 0.3) {
    console.error(`\n⚠️ Warning: Finnhub failures > 30%`);
    process.exit(1);
  }

  console.log('\n🎉 Done!');
}

updateAllAssets().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
