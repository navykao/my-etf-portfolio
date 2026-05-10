/**
 * =====================================================
 * StockScreener.jsx v1.0
 * =====================================================
 * Stock Screener สำหรับค้นหาหุ้นที่ร่วง
 * - กรองหุ้นตามเงื่อนไข: ร่วงติดต่อกัน N วัน, ร่วง X%
 * - แสดงกราฟราคาย้อนหลัง 30 วัน
 * - รองรับ Sorting และ Filtering แบบ Real-time
 * =====================================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrendingDown, Filter, X, ChevronDown, ChevronUp, 
  Calendar, Percent, DollarSign, Activity, Info,
  ArrowUpRight, ArrowDownRight, Search, RefreshCw
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// =====================================================
// Helper Functions
// =====================================================

/**
 * ตรวจสอบว่าหุ้นร่วงติดต่อกันกี่วัน
 */
function getConsecutiveDownDays(prices) {
  if (!prices || prices.length === 0) return 0;
  
  let count = 0;
  for (let i = 0; i < prices.length; i++) {
    if (prices[i].change < 0) {
      count++;
    } else {
      break; // หยุดเมื่อเจอวันที่ไม่ลง
    }
  }
  return count;
}

/**
 * คำนวณ % การร่วงจาก peak ย้อนหลัง N วัน
 */
function getDropPercentFromPeak(prices, days = 30) {
  if (!prices || prices.length === 0) return 0;
  
  const recentPrices = prices.slice(0, days);
  const maxPrice = Math.max(...recentPrices.map(p => p.high));
  const currentPrice = prices[0].close;
  
  return ((currentPrice - maxPrice) / maxPrice) * 100;
}

/**
 * คำนวณ Volume เฉลี่ย
 */
function getAverageVolume(prices, days = 10) {
  if (!prices || prices.length === 0) return 0;
  
  const recentPrices = prices.slice(0, days);
  const totalVolume = recentPrices.reduce((sum, p) => sum + p.volume, 0);
  
  return Math.round(totalVolume / recentPrices.length);
}

/**
 * Format ตัวเลข
 */
const formatNumber = (num) => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
  return num.toString();
};

const formatCurrency = (num) => {
  return new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD',
    minimumFractionDigits: 2 
  }).format(num);
};

const formatPercent = (num) => {
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
};

