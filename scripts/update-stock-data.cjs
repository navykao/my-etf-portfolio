/**
 * =====================================================
 * update-stock-data.cjs v6.1 - Complete Version
 * =====================================================
 * Auto-update 746 stocks/ETFs ทุกวัน 07:00 น.
 * 
 * Features:
 *   - ดึงข้อมูล 746 symbols จาก Yahoo Finance API (ฟรี!)
 *   - ข้อมูลที่ดึง: Price, Name, Dividend Yield, Type
 *   - บันทึกพร้อม timestamp
 *   - ไม่กิน FMP/FinnHub quota เลย!
 * 
 * Data Sources:
 *   - Yahoo Finance API (realtime, ฟรี ไม่จำกัด)
 * =====================================================
 */

const fs = require('fs');
const path = require('path');

// ==========================================
// 📋 ALL SYMBOLS (746 assets)
// ==========================================
const SYMBOLS = [
  // S&P 500 ETFs
  'VOO', 'SPY', 'IVV', 'SPLG', 'SPYM', 'SPYG', 'SPYV',
  
  // Total Market
  'VTI', 'SCHB', 'ITOT', 'SPTM',
  
  // Dividend ETFs
  'SCHD', 'VYM', 'VIG', 'DGRO', 'HDV', 'DVY', 'NOBL', 'SDY', 'FVD', 'RDVY',
  'DIVO', 'DIV', 'FDL', 'SDOG', 'DHS', 'DLN', 'DTD', 'DVP', 'VYMI',
  
  // Growth ETFs
  'QQQ', 'QQQM', 'VGT', 'MGK', 'SCHG', 'VUG', 'VOOG', 'VONG', 'IWF',
  'IVW', 'MTUM', 'FTEC', 'IYW', 'IWY',
  
  // Income / Covered Call
  'JEPI', 'JEPQ', 'XYLD', 'QYLD', 'RYLD', 'XYLG', 'QYLG', 'SPYI', 'QQQI',
  'SVOL', 'DJIA', 'IWMY', 'NUSI', 'ULTY',
  
  // International
  'VT', 'VXUS', 'VEA', 'VWO', 'IEFA', 'IEMG', 'EFA', 'EEM', 'IXUS',
  'SPDW', 'SPEM', 'VEU', 'ACWI', 'VSS', 'DLS',
  
  // Bond ETFs
  'BND', 'AGG', 'BNDX', 'TLT', 'SHY', 'IEF', 'TIP', 'LQD', 'HYG', 'MUB',
  'VCIT', 'VCSH', 'BSV', 'BIV', 'BLV', 'GOVT', 'SGOV', 'STIP', 'VTIP',
  
  // Sector ETFs
  'XLK', 'XLV', 'XLF', 'XLE', 'XLI', 'XLP', 'XLY', 'XLU', 'XLB', 'XLRE',
  'VDE', 'VIS', 'VDC', 'VCR', 'VPU', 'VAW',
  
  // REIT
  'VNQ', 'SCHH', 'IYR', 'RWR', 'USRT', 'REM', 'MORT', 'SRVR',
  
  // Small Cap
  'VB', 'SCHA', 'IJR', 'IWM', 'VTWO', 'SLYG', 'SLYV', 'IWN', 'IWO', 'VIOO',
  
  // Mid Cap
  'VO', 'SCHM', 'IJH', 'MDY', 'IVOO', 'IVOG', 'IVOV', 'IJJ', 'IJK',
  
  // Commodity / Gold
  'GLD', 'GLDM', 'IAU', 'SLV', 'DBC', 'PDBC', 'GSG', 'DBO',
  
  // Other Popular ETFs
  'ARKK', 'ARKW', 'ARKG', 'COWZ', 'DGRW', 'AVUV', 'SCHX', 'DIA', 'SMH',
  'SOXX', 'FDN', 'HACK', 'BOTZ', 'ROBT', 'FINX', 'TAN', 'PBW',
  'ICLN', 'QCLN', 'LIT', 'REMX', 'JETS', 'XAR', 'PPA', 'PHO',
  
  // Tech Stocks
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA', 'NFLX',
  'ADBE', 'CRM', 'ORCL', 'CSCO', 'INTC', 'AMD', 'QCOM', 'TXN', 'AVGO',
  'AMAT', 'LRCX', 'KLAC', 'SNPS', 'CDNS', 'MRVL', 'MU', 'NXPI', 'ADI',
  'MCHP', 'ON', 'MPWR', 'SWKS', 'QRVO', 'ENPH', 'SEDG', 'FSLR', 'RUN',
  
  // Finance Stocks
  'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'BLK', 'SCHW', 'AXP', 'USB',
  'PNC', 'TFC', 'COF', 'BK', 'STT', 'TROW', 'BEN', 'NTRS', 'IVZ',
  
  // Healthcare Stocks
  'JNJ', 'UNH', 'PFE', 'ABBV', 'TMO', 'ABT', 'LLY', 'MRK', 'BMY', 'AMGN',
  'GILD', 'CVS', 'CI', 'ANTM', 'HUM', 'MDT', 'DHR', 'SYK', 'BSX', 'EW',
  'ISRG', 'VRTX', 'REGN', 'BIIB', 'ILMN', 'ALXN', 'IQV', 'A', 'ZBH',
  
  // Consumer Stocks
  'WMT', 'HD', 'MCD', 'NKE', 'SBUX', 'TGT', 'LOW', 'TJX', 'DG', 'DLTR',
  'COST', 'KR', 'SYY', 'HSY', 'GIS', 'K', 'CAG', 'CPB', 'MKC', 'SJM',
  'PG', 'KO', 'PEP', 'CL', 'EL', 'KMB', 'CLX', 'CHD', 'TSN', 'HRL',
  
  // Industrial Stocks
  'BA', 'CAT', 'HON', 'UPS', 'UNP', 'RTX', 'LMT', 'MMM', 'GE', 'DE',
  'EMR', 'ITW', 'PH', 'ETN', 'ROK', 'DOV', 'FTV', 'IR', 'SWK', 'ALLE',
  
  // Energy Stocks
  'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'PSX', 'VLO', 'MPC', 'OXY', 'HAL',
  'PXD', 'KMI', 'WMB', 'OKE', 'EPD', 'MPLX', 'ET', 'ENB', 'TRP',
  
  // Utility Stocks
  'NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'SRE', 'PEG', 'XEL', 'ED',
  'WEC', 'ES', 'DTE', 'PPL', 'AEE', 'CMS', 'EVRG', 'LNT', 'NI', 'PNW',
  
  // Real Estate Stocks
  'AMT', 'PLD', 'CCI', 'EQIX', 'PSA', 'WELL', 'DLR', 'AVB', 'EQR', 'SBAC',
  'O', 'SPG', 'VTR', 'ARE', 'PEAK', 'EXR', 'IRM', 'UDR', 'HST', 'MAA',
  
  // Communication Stocks
  'T', 'VZ', 'TMUS', 'CMCSA', 'DIS', 'CHTR', 'ATVI', 'EA', 'TTWO',
  
  // Material Stocks
  'LIN', 'APD', 'SHW', 'ECL', 'DD', 'NEM', 'FCX', 'NUE', 'VMC', 'MLM',
  
  // Dividend Aristocrats
  'ABT', 'ADM', 'AFL', 'ALB', 'AOS', 'ATO', 'BDX',
  'BF.B', 'BRO', 'CAH', 'CB', 'CTAS', 'CINF',
  'ESS', 'EXPD', 'FRT', 'GD', 'GPC', 'GWW', 'KVUE', 'LEG',
  'NDSN', 'PPG', 'ROP', 'ROST', 'SPGI', 'UBSI', 'WST',
  
  // Additional Popular Stocks
  'V', 'MA', 'PYPL', 'SQ', 'FIS', 'FISV', 'ADP', 'PAYX', 'INTU', 'NOW',
  'WDAY', 'TEAM', 'ZM', 'DOCU', 'OKTA', 'DDOG', 'SNOW', 'CRWD', 'ZS', 'NET',
  'PANW', 'FTNT', 'CYBR', 'RPD', 'TENB', 'S', 'SPLK', 'MDB', 'ESTC', 'CFLT',
  
  // International Stocks
  'TSM', 'ASML', 'NVO', 'TM', 'SAP', 'SNY', 'UL', 'NVS', 'BABA', 'TCEHY',
  'TD', 'RY', 'BNS', 'BMO', 'CM', 'CNQ', 'SU', 'IMO'
];

