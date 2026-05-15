// src/hooks/useFirestore.js
// Hook สำหรับ sync Portfolio + Watchlist กับ Firestore
// ใช้ onSnapshot เพื่อ real-time sync อัตโนมัติ

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

/**
 * useFirestore(uid)
 * คืนค่า: { portfolio, watchlist, addPortfolio, removePortfolio, addWatchlist, removeWatchlist }
 * - portfolio  : Array ของ holdings ที่ user ถือ
 * - watchlist  : Array ของ symbols ที่ติดตาม
 */
export function useFirestore(uid) {
  const [portfolio, setPortfolio] = useState([]);
  const [watchlist, setWatchlist] = useState([]);

  // ─── Real-time listeners ───────────────────────────────────────────────────
  useEffect(() => {
    if (!uid) {
      setPortfolio([]);
      setWatchlist([]);
      return;
    }

    // Subscribe portfolio collection: users/{uid}/portfolio/{docId}
    const portfolioRef = collection(db, "users", uid, "portfolio");
    const unsubPortfolio = onSnapshot(portfolioRef, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // เรียงตาม createdAt (เก่า → ใหม่)
      items.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
      setPortfolio(items);
    });

    // Subscribe watchlist collection: users/{uid}/watchlist/{symbol}
    const watchlistRef = collection(db, "users", uid, "watchlist");
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

  // ─── Portfolio CRUD ────────────────────────────────────────────────────────

  /** เพิ่ม/อัปเดต holding ใน portfolio
   *  @param {Object} holding - { symbol, name, shares, buyPrice, type, sector, ... }
   *  ใช้ symbol เป็น document ID เพื่อ upsert ได้ง่าย
   */
  const addPortfolio = useCallback(
    async (holding) => {
      if (!uid) return;
      const docRef = doc(db, "users", uid, "portfolio", holding.symbol.toUpperCase());
      await setDoc(
        docRef,
        {
          ...holding,
          symbol: holding.symbol.toUpperCase(),
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    },
    [uid]
  );

  /** ลบ holding ออกจาก portfolio */
  const removePortfolio = useCallback(
    async (symbol) => {
      if (!uid) return;
      await deleteDoc(doc(db, "users", uid, "portfolio", symbol.toUpperCase()));
    },
    [uid]
  );

  // ─── Watchlist CRUD ────────────────────────────────────────────────────────

  /** เพิ่ม symbol เข้า watchlist */
  const addWatchlist = useCallback(
    async (item) => {
      if (!uid) return;
      const sym = (item.symbol || item).toUpperCase();
      const docRef = doc(db, "users", uid, "watchlist", sym);
      await setDoc(docRef, {
        symbol: sym,
        name: item.name || sym,
        type: item.type || "STOCK",
        createdAt: serverTimestamp(),
      }, { merge: true });
    },
    [uid]
  );

  /** ลบ symbol ออกจาก watchlist */
  const removeWatchlist = useCallback(
    async (symbol) => {
      if (!uid) return;
      await deleteDoc(doc(db, "users", uid, "watchlist", symbol.toUpperCase()));
    },
    [uid]
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