// =====================================================
// StockScreener Component
// =====================================================
export default function StockScreener({ stocksDatabase, historicalPrices, onClose }) {
  // ==========================================
  // State Management
  // ==========================================
  const [filters, setFilters] = useState({
    consecutiveDays: 3,      // ร่วงติดต่อกันขั้นต่ำ (วัน)
    dropPercent: 5,          // % การร่วงขั้นต่ำ
    minYield: 0,            // Yield ขั้นต่ำ (%)
    maxYield: 100,          // Yield สูงสุด (%)
    minPrice: 0,            // ราคาขั้นต่ำ ($)
    maxPrice: 10000,        // ราคาสูงสุด ($)
  });
  
  const [sortConfig, setSortConfig] = useState({
    key: 'dropPercent',     // default sort by % drop
    direction: 'desc'
  });
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStock, setSelectedStock] = useState(null);
  const [showFilters, setShowFilters] = useState(true);
  
  // ==========================================
  // Filter & Sort Logic
  // ==========================================
  const filteredStocks = useMemo(() => {
    if (!stocksDatabase || !historicalPrices) return [];
    
    const results = [];
    
    for (const symbol in stocksDatabase) {
      const stock = stocksDatabase[symbol];
      const prices = historicalPrices[symbol];
      
      if (!prices || prices.length === 0) continue;
      
      // Calculate metrics
      const consecutiveDays = getConsecutiveDownDays(prices);
      const dropPercent = getDropPercentFromPeak(prices, 30);
      const avgVolume = getAverageVolume(prices, 10);
      
      // Apply filters
      if (consecutiveDays < filters.consecutiveDays) continue;
      if (Math.abs(dropPercent) < filters.dropPercent) continue;
      if (stock.divYield < filters.minYield) continue;
      if (stock.divYield > filters.maxYield) continue;
      if (stock.price < filters.minPrice) continue;
      if (stock.price > filters.maxPrice) continue;
      
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (
          !symbol.toLowerCase().includes(query) &&
          !stock.name.toLowerCase().includes(query)
        ) continue;
      }
      
      results.push({
        symbol,
        name: stock.name,
        price: stock.price,
        divYield: stock.divYield,
        growthRate: stock.growthRate,
        consecutiveDays,
        dropPercent,
        avgVolume,
        prices,
      });
    }
    
    // Sort results
    results.sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];
      
      if (sortConfig.direction === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });
    
    return results;
  }, [stocksDatabase, historicalPrices, filters, searchQuery, sortConfig]);
  
  // ==========================================
  // Handlers
  // ==========================================
  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };
  
  const handleResetFilters = () => {
    setFilters({
      consecutiveDays: 3,
      dropPercent: 5,
      minYield: 0,
      maxYield: 100,
      minPrice: 0,
      maxPrice: 10000,
    });
    setSearchQuery('');
  };
  
  // ==========================================
  // Render
  // ==========================================
  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 to-stone-100 p-6">
      <div className="max-w-7xl mx-auto">
        
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200/60 p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-rose-600 rounded-xl flex items-center justify-center shadow-md">
                <TrendingDown size={24} className="text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-stone-800">Stock Screener</h1>
                <p className="text-sm text-stone-500">ค้นหาหุ้นที่ร่วงตามเงื่อนไข</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setShowFilters(!showFilters)}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-sm font-medium text-stone-700 transition-colors flex items-center gap-2"
              >
                <Filter size={16} />
                {showFilters ? 'ซ่อนตัวกรอง' : 'แสดงตัวกรอง'}
              </button>
              
              {onClose && (
                <button 
                  onClick={onClose}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl text-sm font-medium text-stone-700 transition-colors flex items-center gap-2"
                >
                  <X size={16} />
                  ปิด
                </button>
              )}
            </div>
          </div>
        </div>
        
        {/* Filters Panel */}
        {showFilters && (
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200/60 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-stone-800 flex items-center gap-2">
                <Filter size={18} className="text-teal-600" />
                ตัวกรอง
              </h2>
              <button 
                onClick={handleResetFilters}
                className="text-sm text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1"
              >
                <RefreshCw size={14} />
                รีเซ็ต
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Consecutive Days */}
              <div>
                <label className="text-xs font-medium text-stone-600 mb-1.5 block">
                  ร่วงติดต่อกันขั้นต่ำ (วัน)
                </label>
                <input 
                  type="number"
                  min="1"
                  max="30"
                  value={filters.consecutiveDays}
                  onChange={(e) => setFilters(prev => ({ ...prev, consecutiveDays: Number(e.target.value) || 1 }))}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-teal-400 focus:bg-white transition-all"
                />
              </div>
              
              {/* Drop Percent */}
              <div>
                <label className="text-xs font-medium text-stone-600 mb-1.5 block">
                  % การร่วงขั้นต่ำ
                </label>
                <input 
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={filters.dropPercent}
                  onChange={(e) => setFilters(prev => ({ ...prev, dropPercent: Number(e.target.value) || 0 }))}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-teal-400 focus:bg-white transition-all"
                />
              </div>
              
              {/* Min Yield */}
              <div>
                <label className="text-xs font-medium text-stone-600 mb-1.5 block">
                  Yield ขั้นต่ำ (%)
                </label>
                <input 
                  type="number"
                  min="0"
                  max="20"
                  step="0.5"
                  value={filters.minYield}
                  onChange={(e) => setFilters(prev => ({ ...prev, minYield: Number(e.target.value) || 0 }))}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-teal-400 focus:bg-white transition-all"
                />
              </div>
              
              {/* Price Range */}
              <div>
                <label className="text-xs font-medium text-stone-600 mb-1.5 block">
                  ราคาขั้นต่ำ ($)
                </label>
                <input 
                  type="number"
                  min="0"
                  step="10"
                  value={filters.minPrice}
                  onChange={(e) => setFilters(prev => ({ ...prev, minPrice: Number(e.target.value) || 0 }))}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-teal-400 focus:bg-white transition-all"
                />
              </div>
              
              <div>
                <label className="text-xs font-medium text-stone-600 mb-1.5 block">
                  ราคาสูงสุด ($)
                </label>
                <input 
                  type="number"
                  min="0"
                  step="10"
                  value={filters.maxPrice}
                  onChange={(e) => setFilters(prev => ({ ...prev, maxPrice: Number(e.target.value) || 10000 }))}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-teal-400 focus:bg-white transition-all"
                />
              </div>
              
              {/* Search */}
              <div>
                <label className="text-xs font-medium text-stone-600 mb-1.5 block">
                  ค้นหา Symbol/Name
                </label>
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input 
                    type="text"
                    placeholder="เช่น VOO, Vanguard..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium outline-none focus:border-teal-400 focus:bg-white transition-all"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Results Summary */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200/60 p-4 mb-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-stone-600">
              พบ <span className="font-bold text-stone-800">{filteredStocks.length}</span> หุ้นที่ตรงกับเงื่อนไข
            </p>
            <p className="text-xs text-stone-500">
              อัพเดทล่าสุด: {new Date().toLocaleDateString('th-TH')}
            </p>
          </div>
        </div>
        
        {/* Results Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50/50 text-xs font-medium text-stone-600">
                <tr>
                  <th className="px-4 py-3 text-left cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('symbol')}>
                    <div className="flex items-center gap-1">
                      Symbol
                      {sortConfig.key === 'symbol' && (
                        sortConfig.direction === 'desc' ? <ChevronDown size={14} /> : <ChevronUp size={14} />
                      )}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('price')}>
                    <div className="flex items-center justify-end gap-1">
                      Price
                      {sortConfig.key === 'price' && (
                        sortConfig.direction === 'desc' ? <ChevronDown size={14} /> : <ChevronUp size={14} />
                      )}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('dropPercent')}>
                    <div className="flex items-center justify-end gap-1">
                      ร่วง %
                      {sortConfig.key === 'dropPercent' && (
                        sortConfig.direction === 'desc' ? <ChevronDown size={14} /> : <ChevronUp size={14} />
                      )}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('consecutiveDays')}>
                    <div className="flex items-center justify-end gap-1">
                      ติดต่อกัน
                      {sortConfig.key === 'consecutiveDays' && (
                        sortConfig.direction === 'desc' ? <ChevronDown size={14} /> : <ChevronUp size={14} />
                      )}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('divYield')}>
                    <div className="flex items-center justify-end gap-1">
                      Yield
                      {sortConfig.key === 'divYield' && (
                        sortConfig.direction === 'desc' ? <ChevronDown size={14} /> : <ChevronUp size={14} />
                      )}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right">Volume</th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredStocks.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="px-4 py-8 text-center text-stone-500">
                      <div className="flex flex-col items-center gap-2">
                        <TrendingDown size={32} className="text-stone-300" />
                        <p>ไม่พบหุ้นที่ตรงกับเงื่อนไข</p>
                        <button 
                          onClick={handleResetFilters}
                          className="text-sm text-teal-600 hover:text-teal-700 font-medium"
                        >
                          ลองปรับเงื่อนไขการค้นหา
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredStocks.map((stock) => (
                    <tr 
                      key={stock.symbol} 
                      className="hover:bg-stone-50/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span className="font-semibold text-stone-800">{stock.symbol}</span>
                      </td>
                      <td className="px-4 py-3 text-stone-600 max-w-xs truncate">
                        {stock.name}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-stone-700">
                        {formatCurrency(stock.price)}
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold ${stock.dropPercent < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        <div className="flex items-center justify-end gap-1">
                          {stock.dropPercent < 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                          {formatPercent(stock.dropPercent)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="bg-red-50 text-red-700 px-2 py-1 rounded-lg text-xs font-semibold">
                          {stock.consecutiveDays} วัน
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-emerald-600 font-medium">
                        {stock.divYield.toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 text-right text-stone-500 text-xs">
                        {formatNumber(stock.avgVolume)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button 
                          onClick={() => setSelectedStock(stock)}
                          className="text-teal-600 hover:text-teal-700 font-medium text-xs flex items-center gap-1 mx-auto"
                        >
                          <Info size={14} />
                          ดูกราฟ
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        
      </div>
      
      {/* Stock Detail Modal */}
      {selectedStock && (
        <StockDetailModal 
          stock={selectedStock}
          onClose={() => setSelectedStock(null)}
        />
      )}
    </div>
  );
}

