// ============================================================
// V6.5 Custom Build (Core: App (10).jsx + Firebase + Dashboard)
// ============================================================
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot } from "firebase/firestore";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { Search, Star, Bell, DollarSign, TrendingUp, Trash2, Plus, RefreshCw, AlertCircle } from "lucide-react";

// 1. Firebase Config (ใช้ค่าเดิมของคุณ)
const firebaseConfig = {
  apiKey: "AIzaSyCItvIP2yRlxjblvaWn9sqw-ykv-dmk84A",
  authDomain: "my-etf-portfolio-v2.firebaseapp.com",
  projectId: "my-etf-portfolio-v2",
  storageBucket: "my-etf-portfolio-v2.firebasestorage.app",
  messagingSenderId: "420167991494",
  appId: "1:420167991494:web:0129fd79f25c81f412d7c7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const App = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [portfolio, setPortfolio] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [prices, setPrices] = useState({});
  const [allAssets, setAllAssets] = useState([]);
  const [loading, setLoading] = useState(true);

  // 2. Real-time Firebase Sync (เพิ่มไม่ใช่เปลี่ยน)
  useEffect(() => {
    const userDoc = doc(db, "users", "weeradet_p");
    const unsubscribe = onSnapshot(userDoc, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setPortfolio(data.portfolio || []);
        setWatchlist(data.watchlist || []);
        setAlerts(data.alerts || []);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 3. ระบบดึงราคาจาก App (10).jsx (Core Logic)
  const fetchPrices = useCallback(async () => {
    try {
      // ขั้นแรก: ดึงจากไฟล์ JSON (ประหยัด Quota)
      const res = await fetch("/data/combined-all-assets.json");
      const data = await res.json();
      setAllAssets(data);
      
      const priceMap = {};
      data.forEach(a => { priceMap[a.symbol] = a; });
      setPrices(priceMap);
      
      // หมายเหตุ: ระบบ Fallback API 4 ชั้นของ App (10) จะทำงานในลำดับถัดไปเมื่อเปิด Live Mode
    } catch (e) {
      console.error("Fetch Error:", e);
    }
  }, []);

  useEffect(() => { fetchPrices(); }, [fetchPrices]);

  // 4. การคำนวณ Summary (Dashboard)
  const summary = useMemo(() => {
    let totalValue = 0;
    let annualDiv = 0;
    
    portfolio.forEach(item => {
      const price = prices[item.symbol]?.price || 0;
      const divYield = prices[item.symbol]?.dividendYield || 0;
      const value = item.amount * price;
      totalValue += value;
      annualDiv += (value * (divYield / 100));
    });

    return {
      totalValue,
      annualDiv,
      avgYield: totalValue > 0 ? (annualDiv / totalValue) * 100 : 0
    };
  }, [portfolio, prices]);

  // ฟังก์ชันบันทึกข้อมูลกลับไป Firebase
  const syncFirebase = async (newP, newW, newA) => {
    const userDoc = doc(db, "users", "weeradet_p");
    await setDoc(userDoc, { 
      portfolio: newP || portfolio, 
      watchlist: newW || watchlist, 
      alerts: newA || alerts,
      lastUpdated: new Date().toISOString()
    }, { merge: true });
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
      {/* Nav & Tabs */}
      <nav class="border-b border-slate-800 p-4 sticky top-0 bg-slate-900/95 backdrop-blur z-50">
        <div class="max-w-6xl mx-auto flex justify-between items-center">
          <h1 class="text-xl font-bold text-blue-500">V6.5 Build (App-10 Based)</h1>
          <div class="flex gap-4 text-sm">
            {['dashboard', 'search', 'watchlist', 'alerts'].map(tab => (
              <button 
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`capitalize ${activeTab === tab ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-400'}`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto p-6">
        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700">
                <p className="text-slate-400 text-sm">Total Portfolio Value</p>
                <h2 className="text-3xl font-bold text-blue-400">${summary.totalValue.toLocaleString()}</h2>
              </div>
              <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700">
                <p className="text-slate-400 text-sm">Estimated Annual Dividend</p>
                <h2 className="text-3xl font-bold text-green-400">${summary.annualDiv.toLocaleString()}</h2>
              </div>
              <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700">
                <p className="text-slate-400 text-sm">Average Portfolio Yield</p>
                <h2 className="text-3xl font-bold text-orange-400">{summary.avgYield.toFixed(2)}%</h2>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Pie Chart */}
              <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 h-80">
                <h3 className="text-sm font-bold mb-4 uppercase tracking-wider text-slate-500">Allocation</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie 
                      data={portfolio.map(i => ({ name: i.symbol, value: i.amount * (prices[i.symbol]?.price || 0) }))}
                      innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value"
                    >
                      {portfolio.map((_, i) => <Cell key={i} fill={['#3b82f6', '#10b981', '#f59e0b', '#ef4444'][i % 4]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Asset Table */}
              <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 overflow-auto">
                <h3 className="text-sm font-bold mb-4 uppercase tracking-wider text-slate-500">Holdings</h3>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-700">
                      <th className="pb-2">Symbol</th>
                      <th className="pb-2">Shares</th>
                      <th className="pb-2">Price</th>
                      <th className="pb-2 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.map((item, idx) => (
                      <tr key={idx} className="border-b border-slate-700/50">
                        <td className="py-3 font-bold">{item.symbol}</td>
                        <td>{item.amount}</td>
                        <td>${prices[item.symbol]?.price || '0.00'}</td>
                        <td className="text-right text-blue-400 font-mono">
                          ${(item.amount * (prices[item.symbol]?.price || 0)).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ส่วน Search & Watchlist (เพิ่มโครงสร้างจาก App-10) */}
        {activeTab === 'search' && (
          <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700">
             <input 
               type="text" 
               placeholder="ค้นหาจาก 746+ หลักทรัพย์..." 
               className="w-full bg-slate-900 border border-slate-700 p-4 rounded-xl mb-4 focus:ring-2 ring-blue-500 outline-none"
             />
             {/* รายการผลการค้นหาจะแสดงที่นี่โดยดึงจาก allAssets */}
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
