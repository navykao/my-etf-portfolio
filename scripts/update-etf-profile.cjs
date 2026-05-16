// ============================================
// update-etf-profile.cjs
// อัพเดท ETF-specific fields ผ่าน FMP API
// รันอาทิตย์ละ 1 ครั้ง (ทุกวันจันทร์)
//
// Fields: totalAssets, expenseRatio, numHoldings,
//         trackingIndex, inceptionDate, category
//
// วิธีรัน: node scripts/update-etf-profile.cjs
// ============================================

const fs   = require('fs');
const path = require('path');

// ============================================
// API KEYS
// ============================================
const API_KEYS = {
  FMP: process.env.FMP0N8_API_KEY || process.env.VITE_FMP0N8_API_KEY || '',
};

// ============================================
// CONFIG
// ============================================
const CONFIG = {
  ETFS_FILE:        path.join(__dirname, '..', 'public', 'data', 'etfs.json'),
  FMP_DELAY_MS:     300,   // 300ms/ตัว — FMP ไม่มี rate limit เข้มงวด
  FMP_QUOTA:        230,   // เผื่อไว้ 20 req จาก 250/day
  FETCH_TIMEOUT_MS: 10000,
};

// ============================================
// STATS
// ============================================
const stats = {
  total:   0,
  success: 0,
  failed:  0,
  skipped: 0,
  startTime: Date.now(),
};

// ============================================
// HELPERS
// ============================================
async function fetchWithTimeout(url, timeoutMs = CONFIG.FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), timeoutMs);
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
  const secs    = seconds % 60;
  return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
}

