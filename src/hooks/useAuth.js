// src/hooks/useAuth.js
// Hook สำหรับจัดการ Google Authentication
// คืนค่า: { user, loading, signIn, signOut }

import { useState, useEffect } from "react";
import { signInWithPopup, signOut as firebaseSignOut, onAuthStateChanged } from "firebase/auth";
import { auth, provider } from "../firebase";

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // true ขณะ Firebase กำลัง restore session

  useEffect(() => {
    // ฟัง auth state: login / logout / page refresh
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  /** เปิด Google Sign-In popup */
  const signIn = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      // ผู้ใช้ปิด popup → ไม่ต้อง alert
      if (err.code !== "auth/popup-closed-by-user") {
        console.error("Google Sign-In error:", err);
      }
    }
  };

  /** Logout */
  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  return { user, loading, signIn, signOut };
}
