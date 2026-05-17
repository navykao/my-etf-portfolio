// src/hooks/useFirestore.js
// Hook สำหรับ sync Portfolio + Watchlist กับ Firestore
// ✅ v2: sync inPortfolio / inWatchlist กลับ etfs.json และ stocks.json อัตโนมัติ
//
// เมื่อ user เพิ่ม/ลบ ETF หรือหุ้นใน Portfolio หรือ Watchlist
// → อัปเดต field inPortfolio / inWatchlist ใน public/data/etfs.json และ stocks.json
//   ผ่าน GitHub API (Personal Access Token)
// → GitHub Actions script จะอ่าน field เหล่านี้เพื่อจัด priority Alpha Vantage

import { useState, useEffect, useCallback } from "react";
import {
  doc,
  collection,
  onSnapshot,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";

// ============================================
// CONFIG — GitHub API
// ใช้ GitHub API อัปเดต etfs.json / stocks.json
// เมื่อ portfolio/watchlist เปลี่ยน
// ============================================
const GITHUB_CONFIG = {
  owner:  import.meta.env.VITE_GITHUB_OWNER || '',   // เช่น 'navykao'
  repo:   import.meta.env.VITE_GITHUB_REPO  || '',   // เช่น 'my-etf-portfolio'
  token:  import.meta.env.VITE_GITHUB_TOKEN || '',   // Personal Access Token (repo scope)
  branch: 'main',
};

// ============================================
// GitHub API Helper
// อัปเดตไฟล์ใน repo ผ่าน GitHub Contents API
// ============================================
async function updateJsonFile(filePath, updaterFn) {
  if (!GITHUB_CONFIG.token || !GITHUB_CONFIG.owner || !GITHUB_CONFIG.repo) {
    console.warn('[useFirestore] GitHub config ไม่ครบ — ข้าม sync JSON');
    return;
  }

  try {
    const apiUrl = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${filePath}?ref=${GITHUB_CONFIG.branch}`;
    const headers = {
      Authorization: `Bearer ${GITHUB_CONFIG.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    // ดึงไฟล์ปัจจุบัน
    const res = await fetch(apiUrl, { headers });
    if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
    const fileInfo = await res.json();

    // decode base64 → JSON
    const currentData = JSON.parse(atob(fileInfo.content.replace(/\n/g, '')));

    // ให้ updaterFn แก้ไขข้อมูล
    const updatedData = updaterFn(currentData);

    // encode JSON → base64
    const newContent = btoa(unescape(encodeURIComponent(
      JSON.stringify(updatedData, null, 2)
    )));

    // commit กลับ
    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `🔄 sync: update ${filePath} portfolio/watchlist flags`,
        content: newContent,
        sha: fileInfo.sha,
        branch: GITHUB_CONFIG.branch,
      }),
    });

    if (!putRes.ok) {
      const err = await putRes.json();
      throw new Error(`GitHub PUT failed: ${err.message}`);
    }

    console.log(`[useFirestore] ✅ synced ${filePath}`);
  } catch (error) {
    console.error(`[useFirestore] ❌ sync ${filePath} failed:`, error.message);
  }
}

// ============================================
// Sync Portfolio → etfs.json + stocks.json
// เรียกเมื่อ portfolio เปลี่ยน
// ============================================
async function syncPortfolioToJson(portfolioItems) {
  const portfolioSymbols = new Set(
    portfolioItems.map(p => p.symbol?.toUpperCase()).filter(Boolean)
  );

  // อัปเดต etfs.json
  await updateJsonFile('public/data/etfs.json', (etfs) =>
    etfs.map(etf => ({
      ...etf,
      inPortfolio: portfolioSymbols.has(etf.symbol),
    }))
  );

  // อัปเดต stocks.json
  await updateJsonFile('public/data/stocks.json', (stocks) =>
    stocks.map(stock => ({
      ...stock,
      inPortfolio: portfolioSymbols.has(stock.symbol),
    }))
  );
}