// =====================================================
// Stock Detail Modal Component
// =====================================================
function StockDetailModal({ stock, onClose }) {
  const chartData = useMemo(() => {
    return stock.prices.slice().reverse().map(p => ({
      date: new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      price: p.close,
    }));
  }, [stock.prices]);
  
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-stone-800">{stock.symbol}</h2>
            <p className="text-sm text-stone-500">{stock.name}</p>
          </div>
          <button 
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-stone-100 hover:bg-stone-200 flex items-center justify-center transition-colors"
          >
            <X size={20} className="text-stone-600" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-stone-50 rounded-xl p-4">
              <p className="text-xs text-stone-500 mb-1">ราคาปัจจุบัน</p>
              <p className="text-xl font-bold text-stone-800">{formatCurrency(stock.price)}</p>
            </div>
            <div className="bg-red-50 rounded-xl p-4">
              <p className="text-xs text-stone-500 mb-1">ร่วงลง</p>
              <p className="text-xl font-bold text-red-600">{formatPercent(stock.dropPercent)}</p>
            </div>
            <div className="bg-orange-50 rounded-xl p-4">
              <p className="text-xs text-stone-500 mb-1">ร่วงติดต่อกัน</p>
              <p className="text-xl font-bold text-orange-600">{stock.consecutiveDays} วัน</p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-4">
              <p className="text-xs text-stone-500 mb-1">Div Yield</p>
              <p className="text-xl font-bold text-emerald-600">{stock.divYield.toFixed(2)}%</p>
            </div>
          </div>
          
          {/* Price Chart */}
          <div className="bg-stone-50 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-stone-800 mb-4">กราฟราคา 30 วัน</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 11, fill: '#78716c' }} 
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  tick={{ fontSize: 11, fill: '#78716c' }} 
                  tickLine={false}
                  axisLine={false}
                  domain={['dataMin - 5', 'dataMax + 5']}
                />
                <Tooltip 
                  formatter={(value) => formatCurrency(value)}
                  contentStyle={{ 
                    borderRadius: '12px', 
                    border: '1px solid #e7e5e4',
                    fontSize: '12px',
                    padding: '8px 12px'
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="price" 
                  stroke="#dc2626" 
                  strokeWidth={2.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          
          {/* Price History Table */}
          <div className="bg-stone-50 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-stone-800 mb-4">ประวัติราคา 10 วันล่าสุด</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs font-medium text-stone-600 border-b border-stone-200">
                  <tr>
                    <th className="px-3 py-2 text-left">วันที่</th>
                    <th className="px-3 py-2 text-right">เปิด</th>
                    <th className="px-3 py-2 text-right">สูงสุด</th>
                    <th className="px-3 py-2 text-right">ต่ำสุด</th>
                    <th className="px-3 py-2 text-right">ปิด</th>
                    <th className="px-3 py-2 text-right">เปลี่ยนแปลง</th>
                    <th className="px-3 py-2 text-right">Volume</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {stock.prices.slice(0, 10).map((price, idx) => (
                    <tr key={idx} className="hover:bg-white/50 transition-colors">
                      <td className="px-3 py-2 text-stone-700 font-medium">
                        {new Date(price.date).toLocaleDateString('th-TH', { 
                          month: 'short', 
                          day: 'numeric' 
                        })}
                      </td>
                      <td className="px-3 py-2 text-right text-stone-600">
                        {formatCurrency(price.open)}
                      </td>
                      <td className="px-3 py-2 text-right text-emerald-600 font-medium">
                        {formatCurrency(price.high)}
                      </td>
                      <td className="px-3 py-2 text-right text-red-600 font-medium">
                        {formatCurrency(price.low)}
                      </td>
                      <td className="px-3 py-2 text-right text-stone-800 font-semibold">
                        {formatCurrency(price.close)}
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold ${
                        price.change >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {formatPercent(price.change)}
                      </td>
                      <td className="px-3 py-2 text-right text-stone-500 text-xs">
                        {formatNumber(price.volume)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
