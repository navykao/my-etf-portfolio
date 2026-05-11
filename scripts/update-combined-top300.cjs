#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

// API Key
const FMP_API_KEY = process.env.FMP0N8_API_KEY;

if (!FMP_API_KEY) {
  console.error('Error: FMP0N8_API_KEY not found');
  process.exit(1);
}

// Load ETF symbols
const symbolsPath = path.join(__dirname, 'top250-etf-symbols.json');

if (!fs.existsSync(symbolsPath)) {
  console.error('Error: top250-etf-symbols.json not found at ' + symbolsPath);
  process.exit(1);
}

const rawData = JSON.parse(fs.readFileSync(symbolsPath, 'utf8'));
const etfSymbols = rawData.symbols || rawData;
console.log('Loaded ' + etfSymbols.length + ' ETF symbols');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('Created data directory: ' + dataDir);
}

const DELAY_MS = 8000;
const allAssets = [];
const errors = [];

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
  console.log('Fetching ' + etfSymbols.length + ' ETF data (FMP only)');
  console.log('Date: ' + new Date().toISOString());
  console.log('');
  
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
