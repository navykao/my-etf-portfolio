#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

// API Keys
const EODHD_API_KEY = process.env.EODHD_API_KEY;
const FMP_API_KEY = process.env.FMP0N8_API_KEY;

if (!EODHD_API_KEY || !FMP_API_KEY) {
  console.error('Error: API keys not found');
  console.error('Need: EODHD_API_KEY and FMP0N8_API_KEY');
  process.exit(1);
}

// Load symbols
const stocksPath = path.join(__dirname, 'sp500-symbols-top300.json');
const etfPath = path.join(__dirname, 'top250-etf-symbols.json');

if (!fs.existsSync(stocksPath)) {
  console.error('Error: sp500-symbols-top300.json not found');
  process.exit(1);
}
if (!fs.existsSync(etfPath)) {
  console.error('Error: top250-etf-symbols.json not found');
  process.exit(1);
}

const stocksRaw = JSON.parse(fs.readFileSync(stocksPath, 'utf8'));
const etfRaw = JSON.parse(fs.readFileSync(etfPath, 'utf8'));

const sp500Symbols = stocksRaw.symbols || stocksRaw;
const etfSymbols = etfRaw.symbols || etfRaw;

console.log('Loaded ' + sp500Symbols.length + ' stocks + ' + etfSymbols.length + ' ETFs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const DELAY_MS = 8000;
const allAssets = [];
const errors = [];

function fetchEODHD(symbol) {
  return new Promise((resolve) => {
    const url = 'https://eodhistoricaldata.com/api/real-time/' + symbol + '.US?api_token=' + EODHD_API_KEY + '&fmt=json';
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code || json.message) {
            console.log('X [' + symbol + '] ' + (json.message || 'Error'));
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
          console.log('X [' + symbol + '] Parse error');
          errors.push(symbol);
          resolve(null);
        }
      });
    }).on('error', () => {
      console.log('X [' + symbol + '] Network error');
      errors.push(symbol);
      resolve(null);
    });
  });
}

function fetchFMP(symbol) {
  return new Promise((resolve) => {
    const url = 'https://financialmodelingprep.com/api/v3/quote/' + symbol + '?apikey=' + FMP_API_KEY;
    
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
            console.log('X [' + symbol + '] No data');
            errors.push(symbol);
            resolve(null);
          }
        } catch (e) {
          console.log('X [' + symbol + '] Parse error');
          errors.push(symbol);
          resolve(null);
        }
      });
    }).on('error', () => {
      console.log('X [' + symbol + '] Network error');
      errors.push(symbol);
      resolve(null);
    });
  });
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('--- START ---');
  console.log('Date: ' + new Date().toISOString());
  console.log('');

  // Part 1: Stocks (EODHD)
  console.log('[1/2] Fetching ' + sp500Symbols.length + ' S&P 500 stocks (EODHD)...');
  for (let i = 0; i < sp500Symbols.length; i++) {
    const symbol = sp500Symbols[i];
    const data = await fetchEODHD(symbol);
    
    if (data) {
      allAssets.push(data);
      console.log('[' + (i + 1) + '/' + sp500Symbols.length + '] OK ' + symbol + ' $' + data.price);
    }
    
    if (i < sp500Symbols.length - 1) {
      await delay(DELAY_MS);
    }
  }

  console.log('');

  // Part 2: ETFs (FMP)
  console.log('[2/2] Fetching ' + etfSymbols.length + ' ETFs (FMP)...');
  for (let i = 0; i < etfSymbols.length; i++) {
    const symbol = etfSymbols[i];
    const data = await fetchFMP(symbol);
    
    if (data) {
      allAssets.push(data);
      console.log('[' + (i + 1) + '/' + etfSymbols.length + '] OK ' + symbol + ' $' + data.price);
    }
    
    if (i < etfSymbols.length - 1) {
      await delay(DELAY_MS);
    }
  }
  
  console.log('');
  console.log('Saving data...');
  
  const jsonPath = path.join(dataDir, 'combined-746-assets.json');
  const csvPath = path.join(dataDir, 'combined-746-assets.csv');
  
  fs.writeFileSync(jsonPath, JSON.stringify(allAssets, null, 2));
  
  const csv = 'Symbol,Name,Type,Price,DivYield,GrowthRate,PERatio,High52w,Low52w,UpdatedAt\n' +
    allAssets.map(function(a) {
      return a.symbol + ',' + a.name + ',' + a.type + ',' + a.price + ',' + a.divYield.toFixed(2) + ',' + a.growthRate + ',' + a.peRatio.toFixed(2) + ',' + a.high52w + ',' + a.low52w + ',' + a.updatedAt;
    }).join('\n');
  fs.writeFileSync(csvPath, csv);
  
  console.log('Saved JSON: ' + jsonPath);
  console.log('Saved CSV: ' + csvPath);
  console.log('');
  console.log('--- DONE ---');
  console.log('Total: ' + allAssets.length + ' | Failed: ' + errors.length);
}

main().catch(console.error);