// ============================================
// Sync Watchlist → etfs.json + stocks.json
// เรียกเมื่อ watchlist เปลี่ยน
// ============================================
async function syncWatchlistToJson(watchlistItems) {
  const watchlistSymbols = new Set(
    watchlistItems.map(w => w.symbol?.toUpperCase()).filter(Boolean)
  );

  // อัปเดต etfs.json
  await updateJsonFile('public/data/etfs.json', (etfs) =>
    etfs.map(etf => ({
      ...etf,
      inWatchlist: watchlistSymbols.has(etf.symbol),
    }))
  );

  // อัปเดต stocks.json
  await updateJsonFile('public/data/stocks.json', (stocks) =>
    stocks.map(stock => ({
      ...stock,
      inWatchlist: watchlistSymbols.has(stock.symbol),
    }))
  );
}

// ============================================
// useFirestore(uid)
// คืนค่า: { portfolio, watchlist, addPortfolio, removePortfolio, addWatchlist, removeWatchlist }
// ============================================
export function useFirestore(uid) {
  const [portfolio, setPortfolio] = useState([]);
  const [watchlist, setWatchlist] = useState([]);

  // ─── Real-time listeners ─────────────────────────────────────────────────
  useEffect(() => {
    if (!uid) {
      setPortfolio([]);
      setWatchlist([]);
      return;
    }

    // Subscribe portfolio: users/{uid}/portfolio/{docId}
    const portfolioRef = collection(db, 'users', uid, 'portfolio');
    const unsubPortfolio = onSnapshot(portfolioRef, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      items.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
      setPortfolio(items);
    });

    // Subscribe watchlist: users/{uid}/watchlist/{symbol}
    const watchlistRef = collection(db, 'users', uid, 'watchlist');
    const unsubWatchlist = onSnapshot(watchlistRef, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      items.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
      setWatchlist(items);
    });

    return () => {
      unsubPortfolio();
      unsubWatchlist();
    };
  }, [uid]);

  // ─── Portfolio CRUD ──────────────────────────────────────────────────────

  /** เพิ่ม/อัปเดต holding ใน portfolio */
  const addPortfolio = useCallback(
    async (holding) => {
      if (!uid) return;
      const sym = holding.symbol.toUpperCase();
      const docRef = doc(db, 'users', uid, 'portfolio', sym);
      await setDoc(
        docRef,
        {
          ...holding,
          symbol: sym,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
      // sync inPortfolio กลับ JSON
      const updated = [...portfolio.filter(p => p.symbol !== sym), { ...holding, symbol: sym }];
      await syncPortfolioToJson(updated);
    },
    [uid, portfolio]
  );

  /** ลบ holding ออกจาก portfolio */
  const removePortfolio = useCallback(
    async (symbol) => {
      if (!uid) return;
      const sym = symbol.toUpperCase();
      await deleteDoc(doc(db, 'users', uid, 'portfolio', sym));
      // sync inPortfolio กลับ JSON
      const updated = portfolio.filter(p => p.symbol !== sym);
      await syncPortfolioToJson(updated);
    },
    [uid, portfolio]
  );

  // ─── Watchlist CRUD ──────────────────────────────────────────────────────

  /** เพิ่ม symbol เข้า watchlist */
  const addWatchlist = useCallback(
    async (item) => {
      if (!uid) return;
      const sym = (item.symbol || item).toUpperCase();
      const docRef = doc(db, 'users', uid, 'watchlist', sym);
      await setDoc(
        docRef,
        {
          symbol: sym,
          name:   item.name || sym,
          type:   item.type || 'STOCK',
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
      // sync inWatchlist กลับ JSON
      const updated = [...watchlist.filter(w => w.symbol !== sym), { symbol: sym }];
      await syncWatchlistToJson(updated);
    },
    [uid, watchlist]
  );

  /** ลบ symbol ออกจาก watchlist */
  const removeWatchlist = useCallback(
    async (symbol) => {
      if (!uid) return;
      const sym = symbol.toUpperCase();
      await deleteDoc(doc(db, 'users', uid, 'watchlist', sym));
      // sync inWatchlist กลับ JSON
      const updated = watchlist.filter(w => w.symbol !== sym);
      await syncWatchlistToJson(updated);
    },
    [uid, watchlist]
  );

  return {
    portfolio,
    watchlist,
    addPortfolio,
    removePortfolio,
    addWatchlist,
    removeWatchlist,
  };
}