// ============================================
// FMP: ETF Profile
// Endpoint: /etf/info?symbol=SPY
// Fields: expenseRatio, aum, holdingsCount,
//         domicile, etfCompany, inceptionDate
// ============================================
async function fetchFMPETFProfile(symbol) {
  if (!API_KEYS.FMP) return null;
  try {
    const url = `https://financialmodelingprep.com/api/v4/etf-info?symbol=${symbol}&apikey=${API_KEYS.FMP}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    // FMP returns array
    const d = Array.isArray(data) ? data[0] : data;
    if (!d) return null;

    return {
      totalAssets:   d.aum              || 0,
      expenseRatio:  d.expenseRatio      ? parseFloat(d.expenseRatio) * 100 : 0,
      numHoldings:   d.holdingsCount     || 0,
      trackingIndex: d.domicile          || '',   // FMP ไม่มี trackingIndex ตรงๆ
      inceptionDate: d.inceptionDate     || '',
      category:      d.etfCompany        || '',
    };
  } catch (error) {
    return null;
  }
}

// ============================================
// MAIN
// ============================================
async function updateETFProfile() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  📊 ETF Portfolio - Weekly ETF Profile Update       ║');
  console.log('║  Source: FMP /etf-info (Free 250 req/day)           ║');
  console.log('║  Fields: AUM, Expense Ratio, Holdings, Inception    ║');
  console.log('║  Schedule: ทุกวันจันทร์ สัปดาห์ละ 1 ครั้ง         ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // ตรวจ API Key
  if (!API_KEYS.FMP) {
    console.error('❌ FMP0N8_API_KEY is required!');
    process.exit(1);
  }
  console.log(`[Config] FMP API Key: ✅ Ready`);
  console.log(`[Config] Quota limit: ${CONFIG.FMP_QUOTA} req/run\n`);

  // โหลด ETFs
  let etfsData = [];
  try {
    etfsData = JSON.parse(fs.readFileSync(CONFIG.ETFS_FILE, 'utf8'));
    console.log(`[Data] ✅ Loaded ${etfsData.length} ETFs from etfs.json\n`);
  } catch (error) {
    console.error('[Data] ❌ Failed to load etfs.json:', error.message);
    process.exit(1);
  }

  stats.total = etfsData.length;
  const now = new Date().toISOString();

  console.log('═'.repeat(55));
  console.log(`📡 Updating ETF Profile: ${etfsData.length} ETFs`);
  console.log(`   Source: FMP /etf-info @ ${CONFIG.FMP_DELAY_MS}ms/ตัว`);
  console.log(`   Estimated time: ~${Math.ceil(etfsData.length * CONFIG.FMP_DELAY_MS / 1000 / 60)} minutes`);
  console.log('═'.repeat(55));

  for (let i = 0; i < etfsData.length; i++) {
    const etf = etfsData[i];

    // ตรวจ quota
    if (stats.success + stats.failed >= CONFIG.FMP_QUOTA) {
      console.log(`\n⚠️  FMP quota ครบ ${CONFIG.FMP_QUOTA} req — หยุดที่ ${i}/${etfsData.length}`);
      stats.skipped = etfsData.length - i;
      break;
    }

    // Progress log ทุก 50 ตัว
    if (i % 50 === 0 && i > 0) {
      const elapsed = formatTime(Date.now() - stats.startTime);
      console.log(`\n  [Progress] ${i}/${etfsData.length} | ✅ ${stats.success} | ❌ ${stats.failed} | ⏱️ ${elapsed}`);
    }

    const profile = await fetchFMPETFProfile(etf.symbol);

    if (profile) {
      etfsData[i] = {
        ...etfsData[i],
        totalAssets:   profile.totalAssets   || etfsData[i].totalAssets   || 0,
        expenseRatio:  profile.expenseRatio   || etfsData[i].expenseRatio  || 0,
        numHoldings:   profile.numHoldings    || etfsData[i].numHoldings   || 0,
        trackingIndex: etfsData[i].trackingIndex || '',  // คงของเดิม (FMP ไม่มี)
        inceptionDate: profile.inceptionDate   || etfsData[i].inceptionDate || '',
        category:      profile.category        || etfsData[i].category      || '',
        profileUpdatedAt: now,
      };
      stats.success++;

      // แสดงผลตัวแรกๆ และทุก 50 ตัว
      if (stats.success <= 3 || stats.success % 50 === 0) {
        const aum = profile.totalAssets >= 1e9
          ? `$${(profile.totalAssets / 1e9).toFixed(1)}B`
          : `$${(profile.totalAssets / 1e6).toFixed(0)}M`;
        console.log(`  ✅ ${etf.symbol}: AUM=${aum} | ER=${profile.expenseRatio.toFixed(2)}% | Holdings=${profile.numHoldings}`);
      }
    } else {
      stats.failed++;
      if (stats.failed <= 5) {
        console.log(`  ⚠️  ${etf.symbol}: FMP failed — คงข้อมูลเดิม`);
      }
    }

    await sleep(CONFIG.FMP_DELAY_MS);
  }

  // ============================================
  // SAVE
  // ============================================
  console.log('\n' + '═'.repeat(55));
  console.log('💾 Saving etfs.json...');
  try {
    const etfsJson = JSON.stringify(etfsData, null, 2);
    fs.writeFileSync(CONFIG.ETFS_FILE, etfsJson, 'utf8');
    console.log(`✅ Saved etfs.json: ${etfsData.length} items (${(Buffer.byteLength(etfsJson, 'utf8') / 1024).toFixed(1)} KB)`);
  } catch (error) {
    console.error('❌ Failed to save:', error.message);
    process.exit(1);
  }

  // ============================================
  // FINAL REPORT
  // ============================================
  const totalTime = formatTime(Date.now() - stats.startTime);
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  📊 ETF PROFILE UPDATE COMPLETE                     ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Total ETFs:    ${stats.total}`);
  console.log(`  ✅ Updated:    ${stats.success} (${(stats.success / stats.total * 100).toFixed(1)}%)`);
  console.log(`  ❌ Failed:     ${stats.failed}`);
  console.log(`  ⏭️  Skipped:   ${stats.skipped} (quota)`);
  console.log(`  ⏱️  Total time: ${totalTime}`);
  console.log(`  📅 Next run:   วันจันทร์หน้า`);
  console.log('\n🎉 Done!');
}

// ============================================
// RUN
// ============================================
updateETFProfile().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