// Remove duplicates
const UNIQUE_SYMBOLS = [...new Set(SYMBOLS)];

console.log('='.repeat(70));
console.log('🚀 Stock Data Update v6.1');
console.log('='.repeat(70));
console.log(`📅 ${new Date().toISOString()}`);
console.log(`📊 Total Symbols: ${UNIQUE_SYMBOLS.length}`);
console.log(`📍 Data Source: Yahoo Finance API (FREE)`);
console.log('='.repeat(70));
console.log('');

// ==========================================
// 📈 Fetch Data from Yahoo Finance
// ==========================================
async function fetchStockData() {
  console.log('📥 Fetching data from Yahoo Finance...\n');
  
  const results = [];
  const batchSize = 100; // Yahoo can handle 100 symbols per request
  const batches = [];
  
  // Split into batches
  for (let i = 0; i < UNIQUE_SYMBOLS.length; i += batchSize) {
    batches.push(UNIQUE_SYMBOLS.slice(i, i + batchSize));
  }
  
  console.log(`📦 Processing ${batches.length} batches...\n`);
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;
    
    try {
      const symbols = batch.join(',');
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=symbol,shortName,longName,regularMarketPrice,trailingAnnualDividendYield,trailingAnnualDividendRate,dividendYield,quoteType`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        const quotes = data?.quoteResponse?.result || [];
        
        for (const quote of quotes) {
          if (quote.regularMarketPrice && quote.regularMarketPrice > 0) {
            // Try multiple sources for dividend yield
            let divYield = 0;
            
            if (quote.trailingAnnualDividendYield) {
              divYield = quote.trailingAnnualDividendYield * 100;
            } else if (quote.dividendYield) {
              divYield = quote.dividendYield * 100;
            } else if (quote.trailingAnnualDividendRate && quote.regularMarketPrice > 0) {
              // Calculate from dividend rate / price
              divYield = (quote.trailingAnnualDividendRate / quote.regularMarketPrice) * 100;
            }
            
            results.push({
              symbol: quote.symbol,
              name: quote.shortName || quote.longName || quote.symbol,
              price: quote.regularMarketPrice.toString(),
              dividendYield: divYield.toFixed(2),
              type: quote.quoteType === 'ETF' ? 'ETF' : 'Stock'
            });
          }
        }
        
        console.log(`  ✅ Batch ${batchNum}/${batches.length}: ${quotes.length} symbols fetched`);
      } else {
        console.log(`  ❌ Batch ${batchNum}/${batches.length}: HTTP ${response.status}`);
      }
      
    } catch (error) {
      console.log(`  ❌ Batch ${batchNum}/${batches.length}: ${error.message}`);
    }
    
    // Rate limiting: wait 500ms between batches
    if (i < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log(`\n  → Total fetched: ${results.length}/${UNIQUE_SYMBOLS.length} symbols\n`);
  return results;
}

// ==========================================
// 💾 Save to File
// ==========================================
async function saveData(data) {
  const outputPath = path.join(__dirname, '..', 'data', 'combined-all-assets.json');
  
  // Add metadata
  const output = {
    _metadata: {
      lastUpdated: new Date().toISOString(),
      totalAssets: data.length,
      dataSource: 'Yahoo Finance API',
      updateFrequency: 'Daily at 07:00 Thailand time',
      version: '6.1'
    },
    data: data
  };
  
  // Create directory if not exists
  const dataDir = path.dirname(outputPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // Write file
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  
  const fileSize = (fs.statSync(outputPath).size / 1024).toFixed(1);
  
  console.log('='.repeat(70));
  console.log('✅ SUCCESS!');
  console.log('='.repeat(70));
  console.log(`📁 File saved: ${outputPath}`);
  console.log(`📦 File size: ${fileSize} KB`);
  console.log(`📊 Assets: ${data.length}`);
  console.log(`📅 Updated: ${new Date().toLocaleString('th-TH')}`);
  console.log('='.repeat(70));
}

// ==========================================
// 🎯 Main
// ==========================================
async function main() {
  try {
    const data = await fetchStockData();
    
    if (data.length === 0) {
      console.error('❌ No data fetched! Aborting...');
      process.exit(1);
    }
    
    await saveData(data);
    
    console.log('\n✅ Update completed successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run
main();
