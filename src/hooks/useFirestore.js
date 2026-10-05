// src/hooks/useFirestore.js
// Hook สำหรับ sync Portfolio + Watchlist กับ Firestore
// ✅ v2: sync inPortfolio / inWatchlist กลับ etfs.json และ stocks.json อัตโนมัติ
//
// เมื่อ user เพิ่ม/ลบ ETF หรือหุ้นใน Portfolio หรือ Watchlist
// → อัปเดต field inPortfolio / inWatchlist ใน public/data/etfs.json และ stocks.json
//   ผ่าน /api/sync-flags (serverless function ที่ถือ GitHub token ฝั่ง server)
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
import { auth, db } from "../firebase";

// ============================================
// Sync flags → etfs.json + stocks.json
// เรียก /api/sync-flags (Vercel Serverless Function) ซึ่งถือ GitHub token ฝั่ง server
// ไม่มี token ในโค้ดฝั่ง client — ต้องล็อกอิน และ email ต้องอยู่ใน ALLOWED_EMAILS
// ============================================
async function syncFlags(flags) {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/sync-flags', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(flags),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const { updated } = await res.json();
    console.log('[useFirestore] ✅ synced', updated.length ? updated.join(', ') : '(no changes)');
  } catch (error) {
    console.error('[useFirestore] ❌ sync flags failed:', error.message);
  }
}

const symbolsOf = (items) =>
  items.map((i) => i.symbol?.toUpperCase()).filter(Boolean);

// เรียกเมื่อ portfolio เปลี่ยน
const syncPortfolioToJson = (portfolioItems) =>
  syncFlags({ portfolio: symbolsOf(portfolioItems) });

// เรียกเมื่อ watchlist เปลี่ยน
const syncWatchlistToJson = (watchlistItems) =>
  syncFlags({ watchlist: symbolsOf(watchlistItems) });

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
