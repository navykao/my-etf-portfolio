#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

// API Keys
const EODHD_API_KEY = process.env.EODHD_API_KEY;
const FMP_API_KEY = process.env.FMP0N8_API_KEY;

if (!EODHD_API_KEY || !FMP_API_KEY) {
  console.error('❌ Error: API keys not found in environment variables');
  console.error('Required: EODHD_API_KEY and FMP0N8_API_KEY');
  process.exit(1);
}

// Load symbols
const sp500Symbols = require('./sp500-symbols-top300.json');
const etfSymbols = require('./top250-etf-symbols.json');

const DELAY_MS = 8000; // 8 seconds per request

// Data storage
const allAssets = [];
const errors = [];

// Fetch functions
function fetchEODHD(symbol) {
  return new Promise((resolve) => {
    const url = `https://eodhistoricaldata.com/api/real-time/${symbol}.US?api_token=${EODHD_API_KEY}&fmt=json`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code) {
            console.log(`❌ [${symbol}] Error: ${json.message || 'Unknown error'}`);
            errors.push(symbol);
            resolve(null);
          } else {
            resolve({
              symbol: symbol,
              name: json.name || symbol,
              type: 'STOCK',
              price: json.close || json.lastPrice || 0,
              divYield: (json.dividend_yield || 0) * 100,
              growthRate: 0,
              peRatio: json.pe || 0,
              high52w: json.year_high || json.close || 0,
              low52w: json.year_low || json.close || 0,
              updatedAt: new Date().toISOString()
            });
          }
        } catch (e) {
          console.log(`❌ [${symbol}] Parse error`);
          errors.push(symbol);
          resolve(null);
        }
      });
    }).on('error', () => {
      console.log(`❌ [${symbol}] Network error`);
      errors.push(symbol);
      resolve(null);
    });
  });
}

function fetchFMP(symbol) {
  return new Promise((resolve) => {
    const url = `https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${FMP_API_KEY}`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json[0]) {
            const q = json[0];
            resolve({
              symbol: symbol,
              name: q.name || symbol,
              type: 'ETF',
              price: q.price || 0,
              divYield: (q.dividendYield || 0) * 100,
              growthRate: 0,
              peRatio: q.pe || 0,
              high52w: q.yearHigh || q.price || 0,
              low52w: q.yearLow || q.price || 0,
              updatedAt: new Date().toISOString()
            });
          } else {
            console.log(`❌ [${symbol}] No data`);
            errors.push(symbol);
            resolve(null);
          }
        } catch (e) {
          console.log(`❌ [${symbol}] Parse error`);
          errors.push(symbol);
          resolve(null);
        }
      });
    }).on('error', () => {
      console.log(`❌ [${symbol}] Network error`);
      errors.push(symbol);
      resolve(null);
    });
  });
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('📊 Fetching combined top 300 S&P 500 + 250 ETF data...\n');
  
  // Fetch S&P 500 (Top 300)
  console.log(`📈 Fetching ${sp500Symbols.length} S&P 500 stocks...`);
  for (let i = 0; i < sp500Symbols.length; i++) {
    const symbol = sp500Symbols[i];
    const data = await fetchEODHD(symbol);
    
    if (data) {
      allAssets.push(data);
      console.log(`✅ [${i + 1}/${sp500Symbols.length}] ${symbol} - $${data.price}`);
    }
    
    await delay(DELAY_MS);
  }
  
  // Fetch ETFs
  console.log(`\n📊 Fetching ${etfSymbols.length} ETFs...`);
  for (let i = 0; i < etfSymbols.length; i++) {
    const symbol = etfSymbols[i];
    const data = await fetchFMP(symbol);
    
    if (data) {
      allAssets.push(data);
      console.log(`✅ [${i + 1}/${etfSymbols.length}] ${symbol} - $${data.price}`);
    }
    
    await delay(DELAY_MS);
  }
  
  // Save data
  console.log(`\n💾 Saving data...`);
  fs.writeFileSync('../data/combined-746-assets.json', JSON.stringify(allAssets, null, 2));
  
  // Create CSV
  const csv = 'Symbol,Name,Type,Price,DivYield,GrowthRate,PERatio,High52w,Low52w,UpdatedAt\n' +
    allAssets.map(a => `${a.symbol},${a.name},${a.type},${a.price},${a.divYield.toFixed(2)},${a.growthRate},${a.peRatio.toFixed(2)},${a.high52w},${a.low52w},${a.updatedAt}`).join('\n');
  fs.writeFileSync('../data/combined-746-assets.csv', csv);
  
  console.log(`\n✅ Done!`);
  console.log(`📊 Total assets: ${allAssets.length}`);
  console.log(`❌ Failed: ${errors.length}`);
}

main().catch(console.error);
